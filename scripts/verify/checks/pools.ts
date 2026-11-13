/**
 * Pool state and totals, V2 and CL, against values recomputed from the pool's
 * own logs (and, for a sample, contract state at the pinned block).
 */
import { parseAbi } from "viem";
import { positionAmounts } from "../lib/clmath";
import { Check } from "../lib/report";
import { babs, big, relDiff, sample } from "../lib/util";
import { CL_POOL_ABI, ERC20_ABI, V2_POOL_ABI } from "../lib/viewAbis";
import { inRangeLiquidity } from "../truth/selfcheck";
import type { PoolTruth } from "../truth/types";
import { type CheckContext, decimalsOf, to1e18 } from "./context";

const V2_FACTORY_ABI = parseAbi([
  "function getFee(address pool, bool _stable) view returns (uint256)",
]);

/** Principal held by all positions of a CL pool at its current price. */
export function principalHeld(p: PoolTruth): {
  amount0: bigint;
  amount1: bigint;
  positions: number;
} {
  let a0 = 0n;
  let a1 = 0n;
  for (const [k, liq] of p.positions) {
    if (liq <= 0n) continue;
    const [, tl, tu] = k.split("|");
    const { amount0, amount1 } = positionAmounts(
      liq,
      p.sqrtPriceX96,
      p.tick,
      Number(tl),
      Number(tu),
    );
    a0 += amount0;
    a1 += amount1;
  }
  return { amount0: a0, amount1: a1, positions: p.positions.size };
}

function det(p: PoolTruth): Record<string, string | number> {
  return {
    lastLogBlock: p.lastLog?.block ?? 0,
    lastLogTx: p.lastLog?.tx ?? "",
    swaps: p.swaps,
  };
}

/**
 * Ratio pair the schema documents for token0Price / token1Price (1e18-scaled, whole-token units).
 * @param num - Exact spot price numerator (token1 per token0)
 * @param den - Denominator
 * @returns [token0Price, token1Price]
 */
function ratioPair(num: bigint, den: bigint): [bigint, bigint] {
  if (num <= 0n || den <= 0n) return [0n, 0n];
  const E18 = 10n ** 18n;
  return [(num * E18) / den, (den * E18) / num];
}

/**
 * V2 pools: swaps, volumes, reserves, LP supply, fees, claims, price ratios, fee rate.
 * @param ctx - Check context
 * @returns Promise resolving when done
 */
