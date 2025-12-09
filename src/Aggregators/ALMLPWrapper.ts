import type { ALM_LP_Wrapper, handlerContext } from "generated";

/**
 * Generic function to update ALM_LP_Wrapper with any combination of fields
 * - amount0, amount1: Set directly when recalculated from liquidity and price (for deposits/withdrawals/rebalances)
 * - lpAmount: Set directly (updated from aggregations in handlers)
 * - Position-level fields (liquidity, tickLower, tickUpper, etc.) are set directly (for rebalances)
 */
export async function updateALMLPWrapper(
  diff: Partial<ALM_LP_Wrapper>,
  current: ALM_LP_Wrapper,
  timestamp: Date,
  context: handlerContext,
): Promise<void> {
  const updated: ALM_LP_Wrapper = {
    ...current,
    // Wrapper-level amounts: set directly (recalculated from liquidity and current price)
    amount0: diff.amount0 !== undefined ? diff.amount0 : current.amount0,
    amount1: diff.amount1 !== undefined ? diff.amount1 : current.amount1,
    lpAmount:
      diff.lpAmount !== undefined
        ? diff.lpAmount + current.lpAmount
        : current.lpAmount,
    // Position-level state: set directly (for rebalances)
    tokenId: diff.tokenId !== undefined ? diff.tokenId : current.tokenId,
    liquidity:
      diff.liquidity !== undefined ? diff.liquidity : current.liquidity,
    tickLower:
      diff.tickLower !== undefined ? diff.tickLower : current.tickLower,
    tickUpper:
      diff.tickUpper !== undefined ? diff.tickUpper : current.tickUpper,
    property: diff.property !== undefined ? diff.property : current.property,
    lastUpdatedTimestamp: timestamp,
  };

  context.ALM_LP_Wrapper.set(updated);
}
