import type {
  LiquidityPoolAggregator,
  Pool_Swap_event,
  Token,
  handlerContext,
} from "generated";
import { updateSwapTokenData } from "../../Helpers";

export interface UserSwapDiff {
  numberOfSwaps: bigint;
  totalSwapVolumeUSD: bigint;
  lastActivityTimestamp: Date;
}

export interface PoolSwapResult {
  liquidityPoolDiff?: Partial<LiquidityPoolAggregator>;
  userSwapDiff?: UserSwapDiff;
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
  const liquidityPoolDiff: Partial<LiquidityPoolAggregator> = {
    totalVolume0: swapData.token0NetAmount ?? 0n,
    totalVolume1: swapData.token1NetAmount ?? 0n,
    totalVolumeUSD: swapData.volumeInUSD,
    totalVolumeUSDWhitelisted: swapData.volumeInUSDWhitelisted,
    token0Price:
      swapData.token0?.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
    token1Price:
      swapData.token1?.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
    numberOfSwaps: 1n,
    token0IsWhitelisted: swapData.token0?.isWhitelisted ?? false,
    token1IsWhitelisted: swapData.token1?.isWhitelisted ?? false,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Create user swap diff
  const userSwapDiff: UserSwapDiff = {
    numberOfSwaps: 1n,
    totalSwapVolumeUSD: swapData.volumeInUSD,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userSwapDiff,
  };
}
