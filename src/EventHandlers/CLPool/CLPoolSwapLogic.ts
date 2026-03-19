import type {
  CLPool_Swap_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { CL_FEE_SCALE } from "../../Constants";
import {
  calculateTokenAmountUSD,
  calculateTotalUSD,
  normalizeTokenAmountTo1e18,
} from "../../Helpers";
import { abs } from "../../Maths";

export interface CLPoolSwapResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userSwapDiff: Partial<UserStatsPerPoolDiff>;
}

interface SwapVolume {
  volumeInUSD: bigint;
  volumeInUSDWhitelisted: bigint;
}

interface SwapFees {
  swapFeesInToken0: bigint;
  swapFeesInToken1: bigint;
  swapFeesInUSD: bigint;
}

interface SwapVolumeAndFees {
  volumeInUSD: bigint;
  volumeInUSDWhitelisted: bigint;
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
  // Calculate volume in USD using already-refreshed token prices from loadPoolData
  const token0UsdValue = token0Instance
    ? calculateTokenAmountUSD(
        abs(event.params.amount0),
        Number(token0Instance.decimals),
        token0Instance.pricePerUSDNew,
      )
    : 0n;

  const token1UsdValue = token1Instance
    ? calculateTokenAmountUSD(
        abs(event.params.amount1),
        Number(token1Instance.decimals),
        token1Instance.pricePerUSDNew,
      )
    : 0n;

  // Calculate volume in USD (use token0 if available and non-zero, otherwise token1)
  const volumeInUSD = token0UsdValue !== 0n ? token0UsdValue : token1UsdValue;

  // Calculate whitelisted volume (at least one token must be whitelisted,
  // consistent with calculateWhitelistedFeesUSD which uses the same rule)
  const volumeInUSDWhitelisted =
    token0Instance?.isWhitelisted || token1Instance?.isWhitelisted
      ? volumeInUSD
      : 0n;

  return {
    volumeInUSD,
    volumeInUSDWhitelisted,
  };
}

/**
 * Calculates swap fees
 * Fees are stored in 1e18 precision (like USD values) to preserve accuracy
 * Exported for testing purposes only
 */
export function calculateSwapFees(
  event: CLPool_Swap_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
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

  // Calculate fees in token native units
  // CL fee is in hundredths of a basis point (1e6 scale): 100 = 0.01%, 500 = 0.05%, 3000 = 0.30%
  const swapFeesInToken0Raw = computeClFeeAmount(event.params.amount0, fee);
  const swapFeesInToken1Raw = computeClFeeAmount(event.params.amount1, fee);

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

  // Calculate USD value using helper function
  // Helper handles normalization and USD conversion in one step
  const swapFeesInUSD =
    token0Instance?.pricePerUSDNew !== 0n &&
    token0Instance?.pricePerUSDNew !== undefined
      ? calculateTokenAmountUSD(
          swapFeesInToken0Raw,
          token0Decimals,
          token0Instance.pricePerUSDNew,
        )
      : token1Instance?.pricePerUSDNew !== undefined
        ? calculateTokenAmountUSD(
            swapFeesInToken1Raw,
            token1Decimals,
            token1Instance.pricePerUSDNew,
          )
        : 0n;

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
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  context: handlerContext,
): SwapVolumeAndFees {
  const { volumeInUSD, volumeInUSDWhitelisted } = calculateSwapVolume(
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
      context,
    );

  return {
    volumeInUSD,
    volumeInUSDWhitelisted,
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
  liquidityPoolAggregator: LiquidityPoolAggregator,
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
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  context: handlerContext,
): Promise<CLPoolSwapResult> {
  // Calculate volume and fees
  const {
    volumeInUSD,
    volumeInUSDWhitelisted,
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

  // Build complete liquidity pool aggregator diff
  const liquidityPoolDiff = {
    incrementalTotalVolume0: abs(event.params.amount0),
    incrementalTotalVolume1: abs(event.params.amount1),
    incrementalTotalVolumeUSD: volumeInUSD,
    incrementalTotalVolumeUSDWhitelisted: volumeInUSDWhitelisted,
    incrementalTotalFeesGenerated0: swapFeesInToken0,
    incrementalTotalFeesGenerated1: swapFeesInToken1,
    incrementalTotalFeesGeneratedUSD: swapFeesInUSD,
    token0Price:
      token0Instance?.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
    token1Price:
      token1Instance?.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
    incrementalNumberOfSwaps: 1n,
    incrementalReserve0: newReserve0 - liquidityPoolAggregator.reserve0,
    incrementalReserve1: newReserve1 - liquidityPoolAggregator.reserve1,
    currentTotalLiquidityUSD,
    sqrtPriceX96: event.params.sqrtPriceX96, // Store current sqrt price from Swap event
    tick: event.params.tick, // Store current tick from Swap event
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
