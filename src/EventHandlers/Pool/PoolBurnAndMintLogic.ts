import type {
  LiquidityPoolAggregator,
  Pool_Burn_event,
  Pool_Mint_event,
  Token,
  handlerContext,
} from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { updateReserveTokenData } from "../../Helpers";

export interface PoolLiquidityResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userLiquidityDiff?: Partial<UserStatsPerPoolDiff>;
}

/**
 * Common logic for mint and burn events
 * Updates reserve data and creates liquidity pool diff
 */
export async function processPoolLiquidityEvent(
  event: Pool_Mint_event | Pool_Burn_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token,
  token1Instance: Token,
  amount0: bigint,
  amount1: bigint,
  context: handlerContext,
): Promise<PoolLiquidityResult> {
  // Update reserve data
  const reserveData = await updateReserveTokenData(
    token0Instance,
    token1Instance,
    amount0,
    amount1,
    event,
    context,
  );

  const netLiquidityUSDChange = reserveData.totalLiquidityUSD ?? 0n;

  // Check if this is a mint event by looking for 'to' parameter (burn events have 'to', mint events don't)
  const isMintEvent = !("to" in event.params);

  // Create liquidity pool diff
  const liquidityPoolDiff = {
    // Update reserves cumulatively
    incrementalReserve0: isMintEvent ? amount0 : -amount0,
    incrementalReserve1: isMintEvent ? amount1 : -amount1,
    // Update token prices
    token0Price:
      reserveData.token0?.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
    token1Price:
      reserveData.token1?.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
    // Update total liquidity USD if available
    incrementalCurrentLiquidityUSD: netLiquidityUSDChange,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Create user liquidity diff for tracking user activity
  const incrementalCurrentLiquidityUSD = isMintEvent
    ? netLiquidityUSDChange
    : -netLiquidityUSDChange;
  const userLiquidityDiff = {
    incrementalCurrentLiquidityUSD: incrementalCurrentLiquidityUSD,
    // For burn events, use negative amounts to subtract from user's liquidity
    // For mint events, use positive amounts to add to user's liquidity
    incrementalCurrentLiquidityToken0: isMintEvent ? amount0 : -amount0,
    incrementalCurrentLiquidityToken1: isMintEvent ? amount1 : -amount1,
    incrementalTotalLiquidityAddedUSD: isMintEvent
      ? incrementalCurrentLiquidityUSD
      : 0n,
    incrementalTotalLiquidityRemovedUSD: !isMintEvent
      ? -incrementalCurrentLiquidityUSD // Negative for burn (removal), therefore we need to negate the value
      : 0n,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
