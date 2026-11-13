import type { EvmEvent, PoolTickMap, Token } from "envio";
import { processTickCrossings } from "../../Aggregators/CLStakedLiquidity";
import {
  type CLSwapFeeDerivation,
  deriveCLSwapFee,
} from "../../Aggregators/CLSwapFee";
import type { PoolDiff } from "../../Aggregators/Pool";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { FEE_SCALE } from "../../Constants";
import type { Pool, handlerContext } from "../../EntityTypes";
import {
  calculateLiquidityUSD,
  normalizeTokenAmountTo1e18,
  pickTrustedSwapVolumeUSD,
} from "../../Helpers";
import { abs } from "../../Maths";
import { deriveCLPriceRatios, pickPriceRatios } from "../../PoolPriceRatio";
import { getTrustedUSD } from "../../PriceTrust";

// Issue #733 / regression of #670: fees USD must respect the fundamental AMM
// invariant `cumulative_fees ≤ cumulative_volume × fee_ratio`. Pricing the fee
// off the input leg's `pricePerUSDNew` inherits poisoned/scam-token prices that
// the volume path already defends against via `pickTrustedSwapVolumeUSD` — this
// produced 160 Base pools with `totalFeesGeneratedUSD` up to 10²³× volume.
// Deriving fee USD from the already-trusted volume restores the invariant.
//
// Issue #861: pricing the fee from `min(t0_USD, t1_USD)` (the volume defender)
// systematically undercounts generated-fee USD by the per-swap slippage, so
// cumulative `totalFeesCollectedUSD` (priced from the actually-claimed
// input-side amounts at Collect time) drifted above `totalFeesGeneratedUSD`
// on 1,313 pools (Base + OP). The fee on-chain is charged on the INPUT leg,
// so the honest USD valuation is the input leg's trusted USD × feeRate. The
// min-pick fallback is preserved when the input leg is untrusted so the
// #733/#797 scam-token defence survives.

export interface CLPoolSwapResult {
  liquidityPoolDiff: Partial<PoolDiff>;
  userSwapDiff: Partial<UserStatsPerPoolDiff>;
}

interface SwapVolume {
  volumeInUSD: bigint;
}

interface SwapFees {
  swapFeesInToken0: bigint;
  swapFeesInToken1: bigint;
  swapFeesInUSD: bigint;
}

/** Compute fee amount in native token units from a CL fee rate and a swap amount. */
function computeClFeeAmount(amount: bigint, feeRate: bigint): bigint {
  return (abs(amount) * feeRate) / FEE_SCALE;
}

/**
 * Calculates swap volume in USD
 * Exported for testing purposes only
 */
export function calculateSwapVolume(
  event: EvmEvent<"CLPool", "Swap">,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): SwapVolume {
  // Per-leg USD via PriceTrust gate (issue #755): untrusted legs contribute
  // 0n. The min pick then guards against scam-token / poisoned-oracle
  // inflation on the remaining trusted leg (issues #699, #737).
  const token0UsdValue = getTrustedUSD(
    abs(event.params.amount0),
    token0Instance,
  );
  const token1UsdValue = getTrustedUSD(
    abs(event.params.amount1),
    token1Instance,
  );

  const volumeInUSD = pickTrustedSwapVolumeUSD(token0UsdValue, token1UsdValue);

  return {
    volumeInUSD,
  };
}

