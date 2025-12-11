import type {
  LiquidityPoolAggregator,
  Pool_Fees_event,
  Token,
  handlerContext,
} from "generated";
import { updateFeeTokenData } from "../../Helpers";

export interface UserDiff {
  totalFeesContributedUSD: bigint;
  totalFeesContributed0: bigint;
  totalFeesContributed1: bigint;
  lastActivityTimestamp: Date;
}

export interface PoolFeesResult {
  liquidityPoolDiff?: Partial<LiquidityPoolAggregator>;
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
  const liquidityPoolDiff: Partial<LiquidityPoolAggregator> = {
    totalUnstakedFeesCollected0: event.params.amount0,
    totalUnstakedFeesCollected1: event.params.amount1,
    totalUnstakedFeesCollectedUSD: feeData.totalFeesUSD,
    totalFeesUSDWhitelisted: feeData.totalFeesUSDWhitelisted,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Prepare user diff data
  const userDiff: UserDiff = {
    totalFeesContributedUSD: feeData.totalFeesUSD,
    totalFeesContributed0: event.params.amount0,
    totalFeesContributed1: event.params.amount1,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userDiff,
  };
}