export async function checkV2Pools(ctx: CheckContext): Promise<void> {
  const pools = [...ctx.truth.pools.values()].filter(
    (p) => p.kind === "v2" && ctx.pools.has(p.address),
  );
  const counts = new Check(
    "pool.v2.swaps-volume",
    ctx.chainId,
    "V2 Pool.numberOfSwaps, totalVolume0/1 equal the count of Swap logs and Σ(amountIn + amountOut) per token.",
    "Exact: integer sums of event fields.",
  );
  const reserves = new Check(
    "pool.v2.reserves",
    ctx.chainId,
    "V2 Pool.reserve0/1 equal the last Sync event up to the pinned block (getReserves() at the pinned block confirmed the replay for a sample in the harness self-check).",
    "Exact.",
  );
  const supply = new Check(
    "pool.v2.lp-supply",
    ctx.chainId,
    "V2 Pool.totalLPTokenSupply equals Σ minted − Σ burned LP (Transfer from/to 0x0) and, for a sample, totalSupply() at the pinned block.",
    "Exact.",
  );
  const fees = new Check(
    "pool.v2.fees",
    ctx.chainId,
    "V2 Pool.totalFeesGenerated0/1 equal Σ Fees.amount0/1, 1e18-normalised with the token's on-chain decimals (schema: 1e18-normalised token units).",
    "Exact for tokens with ≤ 18 decimals (normalisation is a multiplication); for > 18 decimals, at most 1 unit per Fees log of truncation.",
  );
  const claims = new Check(
    "pool.v2.fees-collected",
    ctx.chainId,
    "V2 Pool.totalStakedFeesCollected0/1 = Σ Claim amounts whose sender is the pool's gauge; totalUnstakedFeesCollected0/1 = Σ the other Claim amounts (raw units).",
    "Exact.",
  );
  const ratios = new Check(
    "pool.v2.price-ratio",
    ctx.chainId,
    "V2 Pool.token0Price / token1Price equal the spot price implied by the last Sync reserves (volatile: reserve ratio; stable: slope of x³y + xy³), in whole-token units with on-chain decimals, 1e18-scaled.",
    "Relative 1e-9 (one trailing integer division); pools with an empty reserve are skipped.",
  );
  const feeRate = new Check(
    "pool.v2.fee-rate",
    ctx.chainId,
    "V2 Pool.baseFee and currentFee equal PoolFactory.getFee(pool, stable) at the pinned block × 100 (basis points lifted to FEE_SCALE 1e6, ADR 0001).",
    "Exact.",
  );
  for (const p of pools) {
    const r = ctx.pools.get(p.address);
    if (!r) continue;
    const d = det(p);
    counts.cmp(
      `${p.address}.numberOfSwaps`,
      big(r.numberOfSwaps),
      BigInt(p.swaps),
      {},
      d,
    );
    counts.cmp(`${p.address}.totalVolume0`, big(r.totalVolume0), p.vol0, {}, d);
    counts.cmp(`${p.address}.totalVolume1`, big(r.totalVolume1), p.vol1, {}, d);
    const sd = {
      lastSyncBlock: p.lastSync?.block ?? 0,
      lastSyncTx: p.lastSync?.tx ?? "",
    };
    reserves.cmp(`${p.address}.reserve0`, big(r.reserve0), p.reserve0, {}, sd);
    reserves.cmp(`${p.address}.reserve1`, big(r.reserve1), p.reserve1, {}, sd);
    supply.cmp(
      `${p.address}.totalLPTokenSupply`,
      big(r.totalLPTokenSupply),
      p.lpSupply,
      {},
      d,
    );
    const d0 = decimalsOf(ctx, p.token0);
    const d1 = decimalsOf(ctx, p.token1);
    const nFees = BigInt(p.counts.get("Fees") ?? 0);
    fees.cmp(
      `${p.address}.totalFeesGenerated0`,
      big(r.totalFeesGenerated0),
      to1e18(p.fees0, d0),
      { abs: d0 > 18 ? nFees : 0n },
      { ...d, decimals0: d0 },
    );
    fees.cmp(
      `${p.address}.totalFeesGenerated1`,
      big(r.totalFeesGenerated1),
      to1e18(p.fees1, d1),
      { abs: d1 > 18 ? nFees : 0n },
      { ...d, decimals1: d1 },
    );
    claims.cmp(
      `${p.address}.totalStakedFeesCollected0`,
      big(r.totalStakedFeesCollected0),
      p.claimStaked0,
      {},
      d,
    );
    claims.cmp(
      `${p.address}.totalStakedFeesCollected1`,
      big(r.totalStakedFeesCollected1),
      p.claimStaked1,
      {},
      d,
    );
    claims.cmp(
      `${p.address}.totalUnstakedFeesCollected0`,
      big(r.totalUnstakedFeesCollected0),
      p.claimUnstaked0,
      {},
      d,
    );
    claims.cmp(
      `${p.address}.totalUnstakedFeesCollected1`,
      big(r.totalUnstakedFeesCollected1),
      p.claimUnstaked1,
      {},
      d,
    );
    if (p.reserve0 > 0n && p.reserve1 > 0n) {
      let num: bigint;
      let den: bigint;
      if (p.stable) {
        const x = p.reserve0 * 10n ** BigInt(d1);
        const y = p.reserve1 * 10n ** BigInt(d0);
        num = y * (3n * x * x + y * y);
        den = x * (x * x + 3n * y * y);
      } else {
        num = p.reserve1 * 10n ** BigInt(d0);
        den = p.reserve0 * 10n ** BigInt(d1);
      }
      const [t0, t1] = ratioPair(num, den);
      ratios.cmp(
        `${p.address}.token0Price`,
        big(r.token0Price),
        t0,
        { rel: 1e-9, abs: 1n },
        { stable: p.stable ? 1 : 0, ...sd },
      );
      ratios.cmp(
        `${p.address}.token1Price`,
        big(r.token1Price),
        t1,
        { rel: 1e-9, abs: 1n },
        { stable: p.stable ? 1 : 0, ...sd },
      );
    }
  }

  // Contract state for a sample (and the fee rate for every V2 pool: one call each).
  if (ctx.rpc) {
    const B = ctx.truth.pinnedBlock;
    const sp = sample(pools, ctx.opts.sample, `v2state-${ctx.chainId}`);
    const res = await ctx.rpc.calls(
      B,
      sp.map((p) => ({ to: p.address, abi: V2_POOL_ABI, fn: "totalSupply" })),
    );
    sp.forEach((p, i) => {
      const s = res[i];
      const r = ctx.pools.get(p.address);
      if (s instanceof Error || !r) return;
      supply.cmp(
        `${p.address}.totalLPTokenSupply vs totalSupply()`,
        big(r.totalLPTokenSupply),
        s as bigint,
        {},
        { block: B },
      );
    });
    const fr = await ctx.rpc.calls(
      B,
      pools.map((p) => ({
        to: p.factory,
        abi: V2_FACTORY_ABI,
        fn: "getFee",
        args: [p.address, p.stable],
      })),
    );
    pools.forEach((p, i) => {
      const f = fr[i];
      const r = ctx.pools.get(p.address);
      if (!r) return;
      const eff = p.v2EffectiveFee;
      const det = {
        stable: p.stable ? 1 : 0,
        getFeeBps: f instanceof Error ? "error" : String(f),
        lastSwapFeeBps: eff ? String(eff.bps) : "-",
        lastSwapBlock: eff?.block ?? 0,
        lastSwapTx: eff?.tx ?? "",
      };
      if (f instanceof Error) return;
      const canonical = (f as bigint) * 100n;
      feeRate.cmp(`${p.address}.baseFee`, big(r.baseFee), canonical, {}, det);
      feeRate.cmp(
        `${p.address}.currentFee`,
        big(r.currentFee),
        canonical,
        {},
        det,
      );
    });
  } else {
    feeRate.skip("no RPC");
  }
  // The rate the last sizeable swap actually paid (independent of RPC).
  const paid = new Check(
    "pool.v2.fee-paid",
    ctx.chainId,
    "V2 Pool.currentFee equals the rate the pool's last swap with amountIn ≥ 1e7 actually paid: Fees.amount / amountIn of that swap, rounded to whole basis points, × 100.",
    "Exact after rounding to whole bps (the pool truncates fee = amountIn × bps / 10000; the rounding error is < 0.001 bps at that size).",
  );
  for (const p of pools) {
    const r = ctx.pools.get(p.address);
    if (!r || !p.v2EffectiveFee) continue;
    paid.cmp(
      `${p.address}.currentFee`,
      big(r.currentFee),
      p.v2EffectiveFee.bps * 100n,
      {},
      {
        stable: p.stable ? 1 : 0,
        block: p.v2EffectiveFee.block,
        tx: p.v2EffectiveFee.tx,
      },
    );
  }
  ctx.results.push(
    paid.done(
      `${pools.filter((p) => p.v2EffectiveFee).length} V2 pools with a sizeable swap`,
    ),
  );
  ctx.results.push(
    counts.done(
      `${pools.length} V2 pools, ${pools.reduce((a, p) => a + p.swaps, 0)} swaps on chain`,
    ),
  );
  ctx.results.push(reserves.done(`${pools.length} V2 pools`));
  ctx.results.push(supply.done(`${pools.length} V2 pools`));
  ctx.results.push(fees.done(`${pools.length} V2 pools`));
  ctx.results.push(claims.done(`${pools.length} V2 pools`));
  ctx.results.push(ratios.done(`${pools.length} V2 pools`));
  ctx.results.push(feeRate.done(`${pools.length} V2 pools`));
}

