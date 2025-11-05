import type { CLPool_Collect_event, Token, handlerContext } from "generated";
import { updateReserveTokenData } from "../../Helpers";

export interface CLPoolCollectResult {
  liquidityPoolDiff: {
    reserve0: bigint;
    reserve1: bigint;
    totalLiquidityUSD: bigint;
    lastUpdatedTimestamp: Date;
  };
  userLiquidityDiff: {
    totalFeesContributed0: bigint;
    totalFeesContributed1: bigint;
    totalFeesContributedUSD: bigint;
    timestamp: Date;
  };
}

export async function processCLPoolCollect(
  event: CLPool_Collect_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  context: handlerContext,
): Promise<CLPoolCollectResult> {
  // Update reserve data using the same approach as Pool events
  const reserveData = await updateReserveTokenData(
    token0Instance,
    token1Instance,
    event.params.amount0,
    event.params.amount1,
    event,
    context,
  );

  const liquidityPoolDiff = {
    reserve0: event.params.amount0,
    reserve1: event.params.amount1,
    totalLiquidityUSD: reserveData.totalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  const userLiquidityDiff = {
    totalFeesContributed0: event.params.amount0, // The collected fees in token0
    totalFeesContributed1: event.params.amount1, // The collected fees in token1
    totalFeesContributedUSD: reserveData.totalLiquidityUSD, // The collected fees in USD
    timestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
