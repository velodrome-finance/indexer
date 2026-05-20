import type { Token } from "generated";
import { calculateTokenAmountUSD } from "./Helpers";
import { isBlacklistedToken } from "./PriceOverrides";

/**
 * Reason a token did or did not pass the price-trust gate. Useful for triage
 * logs and the per-token `priceTrustReason` field added in a later slice.
 *
 * - `"WL"` — protocol-whitelisted and not in the operator BLACKLIST (trusted)
 * - `"BLACKLISTED"` — protocol-whitelisted but operator BLACKLIST overrides
 * - `"NON_WL"` — not protocol-whitelisted (regardless of BLACKLIST membership)
 */
export type PriceTrustReason = "WL" | "NON_WL" | "BLACKLISTED";

export interface PriceTrustDecision {
  readonly trusted: boolean;
  readonly reason: PriceTrustReason;
}

/**
 * Two-tier price-trust gate. Returns true iff the token is on-chain
 * whitelisted by the protocol's Voter contract AND is not present in the
 * operator-maintained BLACKLIST override.
 *
 * The gate consults only signals the indexer already has: the Token entity's
 * `isWhitelisted` (sourced from `WhitelistToken` events) and the static
 * BLACKLIST set in `PriceOverrides`. No RPC, no entity reads, no heuristics
 * — pure function, O(1).
 *
 * @param token - Token entity from the indexer. Undefined inputs are
 *   treated as untrusted (the indexer cannot trust what it does not have).
 * @returns true when the token's price may be multiplied into USD aggregates;
 *   false otherwise
 */
export function isTrusted(token: Token | undefined): boolean {
  if (!token) return false;
  if (!token.isWhitelisted) return false;
  return !isBlacklistedToken(token.chainId, token.address);
}

/**
 * USD-from-amount wrapper gated by {@link isTrusted}. Returns the trusted
 * USD value (1e18-base) for the given raw token amount, or `0n` when the
 * token fails the gate. This is the call-site convenience helper that every
 * USD-aggregation site should route through.
 *
 * @param amount - Raw token amount in the token's native decimal base
 * @param token - Token entity carrying decimals + pricePerUSDNew. Undefined
 *   or untrusted tokens contribute `0n`.
 * @returns USD value in 1e18-base, or `0n` when the gate denies trust
 */
export function getTrustedUSD(
  amount: bigint,
  token: Token | undefined,
): bigint {
  if (!token || !isTrusted(token)) return 0n;
  return calculateTokenAmountUSD(
    amount,
    Number(token.decimals),
    token.pricePerUSDNew,
  );
}

/**
 * Debug helper returning the gate's boolean outcome plus the reason it fired.
 * Intended for triage logs and the per-token `priceTrustReason` field added
 * by a later slice; not used on the aggregator hot path.
 *
 * Reason precedence: `NON_WL` dominates `BLACKLISTED` when both apply, since
 * the protocol-whitelist signal is the load-bearing one — a token's path to
 * trust runs through whitelisting, not through removing a blacklist entry.
 *
 * @param token - Token entity. Undefined is reported as `NON_WL` (no
 *   whitelist attestation exists).
 * @returns `{ trusted, reason }` decision
 */
export function getGateDecision(token: Token | undefined): PriceTrustDecision {
  if (!token || !token.isWhitelisted) {
    return { trusted: false, reason: "NON_WL" };
  }
  if (isBlacklistedToken(token.chainId, token.address)) {
    return { trusted: false, reason: "BLACKLISTED" };
  }
  return { trusted: true, reason: "WL" };
}
