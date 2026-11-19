import type {
  VeNFTPoolVote,
  VeNFTPoolVoteSnapshot,
  VeNFTState,
  VeNFTStateSnapshot,
} from "envio";

import type { handlerContext } from "../EntityTypes";

import { VeNFTPoolVoteSnapshotId } from "../Constants";
import {
  type SnapshotForPersist,
  SnapshotType,
  getSnapshotEpoch,
  persistSnapshot,
} from "./Shared";

/**
 * Creates an epoch-aligned snapshot of VeNFTPoolVote (no persistence).
 * @param entity - VeNFTPoolVote to snapshot
 * @param veNFTState - Parent VeNFTState for token identity
 * @param veNFTStateSnapshot - Parent VeNFTStateSnapshot for linkage
 * @param timestamp - Timestamp used to compute snapshot epoch
 * @param chainId - Chain of the event being handled (the veNFT's chain)
 * @returns Epoch-aligned VeNFTPoolVoteSnapshot
 */
export function createVeNFTPoolVoteSnapshot(
  entity: VeNFTPoolVote,
  veNFTState: VeNFTState,
  veNFTStateSnapshot: VeNFTStateSnapshot,
  timestamp: Date,
  chainId: number,
): VeNFTPoolVoteSnapshot {
  const epoch = getSnapshotEpoch(timestamp);

  return {
    id: VeNFTPoolVoteSnapshotId(
      chainId,
      veNFTState.tokenId,
      entity.poolAddress,
      epoch.getTime(),
    ),
    tokenId: veNFTState.tokenId,
    poolAddress: entity.poolAddress,
    veNFTamountStaked: entity.veNFTamountStaked,
    lastUpdatedTimestamp: entity.lastUpdatedTimestamp,
    timestamp: epoch,
    veNFTStateSnapshot_id: veNFTStateSnapshot.id,
  };
}

/**
 * Creates and persists an epoch-aligned snapshot of VeNFTPoolVote.
 * @param entity - VeNFTPoolVote to snapshot
 * @param veNFTState - Parent VeNFTState for token identity
 * @param veNFTStateSnapshot - Parent VeNFTStateSnapshot for linkage
 * @param timestamp - Timestamp used to compute snapshot epoch
 * @param context - Handler context
 * @param chainId - Chain of the event being handled (the veNFT's chain)
 * @returns void
 */
export function setVeNFTPoolVoteSnapshot(
  entity: VeNFTPoolVote,
  veNFTState: VeNFTState,
  veNFTStateSnapshot: VeNFTStateSnapshot,
  timestamp: Date,
  context: handlerContext,
  chainId: number,
): void {
  const snapshotForPersist: SnapshotForPersist = {
    type: SnapshotType.VeNFTPoolVote,
    snapshot: createVeNFTPoolVoteSnapshot(
      entity,
      veNFTState,
      veNFTStateSnapshot,
      timestamp,
      chainId,
    ),
  };
  persistSnapshot(snapshotForPersist, context);
}
