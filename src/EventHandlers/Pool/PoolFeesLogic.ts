import type { Pool_Fees_event, Token } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import {
  calculateTotalLiquidityUSD,
  calculateWhitelistedFeesUSD,
} from "../../Helpers";

export interface PoolFeesResult {
  liquidityPoolDiff?: Partial<LiquidityPoolAggregatorDiff>;
  userDiff?: Partial<UserStatsPerPoolDiff>;
}

/**
 * Process fees event using already-refreshed token prices from loadPoolData
 * This matches CLPoolCollectFeesLogic and CLPoolCollectLogic pattern
 * For regular pools (non-CL), fees are tracked as unstaked fees
 * since regular pools don't have the staked/unstaked distinction that CL pools have
 */
export function processPoolFees(
  event: Pool_Fees_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): PoolFeesResult {
  // Calculate total fees USD using already-refreshed token prices
  const totalFeesUSD = calculateTotalLiquidityUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const totalFeesUSDWhitelisted = calculateWhitelistedFeesUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  // Create liquidity pool diff
  const liquidityPoolDiff = {
    incrementalTotalFeesGenerated0: event.params.amount0,
    incrementalTotalFeesGenerated1: event.params.amount1,
    incrementalTotalFeesGeneratedUSD: totalFeesUSD,
    incrementalTotalFeesUSDWhitelisted: totalFeesUSDWhitelisted,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Prepare user diff data
  const userDiff = {
    incrementalTotalFeesContributedUSD: totalFeesUSD,
    incrementalTotalFeesContributed0: event.params.amount0,
    incrementalTotalFeesContributed1: event.params.amount1,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userDiff,
  };
}
