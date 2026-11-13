import type { TokenPriceSnapshot } from "envio";

import type { handlerContext } from "../EntityTypes";

import { TokenId } from "../Constants";
import {
  type SnapshotForPersist,
  SnapshotType,
  getSnapshotEpoch,
  persistSnapshot,
} from "./Shared";

/**
 * Provenance tags for a {@link TokenPriceSnapshot}'s `pricePerUSDNew`, recording
 * how the price refresh obtained it (docs/adr/0003-pool-derived-token-prices.md).
 * Stored as a String column rather than a GraphQL enum so the set can extend
 * without an Envio schema migration — the same convention as
 * `priceTrustOutcome`. Call sites should reference these constants rather than
 * bare string literals.
 *
 * - `pinned`   — tier-0 token (destination token / stablecoin) at exactly $1
 * - `pool`     — derived from the deepest qualifying pool (`pricingPoolId`,
 *                `pricingDepthUSD` say which pool and how deep)
 * - `rebind`   — copied from the configured cross-chain source token's stored
 *                price because no local pool qualified
 * - `override` — forced to 0 by the operator blacklist
 * - `carried`  — nothing qualified; the prior price is kept (last success < 7 days ago)
 * - `unpriced` — nothing qualified and nothing fresh to carry; price is 0
 *
 * Rows written before ADR 0003 carry the oracle-era tags `fresh` and
 * `pool-implied`, which are no longer produced.
 */
export const PRICE_SOURCE = {
  PINNED: "pinned",
  POOL: "pool",
  REBIND: "rebind",
  OVERRIDE: "override",
  CARRIED: "carried",
  UNPRICED: "unpriced",
} as const;

/** One of the {@link PRICE_SOURCE} provenance tags. */
export type PriceSource = (typeof PRICE_SOURCE)[keyof typeof PRICE_SOURCE];

/** Fields of one price tick, as recorded by {@link setTokenPriceSnapshot}. */
export interface TokenPriceSnapshotInput {
  /** Token address. */
  readonly address: string;
  /** Chain the token lives on. */
  readonly chainId: number;
  /** Block timestamp of the refresh; also selects the hour bucket in the id. */
  readonly timestamp: Date;
  /** The token's price after the refresh (1e18-base USD). */
  readonly pricePerUSDNew: bigint;
  /** Whether the token is protocol-whitelisted. */
  readonly isWhitelisted: boolean;
  /** How the price was obtained. */
  readonly priceSource: PriceSource;
  /** Pool the price was derived through (`pool` ticks only). */
  readonly pricingPoolId?: string;
  /** That pool's counterparty-side depth in USD, 1e18-base (`pool` ticks only). */
  readonly pricingDepthUSD?: bigint;
}

/**
 * Id of a token's price snapshot for the clock hour containing `timestamp`:
 * `{chainId}-{address}-{epochMs}`. Keying on the hour bucket makes "at most one
 * snapshot per token per hour" structural — a second write in the same hour
 * replaces the first rather than adding a row.
 *
 * @param chainId - Chain the token lives on
 * @param address - Token address
 * @param timestamp - Any instant inside the hour
 * @returns The snapshot id
 */
export function TokenPriceSnapshotId(
  chainId: number,
  address: string,
  timestamp: Date,
): string {
  return `${TokenId(chainId, address)}-${getSnapshotEpoch(timestamp).getTime()}`;
}

/**
 * Creates a TokenPriceSnapshot for one price tick (no persistence).
 *
 * @param input - The tick's fields (see {@link TokenPriceSnapshotInput})
 * @returns TokenPriceSnapshot keyed by {@link TokenPriceSnapshotId}
 */
export function createTokenPriceSnapshot(
  input: TokenPriceSnapshotInput,
): TokenPriceSnapshot {
  return {
    id: TokenPriceSnapshotId(input.chainId, input.address, input.timestamp),
    address: input.address,
    chainId: input.chainId,
    pricePerUSDNew: input.pricePerUSDNew,
    isWhitelisted: input.isWhitelisted,
    lastUpdatedTimestamp: input.timestamp,
    priceSource: input.priceSource,
    pricingPoolId: input.pricingPoolId,
    pricingDepthUSD: input.pricingDepthUSD,
  };
}

/**
 * Creates and persists a TokenPriceSnapshot for one price tick.
 *
 * @param input - The tick's fields (see {@link TokenPriceSnapshotInput})
 * @param context - Handler context
 * @returns void; the snapshot write is staged on `context`
 */
export function setTokenPriceSnapshot(
  input: TokenPriceSnapshotInput,
  context: handlerContext,
): void {
  const snapshotForPersist: SnapshotForPersist = {
    type: SnapshotType.TokenPrice,
    snapshot: createTokenPriceSnapshot(input),
  };
  persistSnapshot(snapshotForPersist, context);
}
