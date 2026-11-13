/**
 * Shared state for the checks of one chain: ground truth, indexed rows and
 * token metadata read from the chain.
 */
import type { AbiRegistry } from "../lib/abi";
import type { ChainSpec } from "../lib/config";
import type { Indexed } from "../lib/indexed";
import type { PgRow } from "../lib/pg";
import type { CheckResult } from "../lib/report";
import type { RpcClient } from "../lib/rpc";
import { lc } from "../lib/util";
import { ERC20_ABI, ERC20_SYMBOL_BYTES32_ABI } from "../lib/viewAbis";
import type { ChainTruth } from "../truth/types";

export interface TokenMeta {
  decimals: number | null;
  symbol: string | null;
  error?: string;
}

export interface CheckOptions {
  /** Items per RPC-sampled check (default 25). */
  sample: number;
  /** Pools re-streamed for snapshot value checks (default 8). */
  snapshotPools: number;
  /** Reference price TSV directory (prod oracle export), if any. */
  refPriceDir?: string;
  /** Query DefiLlama (public, keyless) for price samples. */
  defillama: boolean;
  /** Limit of DefiLlama samples per chain. */
  defillamaSamples: number;
}

export interface CheckContext {
  chainId: number;
  chain: ChainSpec;
  truth: ChainTruth;
  idx: Indexed;
  rpc?: RpcClient;
  reg: AbiRegistry;
  opts: CheckOptions;
  log: (m: string) => void;
  /** Indexed Pool rows by lowercase address. */
  pools: Map<string, PgRow>;
  /** Indexed Token rows by lowercase address. */
  tokens: Map<string, PgRow>;
  /** On-chain token metadata by lowercase address. */
  tokenMeta: Map<string, TokenMeta>;
  results: CheckResult[];
}

/**
 * Loads indexed pools/tokens and on-chain token metadata for a chain.
 * @param ctx - Partially filled context (pools/tokens/tokenMeta are filled here)
 * @returns Promise resolving when loaded
 */
export async function loadCommon(ctx: CheckContext): Promise<void> {
  for (const r of await ctx.idx.rowsForChain("Pool", ctx.chainId))
    ctx.pools.set(lc(r.poolAddress), r);
  for (const r of await ctx.idx.rowsForChain("Token", ctx.chainId))
    ctx.tokens.set(lc(r.address), r);
  if (!ctx.rpc) return;
  const tokens = [...ctx.truth.tokens];
  const res = await ctx.rpc.calls(
    ctx.truth.pinnedBlock,
    tokens.flatMap((t) => [
      { to: t, abi: ERC20_ABI, fn: "decimals" },
      { to: t, abi: ERC20_ABI, fn: "symbol" },
    ]),
  );
  const retry: string[] = [];
  tokens.forEach((t, i) => {
    const d = res[2 * i];
    const s = res[2 * i + 1];
    ctx.tokenMeta.set(t, {
      decimals: d instanceof Error ? null : Number(d as number),
      symbol: s instanceof Error ? null : (s as string),
      error:
        d instanceof Error
          ? d.message
          : s instanceof Error
            ? s.message
            : undefined,
    });
    if (s instanceof Error) retry.push(t);
  });
  if (retry.length > 0) {
    // Some tokens (MKR-style) return bytes32 symbols.
    const r2 = await ctx.rpc.calls(
      ctx.truth.pinnedBlock,
      retry.map((t) => ({
        to: t,
        abi: ERC20_SYMBOL_BYTES32_ABI,
        fn: "symbol",
      })),
    );
    retry.forEach((t, i) => {
      const v = r2[i];
      if (v instanceof Error) return;
      const hex = (v as string).slice(2).replace(/(00)+$/, "");
      const meta = ctx.tokenMeta.get(t);
      if (meta) {
        meta.symbol = Buffer.from(hex, "hex").toString("utf8");
        meta.error = undefined;
      }
    });
  }
}

/**
 * On-chain decimals of a token (falls back to the indexed value, then 18).
 * @param ctx - Context
 * @param token - Token address
 * @returns Decimals
 */
export function decimalsOf(ctx: CheckContext, token: string): number {
  const m = ctx.tokenMeta.get(token);
  if (m?.decimals !== null && m?.decimals !== undefined) return m.decimals;
  const r = ctx.tokens.get(token);
  return r?.decimals ? Number(r.decimals) : 18;
}

/**
 * 1e18-normalisation as the schema documents it (raw × 10^(18-d), or ÷ for d > 18).
 * @param raw - Raw amount
 * @param decimals - Token decimals
 * @returns Normalized amount
 */
export function to1e18(raw: bigint, decimals: number): bigint {
  return decimals <= 18
    ? raw * 10n ** BigInt(18 - decimals)
    : raw / 10n ** BigInt(decimals - 18);
}
