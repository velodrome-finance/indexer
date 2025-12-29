import type { CLPool_Burn_event, Token } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { calculateTotalLiquidityUSD } from "../../Helpers";

export interface CLPoolBurnResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userLiquidityDiff: Partial<UserStatsPerPoolDiff>;
}

export function processCLPoolBurn(
  event: CLPool_Burn_event,
  token0Instance: Token,
  token1Instance: Token,
): CLPoolBurnResult {
  // Calculate USD values using already-refreshed token prices from loadPoolData
  const totalLiquidityUSD = calculateTotalLiquidityUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    incrementalReserve0: -event.params.amount0,
    incrementalReserve1: -event.params.amount1,
    incrementalCurrentLiquidityUSD: -totalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Note: These fields represent the change/delta in liquidity (not absolute values)
  // The field names match the schema (currentLiquidityUSD, etc.) but contain diff values, hinted by the variable name
  const userLiquidityDiff = {
    incrementalCurrentLiquidityUSD: -totalLiquidityUSD, // Negative for burn (removal)
    incrementalCurrentLiquidityToken0: -event.params.amount0, // Negative amount of token0 removed
    incrementalCurrentLiquidityToken1: -event.params.amount1, // Negative amount of token1 removed
    incrementalTotalLiquidityRemovedUSD: totalLiquidityUSD, // Track total liquidity removed (positive value)
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