/**
 * Calculates swap fees.
 *
 * Raw fee amounts (`swapFeesInToken0`, `swapFeesInToken1`) are charged on the
 * input side of the swap only, normalized to 1e18 precision. They come from
 * `derivation` — the swap's own `amountIn − principalIn` (see
 * `src/Aggregators/CLSwapFee.ts`) — when it is present and accepted; otherwise
 * from the stored rate (`currentFee ?? baseFee`, FEE_SCALE 1e6) × amountIn,
 * which is the drift fallback. A zero rate is a legitimate zero-fee pool and
 * yields zero fees without logging.
 *
 * USD value (`swapFeesInUSD`) is the input leg's trusted USD scaled by the same
 * fee fraction (`feeIn / amountIn` when derived, `rate / FEE_SCALE` on the
 * fallback), restoring the AMM invariant `cumulative_fees ≤ cumulative_collected`
 * after slippage drift (issue #861). Falls back to the min-protected
 * `volumeInUSD` when the input leg is untrusted, preserving the
 * `pickTrustedSwapVolumeUSD` defence against poisoned-price tokens (issue #733).
 *
 * Exported for testing purposes only.
 *
 * @param event - CLPool Swap event
 * @param liquidityPoolAggregator - Pool entity providing the stored (fallback) fee rate
 * @param token0Instance - Token0 for decimals lookup (price unused for USD)
 * @param token1Instance - Token1 for decimals lookup (price unused for USD)
 * @param volumeInUSD - Already-trusted swap volume in USD (from `calculateSwapVolume`)
 * @param derivation - Swap-derived fee from `deriveCLSwapFee`; when omitted or
 *   rejected (`ok: false`) the stored rate is used
 * @returns Raw token-unit fees plus invariant-respecting USD fee
 */
export function calculateSwapFees(
  event: EvmEvent<"CLPool", "Swap">,
  liquidityPoolAggregator: Pool,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  volumeInUSD: bigint,
  derivation?: CLSwapFeeDerivation,
): SwapFees {
  // Fee in native token units plus the fee fraction (num / den) of the input
  // leg, used to scale the USD value below. Fees are ONLY charged on the input
  // token (positive amount); the output token (negative amount) has no fee.
  let swapFeesInToken0Raw: bigint;
  let swapFeesInToken1Raw: bigint;
  let feeFractionNum: bigint;
  let feeFractionDen: bigint;
  if (derivation?.ok) {
    swapFeesInToken0Raw = derivation.feeAmount0;
    swapFeesInToken1Raw = derivation.feeAmount1;
    feeFractionNum = derivation.feeAmount0 + derivation.feeAmount1;
    feeFractionDen = derivation.amountIn;
  } else {
    // Stored rate, CL scale 1e6 (100 = 0.01%, 500 = 0.05%, 3000 = 0.30%).
    const fee =
      liquidityPoolAggregator.currentFee ??
      liquidityPoolAggregator.baseFee ??
      0n;
    swapFeesInToken0Raw =
      event.params.amount0 > 0n
        ? computeClFeeAmount(event.params.amount0, fee)
        : 0n;
    swapFeesInToken1Raw =
      event.params.amount1 > 0n
        ? computeClFeeAmount(event.params.amount1, fee)
        : 0n;
    feeFractionNum = fee;
    feeFractionDen = FEE_SCALE;
  }

  // Normalize fees to 1e18 precision using helper function
  const token0Decimals = Number(token0Instance?.decimals ?? 18);
  const token1Decimals = Number(token1Instance?.decimals ?? 18);
  const swapFeesInToken0 = normalizeTokenAmountTo1e18(
    swapFeesInToken0Raw,
    token0Decimals,
  );
  const swapFeesInToken1 = normalizeTokenAmountTo1e18(
    swapFeesInToken1Raw,
    token1Decimals,
  );

  if (feeFractionNum === 0n || feeFractionDen === 0n) {
    return { swapFeesInToken0, swapFeesInToken1, swapFeesInUSD: 0n };
  }

  // Derive fee USD from the INPUT leg's trusted USD (where the fee was
  // actually charged on-chain), but only when it agrees with the other leg
  // within SLIPPAGE_TOLERANCE (10×) — well above realistic AMM slippage but
  // small enough to catch poisoned prices that are typically 1e10× or worse.
  // When input is untrusted OR is wildly out of band with the counterparty,
  // fall back to the min-protected `volumeInUSD` so #733/#797's scam-token
  // defence survives. See file header for the #861 rationale.
  //
  // Token-price guards: `getTrustedUSD` would crash on a token whose
  // `pricePerUSDNew` is undefined (latent invariant in PriceTrust.ts) — the
  // pre-condition is enforced inline here so this fix does not regress test
  // fixtures that simulate broken-price states.
  const inputIsToken0 = event.params.amount0 > 0n;
  const safeTrustedUSD = (amount: bigint, token: Token | undefined): bigint => {
    if (!token || token.pricePerUSDNew === undefined) return 0n;
    return getTrustedUSD(amount, token);
  };
  const inputUsdValue = inputIsToken0
    ? safeTrustedUSD(abs(event.params.amount0), token0Instance)
    : safeTrustedUSD(abs(event.params.amount1), token1Instance);
  const counterUsdValue = inputIsToken0
    ? safeTrustedUSD(abs(event.params.amount1), token1Instance)
    : safeTrustedUSD(abs(event.params.amount0), token0Instance);
  const SLIPPAGE_TOLERANCE = 10n;
  const inputIsCredible =
    inputUsdValue !== 0n &&
    (counterUsdValue === 0n ||
      inputUsdValue <= counterUsdValue * SLIPPAGE_TOLERANCE);
  const feeBaseUSD = inputIsCredible ? inputUsdValue : volumeInUSD;
  const swapFeesInUSD = (feeBaseUSD * feeFractionNum) / feeFractionDen;

  return {
    swapFeesInToken0,
    swapFeesInToken1,
    swapFeesInUSD,
  };
}

