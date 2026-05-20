import type { CLPool_Swap_event, Token, handlerContext } from "generated";
import { processTickCrossingsForStaked } from "../../Aggregators/CLStakedLiquidity";
import type { PoolDiff } from "../../Aggregators/Pool";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { CL_FEE_SCALE } from "../../Constants";
import type { Pool } from "../../EntityTypes";
import {
  calculateTotalUSD,
  normalizeTokenAmountTo1e18,
  pickTrustedSwapVolumeUSD,
} from "../../Helpers";
import { abs } from "../../Maths";
import { getTrustedUSD } from "../../PriceTrust";

// Issue #733 / regression of #670: fees USD must respect the fundamental AMM
// invariant `cumulative_fees ≤ cumulative_volume × fee_ratio`. Pricing the fee
// off the input leg's `pricePerUSDNew` inherits poisoned/scam-token prices that
// the volume path already defends against via `pickTrustedSwapVolumeUSD` — this
// produced 160 Base pools with `totalFeesGeneratedUSD` up to 10²³× volume.
// Deriving fee USD from the already-trusted volume restores the invariant.

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

interface SwapLiquidityChanges {
  newReserve0: bigint;
  newReserve1: bigint;
  currentTotalLiquidityUSD: bigint;
}

/** Compute fee amount in native token units from a CL fee rate and a swap amount. */
function computeClFeeAmount(amount: bigint, feeRate: bigint): bigint {
  return (abs(amount) * feeRate) / CL_FEE_SCALE;
}

/**
 * Calculates swap volume in USD
 * Exported for testing purposes only
 */
export function calculateSwapVolume(
  event: CLPool_Swap_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): SwapVolume {
  // Per-leg USD via PriceTrust gate (issue #755): untrusted legs contribute
  // 0n. The min pick then guards against scam-token / poisoned-oracle
  // inflation on the remaining trusted leg (issues #699, #737).
  const token0UsdValue = getTrustedUSD(abs(event.params.amount0), token0Instance);
  const token1UsdValue = getTrustedUSD(abs(event.params.amount1), token1Instance);

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
 * USD value (`swapFeesInUSD`) is derived from the already-trusted `volumeInUSD`
 * via `volumeInUSD × feeRate / CL_FEE_SCALE` — this enforces the AMM invariant
 * `fees ≤ volume × feeRate` by construction and inherits the volume path's
 * `pickTrustedSwapVolumeUSD` defense against poisoned-price tokens (issue #733).
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
  event: CLPool_Swap_event,
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

  // Derive fee USD from trusted volume — see file header for the #733 rationale.
  const swapFeesInUSD = (volumeInUSD * fee) / CL_FEE_SCALE;

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
  event: CLPool_Swap_event,
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

/**
 * Calculates liquidity and reserve changes from a swap event.
 *
 * TVL definition: reserves track **LP-deposited capital only** (Mint/Burn/Swap rebalancing).
 * Swap fees are excluded because they are protocol/LP earnings, not deposited capital.
 * In the CLPool contract, swap event amounts (amount0/amount1) include fees — the fee
 * portion flows into gaugeFees or feeGrowthGlobal, not into any LP position's liquidity.
 * The fee is only charged on the **input token** (the positive amount side), confirmed by
 * SwapMath.computeSwapStep which computes feeAmount solely from amountIn.
 * We subtract the fee from the input side only so that:
 *   - Mint: reserves += deposited amounts
 *   - Burn: reserves -= withdrawn amounts (tokens stay in contract as tokensOwed until collect)
 *   - Swap: reserves += net rebalancing (input-side fee excluded, output side unchanged)
 *   - Collect/CollectFees: no reserve change (fees were never in reserves)
 *
 * Exported for testing purposes only.
 */
export function calculateSwapLiquidityChanges(
  event: CLPool_Swap_event,
  liquidityPoolAggregator: Pool,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  clFeeRate: bigint,
): SwapLiquidityChanges {
  // Subtract fees only from the input token (positive amount). The output token
  // (negative amount) is not fee-charged — see SwapMath.computeSwapStep.
  const reserveDelta0 =
    event.params.amount0 > 0n
      ? event.params.amount0 -
        computeClFeeAmount(event.params.amount0, clFeeRate)
      : event.params.amount0;
  const reserveDelta1 =
    event.params.amount1 > 0n
      ? event.params.amount1 -
        computeClFeeAmount(event.params.amount1, clFeeRate)
      : event.params.amount1;

  const newReserve0 = liquidityPoolAggregator.reserve0 + reserveDelta0;
  const newReserve1 = liquidityPoolAggregator.reserve1 + reserveDelta1;

  const currentTotalLiquidityUSD = calculateTotalUSD(
    newReserve0,
    newReserve1,
    token0Instance,
    token1Instance,
  );

  return {
    newReserve0,
    newReserve1,
    currentTotalLiquidityUSD,
  };
}

export async function processCLPoolSwap(
  event: CLPool_Swap_event,
  liquidityPoolAggregator: Pool,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  context: handlerContext,
): Promise<CLPoolSwapResult> {
  // Calculate volume and fees
  const {
    volumeInUSD,
    swapFeesInToken0,
    swapFeesInToken1,
    swapFeesInUSD,
  } = calculateSwapVolumeAndFees(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
    context,
  );

  // Calculate liquidity and reserve changes (fees excluded from reserves — see function docs)
  const clFeeRate =
    liquidityPoolAggregator.currentFee ?? liquidityPoolAggregator.baseFee ?? 0n;
  const { newReserve0, newReserve1, currentTotalLiquidityUSD } =
    calculateSwapLiquidityChanges(
      event,
      liquidityPoolAggregator,
      token0Instance,
      token1Instance,
      clFeeRate,
    );

  // Process tick crossings for staked liquidity tracking AND compute the
  // per-segment staked share of the swap's reserve deltas. The walk and the
  // attribution share the same edge sweep — see CLStakedLiquidity.ts for the
  // per-segment Uniswap v3 math (fix for #666).
  const reserveDelta0 = newReserve0 - liquidityPoolAggregator.reserve0;
  const reserveDelta1 = newReserve1 - liquidityPoolAggregator.reserve1;
  const { stakedLiquidityInRange, stakedDelta0, stakedDelta1 } =
    processTickCrossingsForStaked(
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

  // Build complete liquidity pool aggregator diff
  const liquidityPoolDiff = {
    incrementalTotalVolume0: abs(event.params.amount0),
    incrementalTotalVolume1: abs(event.params.amount1),
    incrementalTotalVolumeUSD: volumeInUSD,
    incrementalTotalFeesGenerated0: swapFeesInToken0,
    incrementalTotalFeesGenerated1: swapFeesInToken1,
    incrementalTotalFeesGeneratedUSD: swapFeesInUSD,
    token0Price:
      token0Instance?.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
    token1Price:
      token1Instance?.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
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
