import type { VeNFTState, VeNFTStateSnapshot, handlerContext } from "generated";

import { VeNFTStateSnapshotId } from "../Constants";
import {
  type SnapshotForPersist,
  SnapshotType,
  getSnapshotEpoch,
  persistSnapshot,
} from "./Shared";

/**
 * Creates an epoch-aligned snapshot of VeNFTState (no persistence).
 * @param entity - VeNFTState to snapshot
 * @param timestamp - Timestamp used to compute snapshot epoch
 * @returns Epoch-aligned VeNFTStateSnapshot
 */
export function createVeNFTStateSnapshot(
  entity: VeNFTState,
  timestamp: Date,
): VeNFTStateSnapshot {
  const epoch = getSnapshotEpoch(timestamp);
  const snapshotId = VeNFTStateSnapshotId(
    entity.chainId,
    entity.tokenId,
    epoch.getTime(),
  );
  return {
    id: snapshotId,
    chainId: entity.chainId,
    tokenId: entity.tokenId,
    owner: entity.owner,
    locktime: entity.locktime,
    lastUpdatedTimestamp: entity.lastUpdatedTimestamp,
    totalValueLocked: entity.totalValueLocked,
    isAlive: entity.isAlive,
    timestamp: epoch,
  };
}

/**
 * Creates and persists an epoch-aligned snapshot of VeNFTState.
 * @param entity - VeNFTState to snapshot
 * @param timestamp - Timestamp used to compute snapshot epoch
 * @param context - Handler context
 * @returns void
 */
export function setVeNFTStateSnapshot(
  entity: VeNFTState,
  timestamp: Date,
  context: handlerContext,
): void {
  const snapshotForPersist: SnapshotForPersist = {
    type: SnapshotType.VeNFTState,
    snapshot: createVeNFTStateSnapshot(entity, timestamp),
  };
  persistSnapshot(snapshotForPersist, context);
}
