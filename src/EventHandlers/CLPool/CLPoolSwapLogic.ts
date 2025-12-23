import type {
  CLPool_Swap_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { calculateTotalLiquidityUSD, updateSwapTokenData } from "../../Helpers";
import { abs } from "../../Maths";

export interface CLPoolSwapResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregator>;
  userSwapDiff: {
    numberOfSwaps: bigint;
    totalSwapVolumeUSD: bigint;
    totalSwapVolumeAmount0: bigint;
    totalSwapVolumeAmount1: bigint;
    lastActivityTimestamp: Date;
  };
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
  const liquidityPoolAggregatorDiff: Partial<LiquidityPoolAggregator> = {
    totalVolume0: abs(event.params.amount0),
    totalVolume1: abs(event.params.amount1),
    totalVolumeUSD: swapData.volumeInUSD,
    totalVolumeUSDWhitelisted: swapData.volumeInUSDWhitelisted,
    token0Price:
      swapData.token0?.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
    token1Price:
      swapData.token1?.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
    token0IsWhitelisted: swapData.token0?.isWhitelisted ?? false,
    token1IsWhitelisted: swapData.token1?.isWhitelisted ?? false,
    numberOfSwaps: 1n,
    reserve0: event.params.amount0, // Delta: can be positive or negative (signed int256)
    reserve1: event.params.amount1, // Delta: can be positive or negative (signed int256)
    totalLiquidityUSD: deltaTotalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  const userSwapDiff = {
    numberOfSwaps: 1n, // Each swap event represents 1 swap
    totalSwapVolumeUSD: swapData.volumeInUSD,
    totalSwapVolumeAmount0: abs(event.params.amount0),
    totalSwapVolumeAmount1: abs(event.params.amount1),
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff: liquidityPoolAggregatorDiff,
    userSwapDiff,
  };
}
