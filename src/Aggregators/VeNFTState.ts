import type { VeNFTState } from "envio";

import type { handlerContext } from "../EntityTypes";

import { VeNFTId } from "../Constants";
import { getRehydrated } from "../EntityTimestamps";
import { getSnapshotEpoch, shouldSnapshot } from "../Snapshots/Shared";
import { setVeNFTStateSnapshot } from "../Snapshots/VeNFTStateSnapshot";

export interface VeNFTStateDiff {
  id: string;
  chainId: number;
  tokenId: bigint;
  owner: string;
  locktime: bigint;
  isPermanent: boolean;
  incrementalTotalValueLocked: bigint;
  isAlive: boolean;
  lastUpdatedTimestamp: Date;
  /** When set and newer than current.lastSnapshotTimestamp, replaces it. */
  lastSnapshotTimestamp?: Date;
}

export async function loadVeNFTState(
  chainId: number,
  tokenId: bigint,
  context: handlerContext,
): Promise<VeNFTState | undefined> {
  const id = VeNFTId(chainId, tokenId);
  const veNFTState = await getRehydrated(context.VeNFTState, "VeNFTState", id);

  if (!veNFTState) {
    context.log.warn(`[loadVeNFTState] VeNFTState ${id} not found`);
  }

  return veNFTState;
}

/**
 * Updates VeNFTState with the provided diff.
 * Takes an epoch-aligned snapshot when entering a new snapshot epoch.
 */
export async function updateVeNFTState(
  diff: Partial<VeNFTStateDiff>,
  current: VeNFTState,
  timestamp: Date,
  context: handlerContext,
): Promise<void> {
  const lastSnapshotTimestamp =
    diff.lastSnapshotTimestamp !== undefined &&
    (current.lastSnapshotTimestamp === undefined ||
      diff.lastSnapshotTimestamp.getTime() >
        current.lastSnapshotTimestamp.getTime())
      ? diff.lastSnapshotTimestamp
      : current.lastSnapshotTimestamp;

  // Clamp totalValueLocked to >= 0n on write (issue #816). A decrement can land
  // on a zero-initialised shell — the matching deposit that should have populated
  // the balance was never indexed — so the raw subtraction would persist as a
  // negative TVL. Clamp-and-log mirrors [NEG_RESERVE_GUARD] in Aggregators/Pool.ts;
  // [NEG_VENFT_TVL_GUARD] keeps the underflow observable. Breadcrumb only — no
  // deeper deposit-backfill fix unless a symptom is observed (issue #816 AC).
  const totalValueLockedRaw =
    (diff.incrementalTotalValueLocked ?? 0n) + current.totalValueLocked;
  const clampedTotalValueLocked =
    totalValueLockedRaw < 0n ? 0n : totalValueLockedRaw;
  if (totalValueLockedRaw < 0n) {
    context.log.warn(
      `[NEG_VENFT_TVL_GUARD][updateVeNFTState] field=totalValueLocked id=${current.id} priorTVL=${current.totalValueLocked} delta=${diff.incrementalTotalValueLocked ?? 0n} clampedTo=${clampedTotalValueLocked}`,
    );
  }

  let veNFTState: VeNFTState = {
    ...current,
    id: diff.id ?? VeNFTId(current.chainId, current.tokenId),
    chainId: diff.chainId ?? current.chainId,
    tokenId: diff.tokenId ?? current.tokenId,
    owner: diff.owner ?? current.owner,
    locktime: diff.locktime ?? current.locktime, // lockTime of the deposit action
    isPermanent: diff.isPermanent ?? current.isPermanent,
    lastUpdatedTimestamp: timestamp,
    totalValueLocked: clampedTotalValueLocked,
    isAlive: diff.isAlive ?? current.isAlive,
    lastSnapshotTimestamp,
  };

  if (shouldSnapshot(current.lastSnapshotTimestamp, timestamp)) {
    await setVeNFTStateSnapshot(veNFTState, timestamp, context);
    veNFTState = {
      ...veNFTState,
      lastSnapshotTimestamp: getSnapshotEpoch(timestamp),
    };
  }

  // Defensive invariant guard: by VotingEscrow semantics, locktime=0 is only
  // valid for permanent locks. An alive non-permanent lock must have
  // locktime > now. If we ever land in the impossible state, surface it so
  // monitoring catches future regressions (see #776).
  if (
    veNFTState.locktime === 0n &&
    !veNFTState.isPermanent &&
    veNFTState.isAlive
  ) {
    context.log.warn(
      `[VENFT_LOCKSTATE_INVARIANT] VeNFTState ${veNFTState.id} ended with locktime=0, isPermanent=false, isAlive=true`,
    );
  }

  context.VeNFTState.set(veNFTState);
}
