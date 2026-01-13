import type { Pool_Fees_event, Token } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import {
  calculateTokenAmountUSD,
  calculateTotalLiquidityUSD,
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

  // Calculate whitelisted fees increment: add each token's fees individually if whitelisted
  let totalFeesUSDWhitelisted = 0n;

  if (token0Instance) {
    const token0FeesUSD = calculateTokenAmountUSD(
      event.params.amount0,
      Number(token0Instance.decimals),
      token0Instance.pricePerUSDNew,
    );
    if (token0Instance.isWhitelisted) {
      totalFeesUSDWhitelisted += token0FeesUSD;
    }
  }

  if (token1Instance) {
    const token1FeesUSD = calculateTokenAmountUSD(
      event.params.amount1,
      Number(token1Instance.decimals),
      token1Instance.pricePerUSDNew,
    );
    if (token1Instance.isWhitelisted) {
      totalFeesUSDWhitelisted += token1FeesUSD;
    }
  }

  // Create liquidity pool diff
  const liquidityPoolDiff = {
    incrementalTotalUnstakedFeesCollected0: event.params.amount0,
    incrementalTotalUnstakedFeesCollected1: event.params.amount1,
    incrementalTotalUnstakedFeesCollectedUSD: totalFeesUSD,
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
