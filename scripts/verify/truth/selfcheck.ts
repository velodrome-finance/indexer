/**
 * Validates the log-replayed ground truth against contract state at the
 * pinned block (a test of the harness, not of the indexer): V2 reserves and
 * LP supply, CL slot0 / in-range liquidity / token balances, NFT positions and
 * owners, V2 gauge supply. Uses a small RPC sample.
 */
import type { AbiRegistry } from "../lib/abi";
import type { ChainSpec } from "../lib/config";
import { rpcFor } from "../lib/rpc";
import { sample } from "../lib/util";
import {
  CL_POOL_ABI,
  ERC20_ABI,
  NFPM_ABI,
  V2_GAUGE_ABI,
  V2_POOL_ABI,
} from "../lib/viewAbis";
import type { ChainTruth, PoolTruth } from "./types";

/**
 * In-range liquidity implied by the replayed positions.
 * @param p - CL pool truth
 * @returns Σ L of positions with tickLower <= tick < tickUpper
 */
export function inRangeLiquidity(p: PoolTruth): bigint {
  let l = 0n;
  for (const [k, liq] of p.positions) {
    const [, tl, tu] = k.split("|");
    if (Number(tl) <= p.tick && p.tick < Number(tu)) l += liq;
  }
  return l;
}

export interface SelfCheckResult {
  checked: Record<string, number>;
  mismatches: string[];
  notes: string[];
}

/**
 * Runs the self-check.
 * @param t - Chain truth
 * @param chain - Chain spec
 * @param _reg - ABI registry (unused; kept for symmetry)
 * @param opts - Sample sizes and logger
 * @returns Mismatch list
 */
