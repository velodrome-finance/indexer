import type { Pool_Burn_event, Pool_Mint_event, Token } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { calculateTotalLiquidityUSD } from "../../Helpers";

export interface PoolLiquidityResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userLiquidityDiff?: Partial<UserStatsPerPoolDiff>;
}

/**
 * Common logic for mint and burn events
 * Creates liquidity pool diff using already-refreshed token prices from loadPoolData
 * This matches CLPoolMintLogic and CLPoolBurnLogic pattern
 */
export function processPoolLiquidityEvent(
  event: Pool_Mint_event | Pool_Burn_event,
  token0Instance: Token,
  token1Instance: Token,
  amount0: bigint,
  amount1: bigint,
): PoolLiquidityResult {
  // Calculate USD values using already-refreshed token prices from loadPoolData
  const totalLiquidityUSD = calculateTotalLiquidityUSD(
    amount0,
    amount1,
    token0Instance,
    token1Instance,
  );

  // Check if this is a mint event by looking for 'to' parameter (burn events have 'to', mint events don't)
  const isMintEvent = !("to" in event.params);

  // Create liquidity pool diff
  // Apply sign convention at pool level: positive for mint, negative for burn
  // This matches CLPoolBurnLogic and CLPoolMintLogic pattern
  const liquidityPoolDiff = {
    // Update reserves cumulatively
    incrementalReserve0: isMintEvent ? amount0 : -amount0,
    incrementalReserve1: isMintEvent ? amount1 : -amount1,
    // Update token prices (from already-refreshed tokens)
    token0Price: token0Instance.pricePerUSDNew,
    token1Price: token1Instance.pricePerUSDNew,
    // Update total liquidity USD: positive for mint, negative for burn
    incrementalCurrentLiquidityUSD: isMintEvent
      ? totalLiquidityUSD
      : -totalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Create user liquidity diff for tracking user activity
  // User diff should match pool diff sign convention for consistency
  const incrementalCurrentLiquidityUSD = isMintEvent
    ? totalLiquidityUSD
    : -totalLiquidityUSD;
  const userLiquidityDiff = {
    incrementalCurrentLiquidityUSD: incrementalCurrentLiquidityUSD,
    // For burn events, use negative amounts to subtract from user's liquidity
    // For mint events, use positive amounts to add to user's liquidity
    incrementalCurrentLiquidityToken0: isMintEvent ? amount0 : -amount0,
    incrementalCurrentLiquidityToken1: isMintEvent ? amount1 : -amount1,
    incrementalTotalLiquidityAddedUSD: isMintEvent ? totalLiquidityUSD : 0n,
    incrementalTotalLiquidityRemovedUSD: !isMintEvent
      ? totalLiquidityUSD // Positive value for tracking total removed
      : 0n,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
