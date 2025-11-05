import type { ALM_LP_Wrapper, handlerContext } from "generated";

/**
 * Generic function to update ALM_LP_Wrapper with any combination of fields
 * - Wrapper-level fields (amount0, amount1, lpAmount) are incremented (for deposits/withdrawals)
 * - Position-level fields (positionAmount0, positionAmount1, liquidity) are set directly (for rebalances)
 */
export async function updateALMLPWrapper(
  diff: Partial<ALM_LP_Wrapper>,
  current: ALM_LP_Wrapper,
  timestamp: Date,
  context: handlerContext,
): Promise<void> {
  const updated: ALM_LP_Wrapper = {
    ...current,
    // Wrapper-level aggregations: increment (for deposits/withdrawals)
    amount0:
      diff.amount0 !== undefined
        ? diff.amount0 + current.amount0
        : current.amount0,
    amount1:
      diff.amount1 !== undefined
        ? diff.amount1 + current.amount1
        : current.amount1,
    lpAmount:
      diff.lpAmount !== undefined
        ? diff.lpAmount + current.lpAmount
        : current.lpAmount,
    // Position-level state: set directly (for rebalances)
    tokenId: diff.tokenId !== undefined ? diff.tokenId : current.tokenId,
    positionAmount0:
      diff.positionAmount0 !== undefined
        ? diff.positionAmount0
        : current.positionAmount0,
    positionAmount1:
      diff.positionAmount1 !== undefined
        ? diff.positionAmount1
        : current.positionAmount1,
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
