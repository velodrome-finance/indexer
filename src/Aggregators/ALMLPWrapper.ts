import type { ALM_LP_Wrapper, handlerContext } from "generated";

import { setALMLPWrapperSnapshot } from "../Snapshots/ALMLPWrapperSnapshot";
import { getSnapshotEpoch, shouldSnapshot } from "../Snapshots/Shared";

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
 * Takes an epoch-aligned snapshot when entering a new snapshot epoch.
 */
export async function updateALMLPWrapper(
  diff: Partial<ALM_LP_WrapperDiff>,
  current: ALM_LP_Wrapper,
  timestamp: Date,
  context: handlerContext,
): Promise<void> {
  let updated: ALM_LP_Wrapper = {
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

  if (shouldSnapshot(current.lastSnapshotTimestamp, timestamp)) {
    setALMLPWrapperSnapshot(updated, timestamp, context);
    updated = {
      ...updated,
      lastSnapshotTimestamp: getSnapshotEpoch(timestamp),
    };
  }

  context.ALM_LP_Wrapper.set(updated);
}
