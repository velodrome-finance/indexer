import type { Token } from "envio";
import {
  PRICE_SOURCE,
  type PriceSource,
} from "../Snapshots/TokenPriceSnapshot";
import {
  ONE_USD,
  PRICE_CARRY_WINDOW_MS,
  PRICE_REFRESH_INTERVAL_MS,
} from "./PricingConfig";

/**
 * What a refresh found for a token, before carry / expiry is applied.
 *
 * - `override`: operator blacklist (src/PriceOverrides.ts) → price 0
 * - `pinned`: tier-0 token → exactly $1
 * - `pool`: the deepest qualifying candidate was a local pool (`sourceId` = pool id)
 * - `canonical`: the deepest qualifying candidate was the same asset's price on
 *   its canonical chain (`sourceId` = source token id)
 * - `none`: nothing qualified
 */
export type PriceResolution =
  | { readonly kind: "override" }
  | { readonly kind: "pinned" }
  | {
      readonly kind: "pool" | "canonical";
      readonly priceUSD: bigint;
      readonly sourceId: string;
      readonly depthUSD: bigint;
      /** 2 for a two-hop pool route (ADR 0007); absent = 1. */
      readonly hops?: 1 | 2;
      /** Two-hop only: the peer token the price went through. */
      readonly viaTokenId?: string;
      /** Two-hop only: the pool that priced the peer. */
      readonly viaPoolId?: string;
    }
  | { readonly kind: "none" };

/** The token write and snapshot provenance a resolution produces. */
export interface AppliedPrice {
  /** The token with price, depth and clocks updated (not yet persisted). */
  readonly token: Token;
  /** Provenance tag for the TokenPriceSnapshot. */
  readonly priceSource: PriceSource;
  /** Pool the price came through (`pool` resolutions only). */
  readonly pricingPoolId?: string;
  /** Canonical source token whose price was used (`canonical` resolutions only). */
  readonly pricingSourceTokenId?: string;
  /** Depth of the winning candidate, USD 1e18-base (`pool` / `canonical` only). */
  readonly pricingDepthUSD?: bigint;
  /** Route length: 1 for a direct pool or canonical price, 2 for a two-hop pool route. */
  readonly pricingHops?: number;
  /** Two-hop only: the peer token the price went through. */
  readonly pricingViaTokenId?: string;
  /** Two-hop only: the pool that priced the peer. */
  readonly pricingViaPoolId?: string;
}

/**
 * Whether a token's price is due for a refresh: never refreshed, or the block
 * falls in a later clock hour than the last refresh attempt. This is the only
 * gate — there are no bypasses — so a token is refreshed, and snapshotted, at
 * most once per clock hour. A block older than the last attempt (e.g. a
 * deferred cross-chain replay) is never due.
 *
 * @param lastUpdatedTimestamp - The token's last refresh attempt, if any
 * @param blockTimestampMs - Current block timestamp in milliseconds
 * @returns true when the refresh should run
 */
export function isPriceRefreshDue(
  lastUpdatedTimestamp: Date | undefined,
  blockTimestampMs: number,
): boolean {
  if (!lastUpdatedTimestamp) return true;
  return (
    Math.floor(blockTimestampMs / PRICE_REFRESH_INTERVAL_MS) >
    Math.floor(lastUpdatedTimestamp.getTime() / PRICE_REFRESH_INTERVAL_MS)
  );
}

/**
 * Applies a refresh's resolution to the token, enforcing the two-clock rule
 * (#694):
 *
 * - `lastUpdatedTimestamp` advances on every refresh, whatever the outcome.
 * - `lastSuccessfulPriceTimestamp` advances only on a successful price
 *   (`pinned`, `pool`, `canonical`).
 *
 * `Token.pricingDepthUSD` records the depth behind the stored price, so this
 * token can itself serve as a canonical source compared by depth on other
 * chains: the winning candidate's depth on `pool` / `canonical`, kept while a
 * price is carried, cleared when the price is pinned, overridden or dropped.
 *
 * When nothing qualifies (`none`), the last price is carried while the last
 * success is under {@link PRICE_CARRY_WINDOW_MS} old, so missing data never
 * zeroes a good price; past the window it drops to 0 (`unpriced`) so a token
 * whose liquidity has left stops inflating TVL. `override` zeroes the price
 * without touching the success clock.
 *
 * Pure: no reads, no writes.
 *
 * @param token - The token being refreshed
 * @param resolution - What the refresh found
 * @param blockTimestampMs - Current block timestamp in milliseconds
 * @returns The updated token plus snapshot provenance
 */
export function applyPriceResolution(
  token: Token,
  resolution: PriceResolution,
  blockTimestampMs: number,
): AppliedPrice {
  const now = new Date(blockTimestampMs);
  const success = (
    priceUSD: bigint,
    pricingDepthUSD: bigint | undefined,
  ): Token => ({
    ...token,
    pricePerUSDNew: priceUSD,
    pricingDepthUSD,
    lastUpdatedTimestamp: now,
    lastSuccessfulPriceTimestamp: now,
  });

  switch (resolution.kind) {
    case "override":
      return {
        token: {
          ...token,
          pricePerUSDNew: 0n,
          pricingDepthUSD: undefined,
          lastUpdatedTimestamp: now,
        },
        priceSource: PRICE_SOURCE.OVERRIDE,
      };
    case "pinned":
      return {
        token: success(ONE_USD, undefined),
        priceSource: PRICE_SOURCE.PINNED,
      };
    case "pool":
      return {
        token: success(resolution.priceUSD, resolution.depthUSD),
        priceSource: PRICE_SOURCE.POOL,
        pricingPoolId: resolution.sourceId,
        pricingDepthUSD: resolution.depthUSD,
        pricingHops: resolution.hops ?? 1,
        pricingViaTokenId: resolution.viaTokenId,
        pricingViaPoolId: resolution.viaPoolId,
      };
    case "canonical":
      return {
        token: success(resolution.priceUSD, resolution.depthUSD),
        priceSource: PRICE_SOURCE.CANONICAL,
        pricingSourceTokenId: resolution.sourceId,
        pricingDepthUSD: resolution.depthUSD,
        pricingHops: 1,
      };
    case "none": {
      const lastSuccess = token.lastSuccessfulPriceTimestamp;
      const carry =
        token.pricePerUSDNew > 0n &&
        lastSuccess !== undefined &&
        blockTimestampMs - lastSuccess.getTime() < PRICE_CARRY_WINDOW_MS;
      return {
        token: {
          ...token,
          pricePerUSDNew: carry ? token.pricePerUSDNew : 0n,
          pricingDepthUSD: carry ? token.pricingDepthUSD : undefined,
          lastUpdatedTimestamp: now,
        },
        priceSource: carry ? PRICE_SOURCE.CARRIED : PRICE_SOURCE.UNPRICED,
      };
    }
  }
}
