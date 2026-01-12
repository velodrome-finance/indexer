import type {
  LiquidityPoolAggregator,
  Pool_Swap_event,
  Token,
  handlerContext,
} from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { updateSwapTokenData } from "../../Helpers";

export interface PoolSwapResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userSwapDiff: Partial<UserStatsPerPoolDiff>;
}

export async function processPoolSwap(
  event: Pool_Swap_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token,
  token1Instance: Token,
  context: handlerContext,
): Promise<PoolSwapResult> {
  // Update token data
  const swapData = await updateSwapTokenData(
    token0Instance,
    token1Instance,
    event.params.amount0In + event.params.amount0Out,
    event.params.amount1In + event.params.amount1Out,
    event,
    context,
  );

  // Create liquidity pool diff
  const liquidityPoolDiff = {
    incrementalTotalVolume0: swapData.token0NetAmount ?? 0n,
    incrementalTotalVolume1: swapData.token1NetAmount ?? 0n,
    incrementalTotalVolumeUSD: swapData.volumeInUSD,
    incrementalTotalVolumeUSDWhitelisted: swapData.volumeInUSDWhitelisted,
    token0Price:
      swapData.token0?.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
    token1Price:
      swapData.token1?.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
    incrementalNumberOfSwaps: 1n,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Create user swap diff
  const userSwapDiff = {
    incrementalNumberOfSwaps: 1n,
    incrementalTotalSwapVolumeUSD: swapData.volumeInUSD,
    incrementalTotalSwapVolumeAmount0:
      event.params.amount0In + event.params.amount0Out,
    incrementalTotalSwapVolumeAmount1:
      event.params.amount1In + event.params.amount1Out,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userSwapDiff,
  };
}
