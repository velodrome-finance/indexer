import type { TokenPriceSnapshot, handlerContext } from "generated";

import { TokenIdByBlock } from "../Constants";

/**
 * Creates and persists a TokenPriceSnapshot (per-event, no epoch alignment).
 * Used when a token price is refreshed in PriceOracle.
 * @param address - Address of the token
 * @param chainId - Chain ID of the token
 * @param blockNumber - Block number of the snapshot
 * @param lastUpdatedTimestamp - Timestamp of the last update
 * @param pricePerUSDNew - Price per USD of the token
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
  const snapshotId = TokenIdByBlock(chainId, address, blockNumber);

  const snapshot: TokenPriceSnapshot = {
    id: snapshotId,
    address,
    chainId,
    pricePerUSDNew,
    isWhitelisted,
    lastUpdatedTimestamp,
  };

  context.TokenPriceSnapshot.set(snapshot);
}
