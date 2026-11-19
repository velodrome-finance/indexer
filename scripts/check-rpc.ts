/**
 * RPC health check for every chain the indexer uses.
 *
 * For each chain and each configured endpoint (primary, fallback):
 *   1. `eth_chainId` must equal the chain id;
 *   2. `eth_blockNumber` (head);
 *   3. N archive `eth_call`s (`totalSupply()` on the WETH predeploy, or the
 *      CELO token on Celo) at blocks spread from the price-oracle deploy
 *      block to near the head. Several calls, not one: a load balancer that mixes archive and
 *      pruned nodes passes a single call by luck.
 * Reports latency and the failure fraction per endpoint, with typed error
 * classes (src/Effects/Helpers.ts). URLs are printed with keys redacted.
 *
 * Calls go straight to the endpoint with no retry, to measure the raw failure
 * rate the indexer's retry/fallback layer has to absorb.
 *
 * Usage:
 *   npx -y tsx@4.19.2 scripts/check-rpc.ts [--calls 6] [--chain 10,8453]
 *       [--primary-only] [--url <chainId>=<url> ...] [--json]
 *
 * `--url` probes extra candidate endpoints (e.g. to pick a fallback).
 * Request count per endpoint: 2 + calls. Default run: 12 chains x 2 endpoints
 * x 8 = ~190 requests.
 */
import { readFileSync } from "node:fs";
import "dotenv/config";
import { http, type PublicClient, createPublicClient, parseAbi } from "viem";
import { CHAIN_CONSTANTS } from "../src/Constants";
import { describeRpcError, getErrorType } from "../src/Effects/Helpers";
import {
  RPC_CHAINS,
  redactRpcUrl,
  resolveRpcEndpoints,
} from "../src/Effects/RpcConfig";

type Probe = {
  chainId: number;
  chain: string;
  role: string;
  source: string;
  url: string;
  chainIdOk: boolean | null;
  head: number | null;
  ok: number;
  total: number;
  latenciesMs: number[];
  failures: { block: number; errorClass: string; error: string }[];
  fatal?: string;
};

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const allOpts = (name: string): string[] =>
  args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));

const CALLS = Number(opt("--calls") ?? 6);
const CHAINS = opt("--chain")
  ? (opt("--chain") as string).split(",").map(Number)
  : Object.keys(RPC_CHAINS).map(Number);
