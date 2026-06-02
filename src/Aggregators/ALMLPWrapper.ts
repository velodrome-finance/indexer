import type { ALM_LP_Wrapper } from "envio";

import type { handlerContext } from "../EntityTypes";

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
  // Clamp lpAmount to >= 0n on write (issue #816). The V1-withdraw fallback can
  // subtract more than was added: a V1 `Withdraw` emits the input parameter, not
  // the actual burned amount (see getActualLpAmountForV1 in
  // src/EventHandlers/ALM/LPWrapperLogic.ts), so a withdraw can exceed the
  // deposits we accumulated and drive the counter negative. Clamp-and-log mirrors
  // [NEG_RESERVE_GUARD] in Aggregators/Pool.ts; [NEG_ALM_LP_AMOUNT_GUARD] keeps
  // the underflow observable. Breadcrumb only — no deeper V1 fix unless a symptom
  // is observed (issue #816 AC).
  const lpAmountRaw =
    diff.incrementalLpAmount !== undefined
      ? diff.incrementalLpAmount + current.lpAmount
      : current.lpAmount;
  const clampedLpAmount = lpAmountRaw < 0n ? 0n : lpAmountRaw;
  if (lpAmountRaw < 0n) {
    context.log.warn(
      `[NEG_ALM_LP_AMOUNT_GUARD][updateALMLPWrapper] field=lpAmount id=${current.id} priorLpAmount=${current.lpAmount} delta=${diff.incrementalLpAmount ?? 0n} clampedTo=${clampedLpAmount}`,
    );
  }

  let updated: ALM_LP_Wrapper = {
    ...current,
    lpAmount: clampedLpAmount,
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
