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
 * - `pool`: the deepest qualifying pool set the price
 * - `rebind`: no local pool qualified; copied the cross-chain source's price
 * - `none`: nothing qualified
 */
export type PriceResolution =
  | { readonly kind: "override" }
  | { readonly kind: "pinned" }
  | {
      readonly kind: "pool";
      readonly priceUSD: bigint;
      readonly poolId: string;
      readonly depthUSD: bigint;
    }
  | { readonly kind: "rebind"; readonly priceUSD: bigint }
  | { readonly kind: "none" };

/** The token write and snapshot provenance a resolution produces. */
export interface AppliedPrice {
  /** The token with price + clocks updated (not yet persisted). */
  readonly token: Token;
  /** Provenance tag for the TokenPriceSnapshot. */
  readonly priceSource: PriceSource;
  /** Pool the price came through (pool resolutions only). */
  readonly pricingPoolId?: string;
  /** Counterparty depth of that pool, USD 1e18-base (pool resolutions only). */
  readonly pricingDepthUSD?: bigint;
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
 *   (`pinned`, `pool`, `rebind`).
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
  const success = (priceUSD: bigint): Token => ({
    ...token,
    pricePerUSDNew: priceUSD,
    lastUpdatedTimestamp: now,
    lastSuccessfulPriceTimestamp: now,
  });

  switch (resolution.kind) {
    case "override":
      return {
        token: { ...token, pricePerUSDNew: 0n, lastUpdatedTimestamp: now },
        priceSource: PRICE_SOURCE.OVERRIDE,
      };
    case "pinned":
      return { token: success(ONE_USD), priceSource: PRICE_SOURCE.PINNED };
    case "pool":
      return {
        token: success(resolution.priceUSD),
        priceSource: PRICE_SOURCE.POOL,
        pricingPoolId: resolution.poolId,
        pricingDepthUSD: resolution.depthUSD,
      };
    case "rebind":
      return {
        token: success(resolution.priceUSD),
        priceSource: PRICE_SOURCE.REBIND,
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
          lastUpdatedTimestamp: now,
        },
        priceSource: carry ? PRICE_SOURCE.CARRIED : PRICE_SOURCE.UNPRICED,
      };
    }
  }
}
