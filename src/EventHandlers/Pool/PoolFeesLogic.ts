import type { Pool_Fees_event, Token, handlerContext } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { updateFeeTokenData } from "../../Helpers";

export interface PoolFeesResult {
  liquidityPoolDiff?: Partial<LiquidityPoolAggregatorDiff>;
  userDiff?: Partial<UserStatsPerPoolDiff>;
}

export async function processPoolFees(
  event: Pool_Fees_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  context: handlerContext,
): Promise<PoolFeesResult> {
  // Use existing helper function for fee token data updates
  const feeData = await updateFeeTokenData(
    token0Instance,
    token1Instance,
    event.params.amount0,
    event.params.amount1,
    event,
    context,
  );

  // Create liquidity pool diff
  // For regular pools (non-CL), fees are tracked as unstaked fees
  // since regular pools don't have the staked/unstaked distinction that CL pools have
  const liquidityPoolDiff = {
    incrementalTotalUnstakedFeesCollected0: event.params.amount0,
    incrementalTotalUnstakedFeesCollected1: event.params.amount1,
    incrementalTotalUnstakedFeesCollectedUSD: feeData.totalFeesUSD,
    incrementalTotalFeesUSDWhitelisted: feeData.totalFeesUSDWhitelisted,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Prepare user diff data
  const userDiff = {
    incrementalTotalFeesContributedUSD: feeData.totalFeesUSD,
    incrementalTotalFeesContributed0: event.params.amount0,
    incrementalTotalFeesContributed1: event.params.amount1,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userDiff,
  };
}
