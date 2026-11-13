/**
 * JSON-RPC client for contract state at a pinned block (eth_call,
 * eth_getBalance, eth_getCode). Never used for log scans.
 *
 * Every call counts against a budget (default 10,000 per process, override
 * with VERIFY_RPC_BUDGET); a running total is also appended to a ledger file
 * when VERIFY_RPC_LEDGER is set, so usage across runs can be reported.
 * Historical calls answered by a pruned node ("insufficient changesets",
 * "missing trie node", ...) are retried.
 */
import { appendFileSync } from "node:fs";
import {
  type Abi,
  type Hex,
  decodeFunctionResult,
  encodeFunctionData,
} from "viem";
import { loadEnv } from "./env";
import { httpRequest, sleep } from "./http";

export const rpcStats = { requests: 0, retries: 0, failures: 0 };

function budget(): number {
  return Number(process.env.VERIFY_RPC_BUDGET ?? 10_000);
}

const RETRYABLE =
  /insufficient changesets|missing trie node|header not found|state.*not available|pruned|timeout|ECONNRESET|socket hang up|429|502|503|504|rate limit|internal error|unknown block/i;

export interface RpcCall {
  method: string;
  params: unknown[];
}

/** Client bound to one chain's RPC URL. */
export class RpcClient {
  /**
   * @param url - HTTP(S) RPC endpoint
   * @param chainId - Chain id (for diagnostics)
   */
  constructor(
    private readonly url: string,
    readonly chainId: number,
  ) {}

  /**
   * Sends a batch of JSON-RPC calls (each counted against the budget).
   * Individual failures are retried as a smaller batch.
   * @param calls - Calls to send
   * @returns Results in order (an Error object for calls that kept failing)
   */
  async batch(calls: RpcCall[]): Promise<(unknown | Error)[]> {
    const out: (unknown | Error)[] = new Array(calls.length);
    let pending = calls.map((c, i) => ({ c, i }));
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (rpcStats.requests + pending.length > budget()) {
        throw new Error(
          `RPC budget exhausted (${rpcStats.requests} used, budget ${budget()})`,
        );
      }
      rpcStats.requests += pending.length;
      if (attempt > 0) rpcStats.retries += pending.length;
      if (process.env.VERIFY_RPC_LEDGER) {
        appendFileSync(
          process.env.VERIFY_RPC_LEDGER,
          `${new Date().toISOString()}\t${this.chainId}\t${pending.length}\n`,
        );
      }
      const body = JSON.stringify(
        pending.map(({ c }, k) => ({
          jsonrpc: "2.0",
          id: k,
          method: c.method,
          params: c.params,
        })),
      );
      let resp: {
        id: number;
        result?: unknown;
        error?: { message: string };
      }[] = [];
      try {
        const res = await httpRequest(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          timeoutMs: 60_000,
        });
        const text = res.body.toString();
        if (res.status !== 200)
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        const parsed = JSON.parse(text);
        resp = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        if (attempt >= 6) {
          for (const { i } of pending) out[i] = e as Error;
          rpcStats.failures += pending.length;
          return out;
        }
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const next: typeof pending = [];
      const byId = new Map(resp.map((r) => [r.id, r]));
      pending.forEach((p, k) => {
        const r = byId.get(k);
        if (!r) {
          next.push(p);
        } else if (r.error) {
          if (RETRYABLE.test(r.error.message) && attempt < 6) next.push(p);
          else {
            out[p.i] = new Error(r.error.message);
            rpcStats.failures++;
          }
        } else {
          out[p.i] = r.result;
        }
      });
      pending = next;
      if (pending.length > 0) await sleep(500 * 2 ** attempt);
    }
    return out;
  }

  /**
   * Batched eth_call of view functions at a block, decoded with viem.
   * @param block - Block number
   * @param items - Target, ABI, function name and args per call
   * @param chunk - Calls per HTTP batch (default 50)
   * @returns Decoded results (Error for failed calls / reverts)
   */
  async calls(
    block: number,
    items: { to: string; abi: Abi; fn: string; args?: unknown[] }[],
    chunk = 50,
  ): Promise<(unknown | Error)[]> {
    const tag = `0x${block.toString(16)}`;
    const out: (unknown | Error)[] = [];
    for (let i = 0; i < items.length; i += chunk) {
      const part = items.slice(i, i + chunk);
      const res = await this.batch(
        part.map((it) => ({
          method: "eth_call",
          params: [
            {
              to: it.to,
              data: encodeFunctionData({
                abi: it.abi,
                functionName: it.fn,
                args: it.args ?? [],
              } as never),
            },
            tag,
          ],
        })),
      );
      res.forEach((r, k) => {
        if (r instanceof Error) out.push(r);
        else {
          try {
            out.push(
              decodeFunctionResult({
                abi: part[k].abi,
                functionName: part[k].fn,
                data: r as Hex,
              } as never),
            );
          } catch (e) {
            out.push(
              new Error(
                `decode ${part[k].fn}: ${(e as Error).message} (raw ${String(r).slice(0, 80)})`,
              ),
            );
          }
        }
      });
    }
    return out;
  }
}

/**
 * Resolves the RPC URL of a chain from its config.yaml env var.
 * @param envVar - Variable name (e.g. ENVIO_MODE_RPC_URL)
 * @param chainId - Chain id
 * @returns Client, or undefined when no URL is configured
 */
export function rpcFor(
  envVar: string | undefined,
  chainId: number,
): RpcClient | undefined {
  loadEnv();
  const url = envVar ? process.env[envVar] : undefined;
  return url ? new RpcClient(url, chainId) : undefined;
}
