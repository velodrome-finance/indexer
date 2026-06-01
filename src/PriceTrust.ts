import type { Token } from "envio";
import type { handlerContext } from "./EntityTypes";
import { calculateTokenAmountUSD } from "./Helpers";
import { multiplyBase1e18 } from "./Maths";
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
 * Pool-implied USD price (1e18-base) for one leg of a pool, derived from the
 * pool's on-chain price ratio and the *counterparty* leg's trusted price. This
 * is an independent ground-truth witness to the per-token oracle route: it
 * comes from pool reserves / sqrtPriceX96, not from the route that can freeze
 * or glitch (#784/#785).
 *
 * For token0 the caller passes the pool's `token0Price` (1e18-scaled
 * token1-per-token0) and the token1 entity; for token1, `token1Price` and the
 * token0 entity. Gated by {@link isTrusted}: an untrusted or undefined
 * counterparty yields `0n` (no usable hint), so any consumer is inert unless
 * the other leg is a whitelisted, non-blacklisted token whose price is
 * reliable. A `0n` ratio (uninitialised pool) also yields `0n`.
 *
 * @param priceRatio1e18 - The priced token's value in counterparty units,
 *   1e18-scaled (the pool entity's `token0Price` / `token1Price`).
 * @param counterparty - The other token in the pool, carrying the trusted USD
 *   price. Undefined or untrusted ⇒ `0n`.
 * @returns USD-per-whole-token in 1e18-base (same scaling as `pricePerUSDNew`),
 *   or `0n` when the counterparty fails the trust gate or the ratio is 0.
 */
export function getPoolImpliedUSD(
  priceRatio1e18: bigint,
  counterparty: Token | undefined,
): bigint {
  if (priceRatio1e18 <= 0n || !counterparty || !isTrusted(counterparty)) {
    return 0n;
  }
  return multiplyBase1e18(priceRatio1e18, counterparty.pricePerUSDNew);
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
 * Gate decision from a Token entity, with an optional defensive heal-on-read
 * (#762). Thin wrapper over {@link getGateDecisionFromSignals} for callers
 * that already have a Token loaded.
 *
 * When `context` is provided and the Token's stored
 * `priceTrustOutcome` / `priceTrustReason` disagree with the freshly-computed
 * decision, the corrected entity is persisted via `context.Token.set`. This
 * self-heals tokens stuck in the desync state described in #761 on the
 * current deployment without requiring a re-replay. When `context` is
 * omitted, the function is pure-read — useful for aggregator unit tests and
 * any caller that does not want the implicit Token.set side effect.
 *
 * Idempotent: a token whose stored fields already match live signals
 * triggers no write.
 *
 * @param token - Token entity. Undefined is reported as `NON_WL` (no
 *   whitelist attestation exists) and never triggers a heal write.
 * @param context - Optional handler context. When provided, drift detected
 *   between stored and freshly-computed gate fields is corrected in-place.
 * @returns `{ trusted, outcome, reason }` decision derived from live signals
 */
export function getGateDecision(
  token: Token | undefined,
  context?: handlerContext,
): PriceTrustDecision {
  if (!token) {
    return {
      trusted: false,
      outcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
      reason: PRICE_TRUST_REASON.NON_WL,
    };
  }
  const fresh = getGateDecisionFromSignals(
    token.chainId,
    token.address,
    token.isWhitelisted,
  );
  if (
    context &&
    (token.priceTrustOutcome !== fresh.outcome ||
      token.priceTrustReason !== fresh.reason)
  ) {
    context.Token.set({
      ...token,
      priceTrustOutcome: fresh.outcome,
      priceTrustReason: fresh.reason,
    });
  }
  return fresh;
}
