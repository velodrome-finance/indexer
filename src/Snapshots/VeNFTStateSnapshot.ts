import type { VeNFTState, VeNFTStateSnapshot } from "envio";
import type { handlerContext } from "../EntityTypes";

import { loadPoolVotesByVeNFT } from "../Aggregators/VeNFTPoolVote";
import { VeNFTStateSnapshotId } from "../Constants";
import {
  type SnapshotForPersist,
  SnapshotType,
  getSnapshotEpoch,
  persistSnapshot,
} from "./Shared";
import { setVeNFTPoolVoteSnapshot } from "./VeNFTPoolVoteSnapshot";

/**
 * Creates an epoch-aligned snapshot of VeNFTState (no persistence).
 * @param entity - VeNFTState to snapshot
 * @param timestamp - Timestamp used to compute snapshot epoch
 * @param chainId - Chain of the event being handled (the entity's chain)
 * @returns Epoch-aligned VeNFTStateSnapshot
 */
export function createVeNFTStateSnapshot(
  entity: VeNFTState,
  timestamp: Date,
  chainId: number,
): VeNFTStateSnapshot {
  const epoch = getSnapshotEpoch(timestamp);
  const snapshotId = VeNFTStateSnapshotId(
    chainId,
    entity.tokenId,
    epoch.getTime(),
  );
  return {
    id: snapshotId,
    tokenId: entity.tokenId,
    owner: entity.owner,
    locktime: entity.locktime,
    isPermanent: entity.isPermanent,
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
 * @param chainId - Chain of the event being handled (the entity's chain)
 * @returns Resolves after the veNFT snapshot and any vote snapshots are persisted.
 */
export async function setVeNFTStateSnapshot(
  entity: VeNFTState,
  timestamp: Date,
  context: handlerContext,
  chainId: number,
): Promise<void> {
  const snapshot = createVeNFTStateSnapshot(entity, timestamp, chainId);
  const snapshotForPersist: SnapshotForPersist = {
    type: SnapshotType.VeNFTState,
    snapshot,
  };
  persistSnapshot(snapshotForPersist, context);

  const poolVotes = await loadPoolVotesByVeNFT(entity, context);

  for (const poolVote of poolVotes) {
    setVeNFTPoolVoteSnapshot(
      poolVote,
      entity,
      snapshot,
      timestamp,
      context,
      chainId,
    );
  }
}
