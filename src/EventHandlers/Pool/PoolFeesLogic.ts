import type { Pool_Fees_event, Token, handlerContext } from "generated";
import { updateFeeTokenData } from "../../Helpers";

export interface UserDiff {
  incrementalFeesContributedUSD: bigint;
  incrementalFeesContributed0: bigint;
  incrementalFeesContributed1: bigint;
  lastActivityTimestamp: Date;
}

export interface LiquidityPoolAggregatorDiff {
  incrementalUnstakedFeesCollected0: bigint;
  incrementalUnstakedFeesCollected1: bigint;
  incrementalUnstakedFeesCollectedUSD: bigint;
  incrementalFeesUSDWhitelisted: bigint;
  lastUpdatedTimestamp: Date;
}
export interface PoolFeesResult {
  liquidityPoolDiff?: LiquidityPoolAggregatorDiff;
  userDiff?: UserDiff;
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
    incrementalUnstakedFeesCollected0: event.params.amount0,
    incrementalUnstakedFeesCollected1: event.params.amount1,
    incrementalUnstakedFeesCollectedUSD: feeData.totalFeesUSD,
    incrementalFeesUSDWhitelisted: feeData.totalFeesUSDWhitelisted,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Prepare user diff data
  const userDiff: UserDiff = {
    incrementalFeesContributedUSD: feeData.totalFeesUSD,
    incrementalFeesContributed0: event.params.amount0,
    incrementalFeesContributed1: event.params.amount1,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userDiff,
  };
}
