import type { CLPool_Collect_event, Token } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { calculateTotalLiquidityUSD } from "../../Helpers";

export interface CLPoolCollectResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userLiquidityDiff: Partial<UserStatsPerPoolDiff>;
}

export function processCLPoolCollect(
  event: CLPool_Collect_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): CLPoolCollectResult {
  // Calculate USD values using already-refreshed token prices from loadPoolData
  // In CL pools, fees accumulate in positions (tokensOwed0/tokensOwed1) and are NOT part of base reserves.
  // When collected, they're transferred out but were never in the tracked reserves.
  // Therefore, Collect events should NOT affect reserves - only track fees collected.
  const totalFeesContributedUSD = calculateTotalLiquidityUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    // Track unstaked fees (from Collect events - LPs that didn't stake)
    incrementalTotalUnstakedFeesCollected0: event.params.amount0,
    incrementalTotalUnstakedFeesCollected1: event.params.amount1,
    incrementalTotalUnstakedFeesCollectedUSD: totalFeesContributedUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };
  const userLiquidityDiff = {
    incrementalTotalFeesContributed0: event.params.amount0, // The collected fees in token0
    incrementalTotalFeesContributed1: event.params.amount1, // The collected fees in token1
    incrementalTotalFeesContributedUSD: totalFeesContributedUSD, // The collected fees in USD
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
