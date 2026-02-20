import type { TokenPriceSnapshot, handlerContext } from "generated";

import { TokenIdByBlock } from "../Constants";
import {
  type SnapshotForPersist,
  SnapshotType,
  persistSnapshot,
} from "./Shared";

/**
 * Creates a TokenPriceSnapshot (per-event, no epoch alignment; no persistence).
 * @param address - Token address
 * @param chainId - Chain ID
 * @param blockNumber - Block number of the snapshot
 * @param lastUpdatedTimestamp - Timestamp of the last update
 * @param pricePerUSDNew - Price per USD
 * @param isWhitelisted - Whether the token is whitelisted
 * @returns TokenPriceSnapshot
 */
export function createTokenPriceSnapshot(
  address: string,
  chainId: number,
  blockNumber: number,
  lastUpdatedTimestamp: Date,
  pricePerUSDNew: bigint,
  isWhitelisted: boolean,
): TokenPriceSnapshot {
  const snapshotId = TokenIdByBlock(chainId, address, blockNumber);
  return {
    id: snapshotId,
    address,
    chainId,
    pricePerUSDNew,
    isWhitelisted,
    lastUpdatedTimestamp,
  };
}

/**
 * Creates and persists a TokenPriceSnapshot (per-event, no epoch alignment).
 * @param address - Token address
 * @param chainId - Chain ID
 * @param blockNumber - Block number of the snapshot
 * @param lastUpdatedTimestamp - Timestamp of the last update
 * @param pricePerUSDNew - Price per USD
 * @param isWhitelisted - Whether the token is whitelisted
 * @param context - Handler context
 * @returns void
 */
export function setTokenPriceSnapshot(
  address: string,
  chainId: number,
  blockNumber: number,
  lastUpdatedTimestamp: Date,
  pricePerUSDNew: bigint,
  isWhitelisted: boolean,
  context: handlerContext,
): void {
  const snapshotForPersist: SnapshotForPersist = {
    type: SnapshotType.TokenPrice,
    snapshot: createTokenPriceSnapshot(
      address,
      chainId,
      blockNumber,
      lastUpdatedTimestamp,
      pricePerUSDNew,
      isWhitelisted,
    ),
  };
  persistSnapshot(snapshotForPersist, context);
}
