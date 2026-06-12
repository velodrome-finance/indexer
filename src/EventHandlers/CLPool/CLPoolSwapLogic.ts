import type { EvmEvent, Token } from "envio";
import { processTickCrossings } from "../../Aggregators/CLStakedLiquidity";
import type { PoolDiff } from "../../Aggregators/Pool";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { FEE_SCALE } from "../../Constants";
import type { Pool, handlerContext } from "../../EntityTypes";
import {
  calculateTotalUSD,
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

interface SwapVolumeAndFees {
  volumeInUSD: bigint;
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
 * Raw fee amounts (`swapFeesInToken0`, `swapFeesInToken1`) come directly from the
 * input side of the swap and the pool's fee rate, normalized to 1e18 precision.
 * USD value (`swapFeesInUSD`) is derived from the input-leg's trusted USD —
 * `inputUsdValue × feeRate / FEE_SCALE` — restoring the AMM invariant
 * `cumulative_fees ≤ cumulative_collected` after slippage drift (issue #861).
 * Falls back to the min-protected `volumeInUSD` when the input leg is
 * untrusted, preserving the `pickTrustedSwapVolumeUSD` defence against
 * poisoned-price tokens (issue #733).
 *
 * Exported for testing purposes only.
 *
 * @param event - CLPool Swap event
 * @param liquidityPoolAggregator - Pool entity providing the fee rate
 * @param token0Instance - Token0 for decimals lookup (price unused for USD)
 * @param token1Instance - Token1 for decimals lookup (price unused for USD)
 * @param volumeInUSD - Already-trusted swap volume in USD (from `calculateSwapVolume`)
 * @param context - Handler context for error logging
 * @returns Raw token-unit fees plus invariant-respecting USD fee
 */
export function calculateSwapFees(
  event: EvmEvent<"CLPool", "Swap">,
  liquidityPoolAggregator: Pool,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  volumeInUSD: bigint,
  context: handlerContext,
): SwapFees {
  // Get the current fee, falling back to baseFee if currentFee is undefined
  const fee =
    liquidityPoolAggregator.currentFee ?? liquidityPoolAggregator.baseFee;

  if (!fee) {
    context.log.error(
      `[calculateSwapFees] Pool ${liquidityPoolAggregator.id} on chain ${event.chainId} has ${liquidityPoolAggregator.currentFee} for currentFee and ${liquidityPoolAggregator.baseFee} for baseFee. Cannot calculate swap fees.`,
    );
    // Set fees to 0 if fee is undefined (should not happen in practice)
    return {
      swapFeesInToken0: 0n,
      swapFeesInToken1: 0n,
      swapFeesInUSD: 0n,
    };
  }

  // Calculate fees in token native units — fees are ONLY charged on the input token
  // (positive amount). The output token (negative amount) has no fee.
  // CL fee is in hundredths of a basis point (1e6 scale): 100 = 0.01%, 500 = 0.05%, 3000 = 0.30%
  const swapFeesInToken0Raw =
    event.params.amount0 > 0n
      ? computeClFeeAmount(event.params.amount0, fee)
      : 0n;
  const swapFeesInToken1Raw =
    event.params.amount1 > 0n
      ? computeClFeeAmount(event.params.amount1, fee)
      : 0n;

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
  const swapFeesInUSD = (feeBaseUSD * fee) / FEE_SCALE;

  return {
    swapFeesInToken0,
    swapFeesInToken1,
    swapFeesInUSD,
  };
}

/**
 * Calculates swap volume and fees
 * Fees are stored in 1e18 precision (like USD values) to preserve accuracy
 */
function calculateSwapVolumeAndFees(
  event: EvmEvent<"CLPool", "Swap">,
  liquidityPoolAggregator: Pool,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  context: handlerContext,
): SwapVolumeAndFees {
  const { volumeInUSD } = calculateSwapVolume(
    event,
    token0Instance,
    token1Instance,
  );

  const { swapFeesInToken0, swapFeesInToken1, swapFeesInUSD } =
    calculateSwapFees(
      event,
      liquidityPoolAggregator,
      token0Instance,
      token1Instance,
      volumeInUSD,
      context,
    );

  return {
    volumeInUSD,
    swapFeesInToken0,
    swapFeesInToken1,
    swapFeesInUSD,
  };
}

export async function processCLPoolSwap(
  event: EvmEvent<"CLPool", "Swap">,
  liquidityPoolAggregator: Pool,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  context: handlerContext,
): Promise<CLPoolSwapResult> {
  // Calculate volume and fees
  const { volumeInUSD, swapFeesInToken0, swapFeesInToken1, swapFeesInUSD } =
    calculateSwapVolumeAndFees(
      event,
      liquidityPoolAggregator,
      token0Instance,
      token1Instance,
      context,
    );

  // #803: derive the swap's reserve delta from pool geometry (fee-free) rather
  // than the stale-fee approximation `amount − currentFee·amount`. The pool's
  // sqrtPrice move, integrated over the TOTAL per-tick liquidity map, is the
  // exact principal token flow (Δ1 = L·ΔsqrtPrice/Q96, Δ0 = L·ΔsqrtPrice·Q96/
  // (S_a·S_b)); the fee never moves the price, so it is excluded by construction.
  // This is the same edge-walk as the staked share (#666), seeded from the total
  // edge map via deriveLiquidityInRange — so it stays correct even when the
  // price starts at a boundary tick where the cached liquidityInRange is 0, and
  // it walks initialized edges directly (binary search) with no per-tick step cap.
  //
  // Edge-map completeness: the seed comes from tickEdges (built by Mint/Burn from
  // pool creation), NOT from the cached liquidityInRange. If the map is empty —
  // e.g. a partial-history sync whose start block postdates the pool's Mints — the
  // seed is 0n and swaps contribute no reserve delta. That is consistent with the
  // reserve accumulator's full-history requirement (those pre-start Mints' principal
  // would be absent from reserve0/1 too); a from-creation sync always has a complete map.
  const totalCrossings = processTickCrossings(
    event.chainId,
    event.srcAddress,
    liquidityPoolAggregator.tick ?? 0n,
    event.params.tick,
    liquidityPoolAggregator.sqrtPriceX96 ?? 0n,
    event.params.sqrtPriceX96,
    liquidityPoolAggregator.tickSpacing,
    context,
    liquidityPoolAggregator.liquidityInRange ?? 0n,
    liquidityPoolAggregator.tickEdges.length > 0,
    liquidityPoolAggregator.tickEdges,
    liquidityPoolAggregator.tickEdgeNets,
    "total",
  );
  const reserveDelta0 = totalCrossings.delta0;
  const reserveDelta1 = totalCrossings.delta1;
  const newReserve0 = liquidityPoolAggregator.reserve0 + reserveDelta0;
  const newReserve1 = liquidityPoolAggregator.reserve1 + reserveDelta1;
  const currentTotalLiquidityUSD = calculateTotalUSD(
    newReserve0,
    newReserve1,
    token0Instance,
    token1Instance,
  );

  // Staked-share tracking (#666) — unchanged. Same edge-walk math, but over the
  // staked-only edge map, producing the staked slice of the reserve deltas.
  const {
    liquidityInRange: stakedLiquidityInRange,
    delta0: stakedDelta0,
    delta1: stakedDelta1,
  } = processTickCrossings(
    event.chainId,
    event.srcAddress,
    liquidityPoolAggregator.tick ?? 0n,
    event.params.tick,
    liquidityPoolAggregator.sqrtPriceX96 ?? 0n,
    event.params.sqrtPriceX96,
    liquidityPoolAggregator.tickSpacing,
    context,
    liquidityPoolAggregator.stakedLiquidityInRange ?? 0n,
    liquidityPoolAggregator.hasStakes,
    liquidityPoolAggregator.stakedTickEdges,
    liquidityPoolAggregator.stakedTickEdgeNets,
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
