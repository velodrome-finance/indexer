import type { ALM_LP_Wrapper, handlerContext } from "generated";

interface ALM_LP_WrapperDiff {
  incrementalLpAmount: bigint;
  liquidity: bigint;
  tickLower: bigint;
  tickUpper: bigint;
  property: bigint;
  tokenId: bigint;
  lastUpdatedTimestamp: Date;
}
/**
 * Generic function to update ALM_LP_Wrapper with any combination of fields.
 * lpAmount and position-level fields (liquidity, tickLower, tickUpper, etc.) are set from handlers.
 */
export async function updateALMLPWrapper(
  diff: Partial<ALM_LP_WrapperDiff>,
  current: ALM_LP_Wrapper,
  timestamp: Date,
  context: handlerContext,
): Promise<void> {
  const updated: ALM_LP_Wrapper = {
    ...current,
    lpAmount:
      diff.incrementalLpAmount !== undefined
        ? diff.incrementalLpAmount + current.lpAmount
        : current.lpAmount,
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