export async function selfCheckTruth(
  t: ChainTruth,
  chain: ChainSpec,
  _reg: AbiRegistry,
  opts: { perKind?: number; log?: (m: string) => void } = {},
): Promise<SelfCheckResult> {
  const rpc = rpcFor(chain.rpcEnvVar, chain.id);
  const res: SelfCheckResult = { checked: {}, mismatches: [], notes: [] };
  if (!rpc) {
    res.notes.push("no RPC configured");
    return res;
  }
  const n = opts.perKind ?? 15;
  const B = t.pinnedBlock;
  const pools = [...t.pools.values()];
  const v2 = sample(
    pools.filter((p) => p.kind === "v2" && p.swaps > 0),
    n,
    `v2-${t.chainId}`,
  );
  const cl = sample(
    pools.filter((p) => p.kind === "cl" && p.swaps > 0),
    n,
    `cl-${t.chainId}`,
  );

  const v2res = await rpc.calls(
    B,
    v2.flatMap((p) => [
      { to: p.address, abi: V2_POOL_ABI, fn: "getReserves" },
      { to: p.address, abi: V2_POOL_ABI, fn: "totalSupply" },
    ]),
  );
  v2.forEach((p, i) => {
    const r = v2res[2 * i] as [bigint, bigint, bigint] | Error;
    const s = v2res[2 * i + 1] as bigint | Error;
    if (r instanceof Error || s instanceof Error) {
      res.notes.push(
        `v2 ${p.address}: rpc error ${(r as Error).message ?? (s as Error).message}`,
      );
      return;
    }
    if (r[0] !== p.reserve0 || r[1] !== p.reserve1)
      res.mismatches.push(
        `v2 reserves ${p.address}: chain ${r[0]}/${r[1]} truth ${p.reserve0}/${p.reserve1}`,
      );
    if (s !== p.lpSupply)
      res.mismatches.push(
        `v2 totalSupply ${p.address}: chain ${s} truth ${p.lpSupply}`,
      );
  });
  res.checked.v2Pools = v2.length;

  const clres = await rpc.calls(
    B,
    cl.flatMap((p) => [
      { to: p.address, abi: CL_POOL_ABI, fn: "slot0" },
      { to: p.address, abi: CL_POOL_ABI, fn: "liquidity" },
      { to: p.token0, abi: ERC20_ABI, fn: "balanceOf", args: [p.address] },
      { to: p.token1, abi: ERC20_ABI, fn: "balanceOf", args: [p.address] },
    ]),
  );
  cl.forEach((p, i) => {
    const s0 = clres[4 * i] as readonly [bigint, number] | Error;
    const liq = clres[4 * i + 1] as bigint | Error;
    const b0 = clres[4 * i + 2] as bigint | Error;
    const b1 = clres[4 * i + 3] as bigint | Error;
    if (
      s0 instanceof Error ||
      liq instanceof Error ||
      b0 instanceof Error ||
      b1 instanceof Error
    ) {
      res.notes.push(`cl ${p.address}: rpc error`);
      return;
    }
    if (s0[0] !== p.sqrtPriceX96 || Number(s0[1]) !== p.tick)
      res.mismatches.push(
        `cl slot0 ${p.address}: chain ${s0[0]}/${s0[1]} truth ${p.sqrtPriceX96}/${p.tick}`,
      );
    const L = inRangeLiquidity(p);
    if (liq !== L)
      res.mismatches.push(
        `cl liquidity ${p.address}: chain ${liq} truth(positions) ${L} lastSwap ${p.lastSwapLiquidity}`,
      );
    const exp0 =
      p.sumMint0 +
      p.sumSwap0 -
      p.sumCollect0 -
      p.sumCollectFees0 +
      p.flashPaid0;
    const exp1 =
      p.sumMint1 +
      p.sumSwap1 -
      p.sumCollect1 -
      p.sumCollectFees1 +
      p.flashPaid1;
    if (b0 < exp0 || b1 < exp1)
      res.mismatches.push(
        `cl balance below log-implied ${p.address}: chain ${b0}/${b1} logs ${exp0}/${exp1}`,
      );
    else if (b0 !== exp0 || b1 !== exp1)
      res.notes.push(
        `cl ${p.address}: balance exceeds log-implied by ${b0 - exp0}/${b1 - exp1} (donations)`,
      );
  });
  res.checked.clPools = cl.length;

  const nfts = sample(
    [...t.nfts.values()].filter((x) => !x.burned),
    n * 2,
    `nft-${t.chainId}`,
  );
  const nres = await rpc.calls(
    B,
    nfts.flatMap((x) => [
      { to: x.nfpm, abi: NFPM_ABI, fn: "positions", args: [x.tokenId] },
      { to: x.nfpm, abi: NFPM_ABI, fn: "ownerOf", args: [x.tokenId] },
    ]),
  );
  nfts.forEach((x, i) => {
    const pos = nres[2 * i] as readonly unknown[] | Error;
    const own = nres[2 * i + 1] as string | Error;
    if (pos instanceof Error || own instanceof Error) {
      res.notes.push(`nft ${x.nfpm}/${x.tokenId}: rpc error`);
      return;
    }
    if ((pos[7] as bigint) !== x.liquidity)
      res.mismatches.push(
        `nft liquidity ${x.nfpm}/${x.tokenId}: chain ${pos[7]} truth ${x.liquidity}`,
      );
    if (Number(pos[5]) !== x.tickLower || Number(pos[6]) !== x.tickUpper)
      res.mismatches.push(
        `nft ticks ${x.nfpm}/${x.tokenId}: chain ${pos[5]}/${pos[6]} truth ${x.tickLower}/${x.tickUpper}`,
      );
    if (own.toLowerCase() !== x.owner)
      res.mismatches.push(
        `nft owner ${x.nfpm}/${x.tokenId}: chain ${own} truth ${x.owner}`,
      );
  });
  res.checked.nfts = nfts.length;

  const gauges = sample(
    [...t.gauges.values()].filter((g) => g.kind === "v2"),
    n,
    `g-${t.chainId}`,
  );
  const gres = await rpc.calls(
    B,
    gauges.map((g) => ({
      to: g.address,
      abi: V2_GAUGE_ABI,
      fn: "totalSupply",
    })),
  );
  gauges.forEach((g, i) => {
    const s = gres[i] as bigint | Error;
    if (s instanceof Error) return;
    if (s !== g.netStakeFromEvents)
      res.mismatches.push(
        `v2 gauge supply ${g.address}: chain ${s} truth ${g.netStakeFromEvents}`,
      );
  });
  res.checked.v2Gauges = gauges.length;
  return res;
}
