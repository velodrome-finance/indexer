import type { Token } from "generated";
import { calculateTokenAmountUSD } from "./Helpers";
import { isBlacklistedToken } from "./PriceOverrides";

/**
 * Centralised values for the per-token `priceTrustOutcome` schema field.
 * Use these constants at call sites instead of bare string literals so the
 * value set is grep-discoverable and a typo fails to type-check.
 */
export const PRICE_TRUST_OUTCOME = {
  TRUSTED: "TRUSTED",
  UNTRUSTED: "UNTRUSTED",
} as const;
export type PriceTrustOutcome =
  (typeof PRICE_TRUST_OUTCOME)[keyof typeof PRICE_TRUST_OUTCOME];

/**
 * Centralised values for the per-token `priceTrustReason` schema field.
 *
 * - `WL` — protocol-whitelisted and not in the operator BLACKLIST (trusted)
 * - `BLACKLISTED` — protocol-whitelisted but operator BLACKLIST overrides
 * - `NON_WL` — not protocol-whitelisted (regardless of BLACKLIST membership)
 */
export const PRICE_TRUST_REASON = {
  WL: "WL",
  NON_WL: "NON_WL",
  BLACKLISTED: "BLACKLISTED",
} as const;
export type PriceTrustReason =
  (typeof PRICE_TRUST_REASON)[keyof typeof PRICE_TRUST_REASON];

export interface PriceTrustDecision {
  readonly trusted: boolean;
  readonly outcome: PriceTrustOutcome;
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
 * Gate decision from raw signals, without a Token entity. Used at Token
 * construction time (handlers + tests) so the persisted
 * `priceTrustOutcome` / `priceTrustReason` fields are populated in lockstep
 * with `isWhitelisted` rather than left null until the first aggregator consult.
 *
 * Reason precedence: `NON_WL` dominates `BLACKLISTED` when both apply, since
 * the protocol-whitelist signal is the load-bearing one — a token's path to
 * trust runs through whitelisting, not through removing a blacklist entry.
 *
 * @param chainId - Chain ID for BLACKLIST lookup
 * @param address - Token address (EIP-55 checksum) for BLACKLIST lookup
 * @param isWhitelisted - Protocol-whitelist signal from the Voter contract
 * @returns `{ trusted, reason }` decision
 */
export function getGateDecisionFromSignals(
  chainId: number,
  address: string,
  isWhitelisted: boolean,
): PriceTrustDecision {
  if (!isWhitelisted) {
    return {
      trusted: false,
      outcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
      reason: PRICE_TRUST_REASON.NON_WL,
    };
  }
  if (isBlacklistedToken(chainId, address)) {
    return {
      trusted: false,
      outcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
      reason: PRICE_TRUST_REASON.BLACKLISTED,
    };
  }
  return {
    trusted: true,
    outcome: PRICE_TRUST_OUTCOME.TRUSTED,
    reason: PRICE_TRUST_REASON.WL,
  };
}

/**
 * Gate decision from a Token entity. Thin wrapper over
 * {@link getGateDecisionFromSignals} for callers that already have a Token
 * loaded (typically aggregator paths in slice 3+).
 *
 * @param token - Token entity. Undefined is reported as `NON_WL` (no
 *   whitelist attestation exists).
 * @returns `{ trusted, reason }` decision
 */
export function getGateDecision(token: Token | undefined): PriceTrustDecision {
  if (!token) {
    return {
      trusted: false,
      outcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
      reason: PRICE_TRUST_REASON.NON_WL,
    };
  }
  return getGateDecisionFromSignals(
    token.chainId,
    token.address,
    token.isWhitelisted,
  );
}
