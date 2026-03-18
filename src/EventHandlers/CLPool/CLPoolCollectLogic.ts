import type { CLPool_Collect_event, Token } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { calculateTotalUSD, calculateWhitelistedFeesUSD } from "../../Helpers";

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
  // TVL definition: reserves track LP-deposited capital only (see calculateSwapLiquidityChanges).
  // Collect transfers tokensOwed (burned liquidity + accumulated fees) out of the pool.
  // - The burned liquidity portion was already subtracted from reserves by the Burn handler.
  // - The fee portion was never added to reserves (fees are excluded at swap time).
  // Therefore, Collect events should NOT affect reserves — only track fees collected.
  const unstakedFeesUSD = calculateTotalUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const totalFeesUSDWhitelistedIncrement = calculateWhitelistedFeesUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    // Track unstaked fees (from Collect events - LPs that didn't stake)
    incrementalTotalUnstakedFeesCollected0: event.params.amount0,
    incrementalTotalUnstakedFeesCollected1: event.params.amount1,
    incrementalTotalUnstakedFeesCollectedUSD: unstakedFeesUSD,
    incrementalTotalFeesUSDWhitelisted: totalFeesUSDWhitelistedIncrement,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };
  const userLiquidityDiff = {
    incrementalTotalUnstakedFeesCollected0: event.params.amount0,
    incrementalTotalUnstakedFeesCollected1: event.params.amount1,
    incrementalTotalUnstakedFeesCollectedUSD: unstakedFeesUSD,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
