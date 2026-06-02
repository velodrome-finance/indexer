import type { TokenPriceSnapshot } from "envio";

import type { handlerContext } from "../EntityTypes";

import { TokenIdByBlock } from "../Constants";
import {
  type SnapshotForPersist,
  SnapshotType,
  persistSnapshot,
} from "./Shared";

/**
 * Provenance tags for a {@link TokenPriceSnapshot}'s `pricePerUSDNew`, recording
 * which branch of `refreshTokenPrice` produced the price (issue #822). Stored as
 * a String column rather than a GraphQL enum so the set can extend without an
 * Envio schema migration — the same convention as `priceTrustOutcome`. Call
 * sites should reference these constants rather than bare string literals.
 *
 * - `fresh`        — a freshly fetched oracle price accepted as-is
 * - `pool-implied` — a first-fetch anchored to the pool-implied hint rather than
 *                    the raw oracle read (#784/#785); a successful write whose
 *                    value a consumer can still tell apart from a `fresh` read
 * - `rebind`       — copied from a canonical token's price on another chain
 * - `override`     — forced by a hard override (blacklist → 0)
 * - `carried`      — the prior price kept unchanged on a reject / fallback / error tick
 */
export const PRICE_SOURCE = {
  FRESH: "fresh",
  POOL_IMPLIED: "pool-implied",
  REBIND: "rebind",
  OVERRIDE: "override",
  CARRIED: "carried",
} as const;

/** One of the {@link PRICE_SOURCE} provenance tags. */
export type PriceSource = (typeof PRICE_SOURCE)[keyof typeof PRICE_SOURCE];

/**
 * Creates a TokenPriceSnapshot (per-event, no epoch alignment; no persistence).
 * @param address - Token address
 * @param chainId - Chain ID
 * @param blockNumber - Block number of the snapshot
 * @param lastUpdatedTimestamp - Timestamp of the last update
 * @param pricePerUSDNew - Price per USD
 * @param isWhitelisted - Whether the token is whitelisted
 * @param priceSource - Provenance tag for the price (see {@link PRICE_SOURCE})
 * @returns TokenPriceSnapshot
 */
export function createTokenPriceSnapshot(
  address: string,
  chainId: number,
  blockNumber: number,
  lastUpdatedTimestamp: Date,
  pricePerUSDNew: bigint,
  isWhitelisted: boolean,
  priceSource: PriceSource,
): TokenPriceSnapshot {
  const snapshotId = TokenIdByBlock(chainId, address, blockNumber);
  return {
    id: snapshotId,
    address,
    chainId,
    pricePerUSDNew,
    isWhitelisted,
    lastUpdatedTimestamp,
    priceSource,
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
 * @param priceSource - Provenance tag for the price (see {@link PRICE_SOURCE})
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
  priceSource: PriceSource,
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
      priceSource,
    ),
  };
  persistSnapshot(snapshotForPersist, context);
}
