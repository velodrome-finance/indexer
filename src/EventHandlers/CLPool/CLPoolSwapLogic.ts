import type {
  CLPool_Swap_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { calculateTotalLiquidityUSD, updateSwapTokenData } from "../../Helpers";
import { abs } from "../../Maths";

export interface CLPoolSwapResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userSwapDiff: Partial<UserStatsPerPoolDiff>;
}

export async function processCLPoolSwap(
  event: CLPool_Swap_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  context: handlerContext,
): Promise<CLPoolSwapResult> {
  // Process both tokens in parallel using updateTokenData helper
  // Apply abs() to signed amounts (int256) before processing
  const swapData = await updateSwapTokenData(
    token0Instance,
    token1Instance,
    abs(event.params.amount0),
    abs(event.params.amount1),
    event,
    context,
  );

  // Get updated token instances
  const updatedToken0Instance = swapData.token0 ?? token0Instance;
  const updatedToken1Instance = swapData.token1 ?? token1Instance;

  // Calculate new reserves after the swap
  // In the swap event, amount0 and amount1 can be both negative or positive, so we add either way
  const newReserve0 = liquidityPoolAggregator.reserve0 + event.params.amount0;
  const newReserve1 = liquidityPoolAggregator.reserve1 + event.params.amount1;

  // Calculate new total liquidity USD using updated token prices
  const newTotalLiquidityUSD = calculateTotalLiquidityUSD(
    newReserve0,
    newReserve1,
    updatedToken0Instance,
    updatedToken1Instance,
  );

  // Calculate the delta in total liquidity USD
  const currentTotalLiquidityUSD = liquidityPoolAggregator.totalLiquidityUSD;
  const deltaTotalLiquidityUSD =
    newTotalLiquidityUSD - currentTotalLiquidityUSD;

  // Build complete liquidity pool aggregator diff
  const liquidityPoolDiff = {
    incrementalTotalVolume0: abs(event.params.amount0),
    incrementalTotalVolume1: abs(event.params.amount1),
    incrementalTotalVolumeUSD: swapData.volumeInUSD,
    incrementalTotalVolumeUSDWhitelisted: swapData.volumeInUSDWhitelisted,
    token0Price:
      swapData.token0?.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
    token1Price:
      swapData.token1?.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
    incrementalNumberOfSwaps: 1n,
    incrementalReserve0: event.params.amount0, // Delta: can be positive or negative (signed int256)
    incrementalReserve1: event.params.amount1, // Delta: can be positive or negative (signed int256)
    incrementalCurrentLiquidityUSD: deltaTotalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  const userSwapDiff = {
    incrementalNumberOfSwaps: 1n, // Each swap event represents 1 swap
    incrementalTotalSwapVolumeUSD: swapData.volumeInUSD,
    incrementalTotalSwapVolumeAmount0: abs(event.params.amount0),
    incrementalTotalSwapVolumeAmount1: abs(event.params.amount1),
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userSwapDiff,
  };
}
