import type { VeNFTState, VeNFTStateSnapshot, handlerContext } from "generated";

import { VeNFTStateSnapshotId } from "../Constants";
import { getSnapshotEpoch } from "./Shared";

/**
 * Creates and persists an epoch-aligned snapshot of VeNFTState.
 * @param entity - VeNFTState to snapshot
 * @param timestamp - Timestamp of the snapshot
 * @param context - Handler context
 * @returns void
 */
export function setVeNFTStateSnapshot(
  entity: VeNFTState,
  timestamp: Date,
  context: handlerContext,
): void {
  const epoch = getSnapshotEpoch(timestamp);

  const snapshotId = VeNFTStateSnapshotId(
    entity.chainId,
    entity.tokenId,
    epoch.getTime(),
  );

  const snapshot: VeNFTStateSnapshot = {
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

  context.VeNFTStateSnapshot.set(snapshot);
}
