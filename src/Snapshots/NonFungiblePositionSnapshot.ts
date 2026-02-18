import type {
  NonFungiblePosition,
  NonFungiblePositionSnapshot,
  handlerContext,
} from "generated";

import { NonFungiblePositionSnapshotId } from "../Constants";
import { getSnapshotEpoch } from "./Shared";

/**
 * Creates and persists an epoch-aligned snapshot of NonFungiblePosition.
 * @param entity - NonFungiblePosition to snapshot
 * @param timestamp - Timestamp of the snapshot
 * @param blockNumber - Block number of the snapshot
 * @param context - Handler context
 * @returns void
 */
export function setNonFungiblePositionSnapshot(
  entity: NonFungiblePosition,
  timestamp: Date,
  blockNumber: number,
  context: handlerContext,
): void {
  const epoch = getSnapshotEpoch(timestamp);

  const snapshotId = NonFungiblePositionSnapshotId(
    entity.chainId,
    entity.tokenId,
    epoch.getTime(),
  );

  const snapshot: NonFungiblePositionSnapshot = {
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
    blockNumber,
  };

  context.NonFungiblePositionSnapshot.set(snapshot);
}