const PRIMARY_ONLY = flag("--primary-only");
const urlFile = opt("--url-file");
const EXTRA_URLS = [
  ...allOpts("--url"),
  ...(urlFile
    ? readFileSync(urlFile, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
    : []),
].map((s) => {
  const eq = s.indexOf("=");
  return { chainId: Number(s.slice(0, eq)), url: s.slice(eq + 1) };
});

const ABI = parseAbi(["function totalSupply() view returns (uint256)"]);

/**
 * Contract read for the archive probe: `totalSupply()` (a state read) on a
 * token that exists from genesis, so every sampled block must succeed on an
 * archive node: the WETH predeploy on OP-stack chains, the CELO token on Celo.
 * Chains not listed use their `weth` constant, which on the Aero-only chains
 * existed before the first sampled block (the Aero start block).
 */
const ARCHIVE_PROBE_TARGET: Record<number, `0x${string}`> = {
  42220: "0x471EcE3750Da237f93B8E339c536989b8978a438",
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  4663: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  5042: "0x3600000000000000000000000000000000000000",
};
const WETH_PREDEPLOY = "0x4200000000000000000000000000000000000006";
let requestCount = 0;

const timed = async <T>(fn: () => Promise<T>) => {
  const t0 = performance.now();
  requestCount++;
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
};

/** Blocks from the first block the indexer reads to ~1000 blocks below head. */
function sampleBlocks(start: number, head: number, n: number): number[] {
  const end = Math.max(start, head - 1000);
  if (n <= 1) return [start];
  return Array.from({ length: n }, (_, i) =>
    Math.round(start + ((end - start) * i) / (n - 1)),
  );
}

async function probe(
  chainId: number,
  role: string,
  source: string,
  url: string,
): Promise<Probe> {
  const cfg = RPC_CHAINS[chainId];
  const result: Probe = {
    chainId,
    chain: cfg.name,
    role,
    source,
    url: redactRpcUrl(url),
    chainIdOk: null,
    head: null,
    ok: 0,
    total: 0,
    latenciesMs: [],
    failures: [],
  };
  const client = createPublicClient({
    chain: cfg.viemChain,
    transport: http(url, { timeout: 25_000, retryCount: 0, batch: false }),
  }) as PublicClient;
  try {
    const id = await timed(() => client.getChainId());
    result.chainIdOk = id.value === chainId;
    if (!result.chainIdOk) {
      result.fatal = `eth_chainId returned ${id.value}`;
      return result;
    }
    const head = await timed(() => client.getBlockNumber());
    result.head = Number(head.value);
  } catch (e) {
    result.fatal = `${getErrorType(e)}: ${describeRpcError(e)}`;
    return result;
  }
  // First block an archive read can be needed at: the legacy oracle deploy
  // block, or the Aero start block on an Aero-only chain.
  const constants = CHAIN_CONSTANTS[chainId];
  const firstBlock =
    constants.legacy?.oracle.startBlock ?? constants.aero?.startBlock ?? 0;
  for (const block of sampleBlocks(firstBlock, result.head ?? 0, CALLS)) {
    result.total++;
    try {
      const r = await timed(() =>
        client.readContract({
          address: ARCHIVE_PROBE_TARGET[chainId] ?? WETH_PREDEPLOY,
          abi: ABI,
          functionName: "totalSupply",
          blockNumber: BigInt(block),
        }),
      );
      result.ok++;
      result.latenciesMs.push(r.ms);
    } catch (e) {
      result.failures.push({
        block,
        errorClass: getErrorType(e),
        error: describeRpcError(e),
      });
    }
  }
  return result;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return "-";
  const s = [...xs].sort((a, b) => a - b);
  return String(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

async function main() {
  const jobs: Promise<Probe>[] = [];
  const configErrors: string[] = [];
  for (const chainId of flag("--only-urls") ? [] : CHAINS) {
    try {
      const r = resolveRpcEndpoints(chainId);
      jobs.push(probe(chainId, "primary", r.primary.source, r.primary.url));
      if (!PRIMARY_ONLY && r.fallback) {
        jobs.push(
          probe(chainId, "fallback", r.fallback.source, r.fallback.url),
        );
      }
      for (const w of r.warnings) configErrors.push(`warn: ${w}`);
    } catch (e) {
      configErrors.push(`chain ${chainId}: ${(e as Error).message}`);
    }
  }
  for (const extra of EXTRA_URLS) {
    jobs.push(probe(extra.chainId, "candidate", "cli", extra.url));
  }
  // Chains run in parallel; calls within one endpoint are sequential.
  const results = await Promise.all(jobs);

  if (flag("--json")) {
    console.log(
      JSON.stringify({ results, configErrors, requestCount }, null, 2),
    );
    return;
  }
  const rows = results.map((r) => ({
    chain: `${r.chainId} ${r.chain}`,
    endpoint: `${r.role} (${r.source})`,
    url: r.url,
    chainId: r.chainIdOk === null ? "-" : r.chainIdOk ? "ok" : "MISMATCH",
    head: r.head ?? "-",
    archive: r.fatal ? "-" : `${r.ok}/${r.total}`,
    failPct: r.fatal
      ? "100%"
      : `${Math.round((100 * (r.total - r.ok)) / Math.max(1, r.total))}%`,
    p50ms: pct(r.latenciesMs, 50),
    maxms: r.latenciesMs.length ? String(Math.max(...r.latenciesMs)) : "-",
    errors: r.fatal
      ? r.fatal.slice(0, 120)
      : [...new Set(r.failures.map((f) => f.errorClass))].join(","),
  }));
  console.table(rows);
  const failed = results.filter((r) => r.fatal || r.failures.length);
  for (const r of failed) {
    console.log(`\n${r.chainId} ${r.chain} ${r.role} ${r.url}`);
    if (r.fatal) console.log(`  fatal: ${r.fatal}`);
    for (const f of r.failures) {
      console.log(
        `  block ${f.block}: ${f.errorClass}: ${f.error.slice(0, 220)}`,
      );
    }
  }
  for (const c of configErrors) console.log(c);
  console.log(`\nRPC requests made: ${requestCount}`);
  if (results.some((r) => r.role === "primary" && (r.fatal || r.ok < r.total)))
    process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
