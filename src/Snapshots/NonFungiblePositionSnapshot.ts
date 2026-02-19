import type {
  NonFungiblePosition,
  NonFungiblePositionSnapshot,
  handlerContext,
} from "generated";

import { NonFungiblePositionSnapshotId } from "../Constants";
import {
  type SnapshotForPersist,
  SnapshotType,
  getSnapshotEpoch,
  persistSnapshot,
} from "./Shared";

/**
 * Creates an epoch-aligned snapshot of NonFungiblePosition (no persistence).
 * @param entity - NonFungiblePosition to snapshot
 * @param timestamp - Timestamp used to compute snapshot epoch
 * @returns Epoch-aligned NonFungiblePositionSnapshot
 */
export function createNonFungiblePositionSnapshot(
  entity: NonFungiblePosition,
  timestamp: Date,
): NonFungiblePositionSnapshot {
  const epoch = getSnapshotEpoch(timestamp);
  const snapshotId = NonFungiblePositionSnapshotId(
    entity.chainId,
    entity.tokenId,
    epoch.getTime(),
  );
  return {
    id: snapshotId,
    chainId: entity.chainId,
    tokenId: entity.tokenId,
    owner: entity.owner,
    pool: entity.pool,
    tickLower: entity.tickLower,
    tickUpper: entity.tickUpper,
    token0: entity.token0,
    token1: entity.token1,
    liquidity: entity.liquidity,
    mintTransactionHash: entity.mintTransactionHash,
    mintLogIndex: entity.mintLogIndex,
    lastUpdatedTimestamp: entity.lastUpdatedTimestamp,
    timestamp: epoch,
  };
}

/**
 * Creates and persists an epoch-aligned snapshot of NonFungiblePosition.
 * @param entity - NonFungiblePosition to snapshot
 * @param timestamp - Timestamp used to compute snapshot epoch
 * @param context - Handler context
 * @returns void
 */
export function setNonFungiblePositionSnapshot(
  entity: NonFungiblePosition,
  timestamp: Date,
  context: handlerContext,
): void {
  const snapshotForPersist: SnapshotForPersist = {
    type: SnapshotType.NonFungiblePosition,
    snapshot: createNonFungiblePositionSnapshot(entity, timestamp),
  };
  persistSnapshot(snapshotForPersist, context);
}
