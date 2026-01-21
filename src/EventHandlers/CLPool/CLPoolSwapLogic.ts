import type {
  CLPool_Swap_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import {
  calculateTokenAmountUSD,
  calculateTotalLiquidityUSD,
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
  deltaTotalLiquidityUSD: bigint;
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

  // Calculate whitelisted volume (both tokens must be whitelisted)
  const volumeInUSDWhitelisted =
    token0Instance?.isWhitelisted && token1Instance?.isWhitelisted
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
      `[calculateSwapFees] Pool ${liquidityPoolAggregator.id} on chain ${event.chainId} has undefined currentFee and baseFee. Cannot calculate swap fees.`,
    );
    // Set fees to 0 if fee is undefined (should not happen in practice)
    return {
      swapFeesInToken0: 0n,
      swapFeesInToken1: 0n,
      swapFeesInUSD: 0n,
    };
  }

  // Calculate fees in token native units (fee is in basis points, so divide by 10000)
  const swapFeesInToken0Raw = (abs(event.params.amount0) * fee) / 10000n;
  const swapFeesInToken1Raw = (abs(event.params.amount1) * fee) / 10000n;

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
 * Calculates liquidity and reserve changes from a swap event
 * Exported for testing purposes only
 */
export function calculateSwapLiquidityChanges(
  event: CLPool_Swap_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): SwapLiquidityChanges {
  // Calculate new reserves after the swap
  // In the swap event, amount0 and amount1 can be both negative or positive, so we add either way
  const newReserve0 = liquidityPoolAggregator.reserve0 + event.params.amount0;
  const newReserve1 = liquidityPoolAggregator.reserve1 + event.params.amount1;

  // Calculate new total liquidity USD using already-refreshed token prices
  const newTotalLiquidityUSD = calculateTotalLiquidityUSD(
    newReserve0,
    newReserve1,
    token0Instance,
    token1Instance,
  );

  // Calculate the delta in total liquidity USD
  const currentTotalLiquidityUSD = liquidityPoolAggregator.totalLiquidityUSD;
  const deltaTotalLiquidityUSD =
    newTotalLiquidityUSD - currentTotalLiquidityUSD;

  return {
    newReserve0,
    newReserve1,
    deltaTotalLiquidityUSD,
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

  // Calculate liquidity and reserve changes
  const { deltaTotalLiquidityUSD } = calculateSwapLiquidityChanges(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
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
    incrementalReserve0: event.params.amount0, // Delta: can be positive or negative (signed int256)
    incrementalReserve1: event.params.amount1, // Delta: can be positive or negative (signed int256)
    incrementalCurrentLiquidityUSD: deltaTotalLiquidityUSD,
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