/**
 * CL pools: swaps, volumes, price/tick/liquidity, reserves vs principal held, fees,
 * collected fees, flash loans; plus contract state for a sample.
 * @param ctx - Check context
 * @returns Promise resolving when done
 */
export async function checkCLPools(ctx: CheckContext): Promise<void> {
  const pools = [...ctx.truth.pools.values()].filter(
    (p) => p.kind === "cl" && ctx.pools.has(p.address),
  );
  const counts = new Check(
    "pool.cl.swaps-volume",
    ctx.chainId,
    "CL Pool.numberOfSwaps, totalVolume0/1 equal the count of Swap logs and Σ|amount0|, Σ|amount1|.",
    "Exact.",
  );
  const price = new Check(
    "pool.cl.price-tick-liquidity",
    ctx.chainId,
    "CL Pool.sqrtPriceX96 and tick equal the last Swap (or Initialize); liquidityInRange equals Σ L of the positions (replayed from Mint/Burn) with tickLower ≤ tick < tickUpper, i.e. the pool's liquidity() (checked on-chain for a sample).",
    "Exact.",
  );
  const ratios = new Check(
    "pool.cl.price-ratio",
    ctx.chainId,
    "CL Pool.token0Price / token1Price equal (sqrtPriceX96/2^96)² in whole-token units with on-chain decimals, 1e18-scaled.",
    "Relative 1e-9.",
  );
  const reserves = new Check(
    "pool.cl.reserves",
    ctx.chainId,
    "CL Pool.reserve0/1 equal the principal held by all positions at the current price (Σ over replayed positions of the token amounts a full burn would return). The pool's token balance exceeds this by burned-but-uncollected principal, uncollected LP fees, gauge fees and direct donations; the details give that decomposition for a sample.",
    "Absolute 3 wei per Mint/Burn/Swap log plus 1 per position, or relative 1e-6: the pool rounds each mint up and each burn and swap step in its own favour, the indexer integrates swaps over its own tick map.",
  );
  const fees = new Check(
    "pool.cl.fees",
    ctx.chainId,
    "CL Pool.totalFeesGenerated0/1 (1e18-normalised) equal the swap fees implied by the logs: Σ Mint − Σ Burn + Σ Swap (signed, into the pool) − principal held now, per token. Pool.numberOfSwapFeeFallbacks must be 0 on a from-creation sync.",
    "Absolute 3 raw units per Swap plus 1 per position (same rounding as reserves), or relative 1e-6.",
  );
  const collected = new Check(
    "pool.cl.fees-collected",
    ctx.chainId,
    "CL Pool.totalUnstakedFeesCollected0/1 equal Σ Collect amounts above the position's burned-but-uncollected principal; totalStakedFeesCollected0/1 equal Σ CollectFees amounts.",
    "Exact.",
  );
  const flash = new Check(
    "pool.cl.flash",
    ctx.chainId,
    "CL Pool.numberOfFlashLoans and totalFlashLoanFees0/1 equal the count of Flash logs and Σ paid0/paid1.",
    "Exact.",
  );
  let maxRelRes = 0;
  let maxRelFee = 0;
  for (const p of pools) {
    const r = ctx.pools.get(p.address);
    if (!r) continue;
    const d = det(p);
    counts.cmp(
      `${p.address}.numberOfSwaps`,
      big(r.numberOfSwaps),
      BigInt(p.swaps),
      {},
      d,
    );
    counts.cmp(`${p.address}.totalVolume0`, big(r.totalVolume0), p.vol0, {}, d);
    counts.cmp(`${p.address}.totalVolume1`, big(r.totalVolume1), p.vol1, {}, d);
    const sd = {
      lastSwapBlock: p.lastSwap?.block ?? 0,
      lastSwapTx: p.lastSwap?.tx ?? "",
    };
    price.cmp(
      `${p.address}.sqrtPriceX96`,
      big(r.sqrtPriceX96),
      p.sqrtPriceX96,
      {},
      sd,
    );
    price.cmp(`${p.address}.tick`, big(r.tick), BigInt(p.tick), {}, sd);
    price.cmp(
      `${p.address}.liquidityInRange`,
      big(r.liquidityInRange),
      inRangeLiquidity(p),
      {},
      { ...sd, lastSwapLiquidity: String(p.lastSwapLiquidity ?? "") },
    );
    const d0 = decimalsOf(ctx, p.token0);
    const d1 = decimalsOf(ctx, p.token1);
    if (p.sqrtPriceX96 > 0n) {
      const [t0, t1] = ratioPair(
        p.sqrtPriceX96 * p.sqrtPriceX96 * 10n ** BigInt(d0),
        (1n << 192n) * 10n ** BigInt(d1),
      );
      ratios.cmp(
        `${p.address}.token0Price`,
        big(r.token0Price),
        t0,
        { rel: 1e-9, abs: 1n },
        sd,
      );
      ratios.cmp(
        `${p.address}.token1Price`,
        big(r.token1Price),
        t1,
        { rel: 1e-9, abs: 1n },
        sd,
      );
    }
    const held = principalHeld(p);
    const nEv = BigInt(
      (p.counts.get("Mint") ?? 0) + (p.counts.get("Burn") ?? 0) + p.swaps,
    );
    const tolR = { abs: 3n * nEv + BigInt(held.positions), rel: 1e-6 };
    reserves.cmp(
      `${p.address}.reserve0`,
      big(r.reserve0),
      held.amount0,
      tolR,
      d,
    );
    reserves.cmp(
      `${p.address}.reserve1`,
      big(r.reserve1),
      held.amount1,
      tolR,
      d,
    );
    maxRelRes = Math.max(
      maxRelRes,
      relDiff(big(r.reserve0), held.amount0),
      relDiff(big(r.reserve1), held.amount1),
    );
    const fee0 = p.sumMint0 - p.sumBurn0 + p.sumSwap0 - held.amount0;
    const fee1 = p.sumMint1 - p.sumBurn1 + p.sumSwap1 - held.amount1;
    const tolF = {
      abs: 3n * BigInt(p.swaps) + BigInt(held.positions),
      rel: 1e-6,
    };
    const idxFee0 = big(r.totalFeesGenerated0);
    const idxFee1 = big(r.totalFeesGenerated1);
    // Compare in raw units when the 1e18 scaling is an exact multiplication.
    if (d0 <= 18)
      fees.cmp(
        `${p.address}.totalFeesGenerated0 (raw)`,
        idxFee0 / 10n ** BigInt(18 - d0),
        fee0,
        tolF,
        { ...d, decimals: d0 },
      );
    else
      fees.cmp(
        `${p.address}.totalFeesGenerated0`,
        idxFee0,
        to1e18(fee0, d0),
        { ...tolF, abs: tolF.abs + BigInt(p.swaps) },
        d,
      );
    if (d1 <= 18)
      fees.cmp(
        `${p.address}.totalFeesGenerated1 (raw)`,
        idxFee1 / 10n ** BigInt(18 - d1),
        fee1,
        tolF,
        { ...d, decimals: d1 },
      );
    else
      fees.cmp(
        `${p.address}.totalFeesGenerated1`,
        idxFee1,
        to1e18(fee1, d1),
        { ...tolF, abs: tolF.abs + BigInt(p.swaps) },
        d,
      );
    if (d0 <= 18)
      maxRelFee = Math.max(
        maxRelFee,
        relDiff(idxFee0 / 10n ** BigInt(18 - d0), fee0),
      );
    if (d1 <= 18)
      maxRelFee = Math.max(
        maxRelFee,
        relDiff(idxFee1 / 10n ** BigInt(18 - d1), fee1),
      );
    fees.cmp(
      `${p.address}.numberOfSwapFeeFallbacks`,
      big(r.numberOfSwapFeeFallbacks),
      0n,
      {},
      d,
    );
    collected.cmp(
      `${p.address}.totalUnstakedFeesCollected0`,
      big(r.totalUnstakedFeesCollected0),
      p.collectedFees0,
      {},
      d,
    );
    collected.cmp(
      `${p.address}.totalUnstakedFeesCollected1`,
      big(r.totalUnstakedFeesCollected1),
      p.collectedFees1,
      {},
      d,
    );
    collected.cmp(
      `${p.address}.totalStakedFeesCollected0`,
      big(r.totalStakedFeesCollected0),
      p.sumCollectFees0,
      {},
      d,
    );
    collected.cmp(
      `${p.address}.totalStakedFeesCollected1`,
      big(r.totalStakedFeesCollected1),
      p.sumCollectFees1,
      {},
      d,
    );
    flash.cmp(
      `${p.address}.numberOfFlashLoans`,
      big(r.numberOfFlashLoans),
      BigInt(p.flashes),
      {},
      d,
    );
    flash.cmp(
      `${p.address}.totalFlashLoanFees0`,
      big(r.totalFlashLoanFees0),
      p.flashPaid0,
      {},
      d,
    );
    flash.cmp(
      `${p.address}.totalFlashLoanFees1`,
      big(r.totalFlashLoanFees1),
      p.flashPaid1,
      {},
      d,
    );
  }
  reserves.stats.maxRelativeDiff = maxRelRes;
  fees.stats.maxRelativeDiff = maxRelFee;

  // Contract state for a sample: slot0, liquidity, balances (decomposition of balance − reserve).
  if (ctx.rpc) {
    const B = ctx.truth.pinnedBlock;
    const sp = sample(
      pools.filter((p) => p.swaps > 0),
      ctx.opts.sample,
      `clstate-${ctx.chainId}`,
    );
    const res = await ctx.rpc.calls(
      B,
      sp.flatMap((p) => [
        { to: p.address, abi: CL_POOL_ABI, fn: "slot0" },
        { to: p.address, abi: CL_POOL_ABI, fn: "liquidity" },
        { to: p.token0, abi: ERC20_ABI, fn: "balanceOf", args: [p.address] },
        { to: p.token1, abi: ERC20_ABI, fn: "balanceOf", args: [p.address] },
        { to: p.address, abi: CL_POOL_ABI, fn: "gaugeFees" },
      ]),
    );
    sp.forEach((p, i) => {
      const r = ctx.pools.get(p.address);
      const s0 = res[5 * i] as readonly [bigint, number] | Error;
      const liq = res[5 * i + 1] as bigint | Error;
      const b0 = res[5 * i + 2] as bigint | Error;
      const b1 = res[5 * i + 3] as bigint | Error;
      const gf = res[5 * i + 4] as readonly [bigint, bigint] | Error;
      if (
        !r ||
        s0 instanceof Error ||
        liq instanceof Error ||
        b0 instanceof Error ||
        b1 instanceof Error
      )
        return;
      price.cmp(
        `${p.address}.sqrtPriceX96 vs slot0()`,
        big(r.sqrtPriceX96),
        s0[0],
        {},
        { block: B },
      );
      price.cmp(
        `${p.address}.liquidityInRange vs liquidity()`,
        big(r.liquidityInRange),
        liq,
        {},
        { block: B },
      );
      const held = principalHeld(p);
      let owed0 = 0n;
      let owed1 = 0n;
      for (const [o0, o1] of p.pendingPrincipal.values()) {
        owed0 += o0;
        owed1 += o1;
      }
      const fee0 = p.sumMint0 - p.sumBurn0 + p.sumSwap0 - held.amount0;
      const fee1 = p.sumMint1 - p.sumBurn1 + p.sumSwap1 - held.amount1;
      const feesHeld0 =
        fee0 + p.flashPaid0 - p.collectedFees0 - p.sumCollectFees0;
      const feesHeld1 =
        fee1 + p.flashPaid1 - p.collectedFees1 - p.sumCollectFees1;
      const logImplied0 =
        p.sumMint0 +
        p.sumSwap0 -
        p.sumCollect0 -
        p.sumCollectFees0 +
        p.flashPaid0;
      const logImplied1 =
        p.sumMint1 +
        p.sumSwap1 -
        p.sumCollect1 -
        p.sumCollectFees1 +
        p.flashPaid1;
      const nEv = BigInt(
        (p.counts.get("Mint") ?? 0) + (p.counts.get("Burn") ?? 0) + p.swaps,
      );
      const tol = { abs: 3n * nEv + BigInt(held.positions), rel: 1e-6 };
      const explained0 =
        big(r.reserve0) + owed0 + feesHeld0 + ((b0 as bigint) - logImplied0);
      const explained1 =
        big(r.reserve1) + owed1 + feesHeld1 + ((b1 as bigint) - logImplied1);
      reserves.cmp(
        `${p.address} balanceOf(token0) vs reserve0 + owed principal + unclaimed fees + donations`,
        explained0,
        b0 as bigint,
        tol,
        {
          balance: String(b0),
          reserve: String(r.reserve0),
          owedPrincipal: String(owed0),
          unclaimedFees: String(feesHeld0),
          gaugeFees: gf instanceof Error ? "?" : String(gf[0]),
          donations: String((b0 as bigint) - logImplied0),
          block: B,
        },
      );
      reserves.cmp(
        `${p.address} balanceOf(token1) vs reserve1 + owed principal + unclaimed fees + donations`,
        explained1,
        b1 as bigint,
        tol,
        {
          balance: String(b1),
          reserve: String(r.reserve1),
          owedPrincipal: String(owed1),
          unclaimedFees: String(feesHeld1),
          gaugeFees: gf instanceof Error ? "?" : String(gf[1]),
          donations: String((b1 as bigint) - logImplied1),
          block: B,
        },
      );
    });
    price.stats.rpcSample = sp.length;
  }
  void babs;
  ctx.results.push(
    counts.done(
      `${pools.length} CL pools, ${pools.reduce((a, p) => a + p.swaps, 0)} swaps on chain`,
    ),
  );
  ctx.results.push(price.done(`${pools.length} CL pools`));
  ctx.results.push(ratios.done(`${pools.length} CL pools`));
  ctx.results.push(
    reserves.done(
      `${pools.length} CL pools; max relative diff ${maxRelRes.toExponential(2)}`,
    ),
  );
  ctx.results.push(
    fees.done(
      `${pools.length} CL pools; max relative diff ${maxRelFee.toExponential(2)}`,
    ),
  );
  ctx.results.push(collected.done(`${pools.length} CL pools`));
  ctx.results.push(flash.done(`${pools.length} CL pools`));
}
