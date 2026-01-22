import type { CLPool_Mint_event, Token } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { calculateTotalLiquidityUSD } from "../../Helpers";

export interface CLPoolMintResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userLiquidityDiff: Partial<UserStatsPerPoolDiff>;
}

export function processCLPoolMint(
  event: CLPool_Mint_event,
  token0Instance: Token,
  token1Instance: Token,
): CLPoolMintResult {
  // Calculate USD values using already-refreshed token prices from loadPoolData
  const totalLiquidityUSD = calculateTotalLiquidityUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    incrementalReserve0: event.params.amount0,
    incrementalReserve1: event.params.amount1,
    incrementalCurrentLiquidityUSD: totalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  const userLiquidityDiff = {
    incrementalTotalLiquidityAddedUSD: totalLiquidityUSD, // Track total liquidity added (cumulative)
    incrementalTotalLiquidityAddedToken0: event.params.amount0, // Track total liquidity added in token0 (cumulative)
    incrementalTotalLiquidityAddedToken1: event.params.amount1, // Track total liquidity added in token1 (cumulative)
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