/**
 * Computes the pool and user diffs for a CL Swap: volume, swap-derived fee,
 * fee-free reserve deltas, staked-share deltas and the post-swap price state.
 *
 * The fee comes from the swap itself (`amountIn − principalIn`, see
 * `src/Aggregators/CLSwapFee.ts`) — no RPC. When the tick-map walk disagrees
 * with the event (ending liquidity ≠ `event.params.liquidity`) or the derived
 * fee is negative or above 10% of the input, the swap is valued with the stored
 * rate instead, `numberOfSwapFeeFallbacks` is incremented, and the first such
 * swap of a pool logs one `[CL_SWAP_FEE_FALLBACK]` warning. An accepted swap
 * large enough to measure its rate writes it to `currentFee`.
 *
 * The tick maps are read, never written: a swap does not change them.
 *
 * @param event - CLPool Swap event
 * @param liquidityPoolAggregator - Pool state before the swap
 * @param token0Instance - Token0 (decimals and price)
 * @param token1Instance - Token1 (decimals and price)
 * @param context - Handler context, used for logging only
 * @param tickMap - The pool's PoolTickMap (`loadPoolTickMap`); defaults to
 *   empty maps (no Mint / stake seen)
 * @returns The pool diff and the swapper's user-stats diff
 */
export async function processCLPoolSwap(
  event: EvmEvent<"CLPool", "Swap">,
  liquidityPoolAggregator: Pool,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  context: handlerContext,
  tickMap: PoolTickMap = {
    id: liquidityPoolAggregator.id,
    tickEdges: [],
    tickEdgeNets: [],
    stakedTickEdges: [],
    stakedTickEdgeNets: [],
  },
): Promise<CLPoolSwapResult> {
  const { volumeInUSD } = calculateSwapVolume(
    event,
    token0Instance,
    token1Instance,
  );

  // #803: derive the swap's reserve delta from pool geometry (fee-free) rather
  // than the stale-fee approximation `amount − currentFee·amount`. The pool's
  // sqrtPrice move, integrated over the TOTAL per-tick liquidity map, is the
  // exact principal token flow (Δ1 = L·ΔsqrtPrice/Q96, Δ0 = L·ΔsqrtPrice·Q96/
  // (S_a·S_b)); the fee never moves the price, so it is excluded by construction.
  // This is the same edge-walk as the staked share (#666); it walks initialized
  // edges directly (binary search) with no per-tick step cap.
  //
  // Seed: the walk starts from the cached pre-swap in-range liquidity (the last
  // Swap's event liquidity plus in-range Mint/Burn deltas, exactly the pool's
  // on-chain liquidity()), so it touches only the crossed edges instead of
  // summing the whole map. If the walk then ends on a different liquidity than
  // the event reports, the swap is re-walked from the map-derived seed
  // (`deriveLiquidityInRange`, the previous behaviour) and that result is kept.
  //
  // Edge-map completeness: if the map is empty — e.g. a partial-history sync
  // whose start block postdates the pool's Mints — the seed is 0n and swaps
  // contribute no reserve delta (and the fee falls back to the stored rate).
  // That is consistent with the reserve accumulator's full-history requirement
  // (those pre-start Mints' principal would be absent from reserve0/1 too); a
  // from-creation sync always has a complete map.
  const oldTick = liquidityPoolAggregator.tick ?? 0n;
  const oldSqrtPriceX96 = liquidityPoolAggregator.sqrtPriceX96 ?? 0n;
  const cachedLiquidity = liquidityPoolAggregator.liquidityInRange ?? 0n;
  const hasTotalMap = tickMap.tickEdges.length > 0;
  const walkTotal = (seed: bigint | undefined) =>
    processTickCrossings(
      event.chainId,
      event.srcAddress,
      oldTick,
      event.params.tick,
      oldSqrtPriceX96,
      event.params.sqrtPriceX96,
      liquidityPoolAggregator.tickSpacing,
      context,
      cachedLiquidity,
      hasTotalMap,
      tickMap.tickEdges,
      tickMap.tickEdgeNets,
      "total",
      seed,
    );
  let totalCrossings = walkTotal(hasTotalMap ? cachedLiquidity : 0n);
  if (
    hasTotalMap &&
    totalCrossings.liquidityInRange !== event.params.liquidity
  ) {
    totalCrossings = walkTotal(undefined);
  }
  const reserveDelta0 = totalCrossings.delta0;
  const reserveDelta1 = totalCrossings.delta1;

  // Swap-derived fee: amountIn − principalIn on the input token, guarded by the
  // event's authoritative post-swap liquidity (drift check).
  const feeDerivation = deriveCLSwapFee({
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    principal0: reserveDelta0,
    principal1: reserveDelta1,
    walkEndLiquidity: totalCrossings.liquidityInRange,
    eventLiquidity: event.params.liquidity,
  });
  if (
    !feeDerivation.ok &&
    (liquidityPoolAggregator.numberOfSwapFeeFallbacks ?? 0n) === 0n
  ) {
    context.log.warn(
      `[CL_SWAP_FEE_FALLBACK] pool=${event.srcAddress} chain=${event.chainId} block=${event.block.number} reason=${feeDerivation.reason} derivedFee=${feeDerivation.derivedFee} amountIn=${feeDerivation.amountIn} walkLiquidity=${totalCrossings.liquidityInRange} eventLiquidity=${event.params.liquidity} storedFee=${liquidityPoolAggregator.currentFee}. Valuing with the stored rate; logged once per pool, see Pool.numberOfSwapFeeFallbacks for the count.`,
    );
  }
  const { swapFeesInToken0, swapFeesInToken1, swapFeesInUSD } =
    calculateSwapFees(
      event,
      liquidityPoolAggregator,
      token0Instance,
      token1Instance,
      volumeInUSD,
      feeDerivation,
    );
  const newReserve0 = liquidityPoolAggregator.reserve0 + reserveDelta0;
  const newReserve1 = liquidityPoolAggregator.reserve1 + reserveDelta1;

  // Staked-share tracking (#666). Same edge-walk math, but over the staked-only
  // edge map, producing the staked slice of the reserve deltas. Seeded from the
  // cached stakedLiquidityInRange — every writer stores the map-derived value at
  // the current tick (gauge / NFPM / CLPool Mint & Burn derive it, swaps walk
  // it) — unless updatePool may have clamped it (#891: clamped to
  // liquidityInRange, so staked === total) or it is zero (also the #719
  // negative floor); then it is re-derived from the map (#719 self-healing).
  const cachedStakedLiquidity =
    liquidityPoolAggregator.stakedLiquidityInRange ?? 0n;
  const stakedSeed =
    liquidityPoolAggregator.hasStakes &&
    cachedStakedLiquidity > 0n &&
    cachedStakedLiquidity < cachedLiquidity
      ? cachedStakedLiquidity
      : undefined;
  const {
    liquidityInRange: stakedLiquidityInRange,
    delta0: stakedDelta0,
    delta1: stakedDelta1,
  } = processTickCrossings(
    event.chainId,
    event.srcAddress,
    oldTick,
    event.params.tick,
    oldSqrtPriceX96,
    event.params.sqrtPriceX96,
    liquidityPoolAggregator.tickSpacing,
    context,
    cachedStakedLiquidity,
    liquidityPoolAggregator.hasStakes,
    tickMap.stakedTickEdges,
    tickMap.stakedTickEdgeNets,
    "staked",
    stakedSeed,
  );

  // token0Price/token1Price are the pool-internal exchange rate, derived from
  // the swap's post-trade sqrtPriceX96 — NOT from token oracle prices. This
  // keeps the ratio oracle-independent so a mispriced token (e.g. a non-WL
  // scam token) can no longer inflate it without bound (#783). pickPriceRatios
  // falls back to the last-known ratio per leg when decimals are unavailable.
  const priceRatios = pickPriceRatios(
    token0Instance && token1Instance
      ? deriveCLPriceRatios(
          event.params.sqrtPriceX96,
          token0Instance.decimals,
          token1Instance.decimals,
        )
      : { token0Price: 0n, token1Price: 0n },
    liquidityPoolAggregator,
  );

  // Issue #892: directional TVL cap against a hard-anchor counterparty. Computed
  // after priceRatios so the cap uses the swap's post-trade pool ratio (the same
  // ratio written to the diff) as the pool-implied witness.
  const currentTotalLiquidityUSD = calculateLiquidityUSD(
    newReserve0,
    newReserve1,
    token0Instance,
    token1Instance,
    priceRatios.token0Price,
    priceRatios.token1Price,
    event.chainId,
  );

  // Build complete liquidity pool aggregator diff
  const liquidityPoolDiff = {
    incrementalTotalVolume0: abs(event.params.amount0),
    incrementalTotalVolume1: abs(event.params.amount1),
    incrementalTotalVolumeUSD: volumeInUSD,
    incrementalTotalFeesGenerated0: swapFeesInToken0,
    incrementalTotalFeesGenerated1: swapFeesInToken1,
    incrementalTotalFeesGeneratedUSD: swapFeesInUSD,
    token0Price: priceRatios.token0Price,
    token1Price: priceRatios.token1Price,
    incrementalNumberOfSwaps: 1n,
    incrementalNumberOfSwapFeeFallbacks: feeDerivation.ok ? 0n : 1n,
    // Effective rate of this swap (FEE_SCALE 1e6), when it is large enough to
    // measure; otherwise the previous rate stays.
    ...(feeDerivation.ok && feeDerivation.feeRate !== undefined
      ? { currentFee: feeDerivation.feeRate }
      : {}),
    incrementalReserve0: reserveDelta0,
    incrementalReserve1: reserveDelta1,
    currentTotalLiquidityUSD,
    sqrtPriceX96: event.params.sqrtPriceX96,
    tick: event.params.tick,
    liquidityInRange: event.params.liquidity,
    stakedLiquidityInRange,
    incrementalStakedReserve0: stakedDelta0,
    incrementalStakedReserve1: stakedDelta1,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  const userSwapDiff = {
    incrementalNumberOfSwaps: 1n, // Each swap event represents 1 swap
    incrementalTotalSwapVolumeUSD: volumeInUSD,
    incrementalTotalSwapVolumeAmount0: abs(event.params.amount0),
    incrementalTotalSwapVolumeAmount1: abs(event.params.amount1),
    incrementalTotalFeesContributed0: swapFeesInToken0,
    incrementalTotalFeesContributed1: swapFeesInToken1,
    incrementalTotalFeesContributedUSD: swapFeesInUSD,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userSwapDiff,
  };
}
