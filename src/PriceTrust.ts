import type { Token } from "envio";
import { CHAIN_CONSTANTS, TEN_TO_THE_18_BI, chainIdOf } from "./Constants";
import type { handlerContext } from "./EntityTypes";
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
 * - `LISTED` — not legacy-whitelisted, but listed in the chain's Aero
 *   TokenRegistry (`Token.isListedOnAero`) and not blacklisted (trusted, ADR 0005)
 * - `CONNECTOR` — neither whitelisted nor listed, but a configured price
 *   connector on its chain and not in the operator BLACKLIST (trusted, #898)
 * - `BLACKLISTED` — has a positive trust signal (whitelist, listing and/or
 *   connector) but the operator BLACKLIST overrides it
 * - `NON_WL` — no positive trust signal: neither whitelisted, listed nor a
 *   connector (regardless of BLACKLIST membership)
 */
export const PRICE_TRUST_REASON = {
  WL: "WL",
  LISTED: "LISTED",
  CONNECTOR: "CONNECTOR",
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
 * Per-chain set of lowercased price-connector addresses, built once at module
 * load from {@link CHAIN_CONSTANTS}. Mirrors the eager-Map idiom used for
 * `PRICE_REBIND` in PriceOverrides — so the hot trust gate ({@link isTrusted},
 * consulted on every swap leg) does an O(1) membership test instead of
 * re-scanning and re-lowercasing each chain's connector array per call.
 */
const CONNECTOR_SETS: ReadonlyMap<number, ReadonlySet<string>> = new Map(
  Object.entries(CHAIN_CONSTANTS).map(([chainId, constants]) => [
    Number(chainId),
    new Set(constants.priceConnectors.map((c) => c.address.toLowerCase())),
  ]),
);

/**
 * Whether `address` is one of `chainId`'s configured price connectors — the
 * canonical base assets (WETH, USDC, the chain's gov token, …) every other
 * token's price is derived through (src/constants/price_connectors.json,
 * surfaced as `CHAIN_CONSTANTS[chainId].priceConnectors`; tiers 0–2 of
 * the pool-derived pricing in docs/adr/0003-pool-derived-token-prices.md).
 *
 * A token the indexer trusts enough to *derive* prices from is, by the same
 * token, trustworthy enough to *value* — so connector membership is a positive
 * trust signal alongside the protocol whitelist (#898). This recovers
 * whole-chain USD on leaf deployments (Mode/Swell) that never captured a
 * `WhitelistToken` event, and WETH-paired TVL on Soneium/Metal.
 *
 * @param chainId - Chain the token lives on
 * @param address - Token address (any case; compared lowercased)
 * @returns true iff the address is a configured connector on the chain; false
 *   for unknown chains
 */
export function isConnectorToken(chainId: number, address: string): boolean {
  return CONNECTOR_SETS.get(chainId)?.has(address.toLowerCase()) ?? false;
}

/**
 * Price-trust gate. Returns true iff the token has a positive trust signal —
 * protocol whitelist (`WhitelistToken` events) OR membership in its chain's
 * configured price connectors (#898) — AND is not present in the
 * operator-maintained BLACKLIST override.
 *
 * Delegates to {@link getGateDecisionFromSignals} so this live gate and the
 * persisted `priceTrustOutcome` / `priceTrustReason` fields can never diverge.
 * The gate consults only signals the indexer already has (no RPC, no entity
 * reads): O(1) given the eagerly-built {@link isConnectorToken} lookup.
 *
 * @param token - Token entity from the indexer. Undefined inputs are
 *   treated as untrusted (the indexer cannot trust what it does not have).
 * @returns true when the token's price may be multiplied into USD aggregates;
 *   false otherwise
 */
export function isTrusted(token: Token | undefined): boolean {
  if (!token) return false;
  return getGateDecisionFromSignals(
    chainIdOf(token),
    token.address,
    token.isWhitelisted,
    token.isListedOnAero ?? false,
  ).trusted;
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
 * Whether `address` is a "hard anchor" on `chainId` — a token whose USD value
 * is structurally reliable enough to use as ground truth for the directional
 * TVL cap (#892): the chain's USDC `destinationToken`, any configured
 * stablecoin, or the chain's canonical WETH connector.
 *
 * Stricter than {@link isTrusted}: being protocol-whitelisted is not enough; a
 * hard anchor is one of the few tokens the indexer treats as a USD yardstick.
 * Stablecoins are valued at a hard $1 pin and WETH at its own stored price (see
 * {@link getHardAnchorUnitUSD}).
 *
 * `destinationToken` is checked explicitly because `buildStablecoinSet`
 * (src/Constants.ts) deliberately EXCLUDES it from `stablecoins` — it is the
 * pricing target, not a connector — yet it is the primary stablecoin
 * on every chain (USDC on Optimism/Base, oUSDT on Lisk/Metal, …).
 *
 * @param chainId - Chain the token lives on
 * @param address - Token address (any case; compared lowercased)
 * @returns true iff the address is a stablecoin / destination token or WETH on
 *   the chain; false for unknown chains
 */
export function isHardAnchor(chainId: number, address: string): boolean {
  const constants = CHAIN_CONSTANTS[chainId];
  if (!constants) return false;
  const lower = address.toLowerCase();
  return (
    lower === constants.destinationToken.toLowerCase() ||
    constants.stablecoins.has(lower) ||
    lower === constants.weth.toLowerCase()
  );
}

/**
 * USD value of one whole unit of a hard-anchor token (1e18-base), or `0n` when
 * the token is not a hard anchor on the chain or cannot be valued.
 *
 * Stablecoins and the chain's `destinationToken` are pinned to exactly $1
 * regardless of their stored `pricePerUSDNew` (which the pricing code also pins
 * to $1, ADR 0003), so the anchor used to sanity-check other legs can never
 * drift. WETH is valued at its stored, pool-derived `pricePerUSDNew`; an
 * unpriced WETH (`0n`) returns `0n`, which makes every downstream cap check
 * inert (an unusable anchor).
 *
 * @param chainId - Chain the token lives on
 * @param token - Candidate anchor token (carries address + pricePerUSDNew).
 *   Undefined ⇒ `0n`.
 * @returns `$1` (1e18-base) for a stablecoin / destination anchor, WETH's stored
 *   price for the WETH anchor, or `0n` when `token` is not a hard anchor
 */
export function getHardAnchorUnitUSD(
  chainId: number,
  token: Token | undefined,
): bigint {
  if (!token) return 0n;
  const constants = CHAIN_CONSTANTS[chainId];
  if (!constants) return 0n;
  const lower = token.address.toLowerCase();
  if (
    lower === constants.destinationToken.toLowerCase() ||
    constants.stablecoins.has(lower)
  ) {
    return TEN_TO_THE_18_BI; // hard $1 pin
  }
  if (lower === constants.weth.toLowerCase()) {
    return token.pricePerUSDNew; // WETH stored price (0n ⇒ anchor unusable)
  }
  return 0n;
}

/**
 * Gate decision from raw signals, without a Token entity. Used at Token
 * construction time (handlers + tests) so the persisted
 * `priceTrustOutcome` / `priceTrustReason` fields are populated in lockstep
 * with `isWhitelisted` rather than left null until the first aggregator consult.
 *
 * Trust requires a positive signal: legacy protocol whitelist, Aero
 * TokenRegistry listing (ADR 0005) OR a configured price connector (#898). The
 * operator BLACKLIST overrides any signal downward.
 *
 * Reason precedence:
 *  - No positive signal at all ⇒ `NON_WL` — and BLACKLIST membership is
 *    irrelevant here (there is nothing to override), preserving the pre-#898
 *    semantic that a non-whitelisted, non-connector token reports `NON_WL` even
 *    when blacklisted.
 *  - A positive signal exists but the address is blacklisted ⇒ `BLACKLISTED`
 *    (operator override beats every signal).
 *  - Otherwise trusted, tagged `WL` when whitelisted (the stronger provenance),
 *    else `LISTED` when Aero-listed, else `CONNECTOR`.
 *
 * @param chainId - Chain ID for BLACKLIST + connector lookup
 * @param address - Token address (EIP-55 checksum) for BLACKLIST + connector lookup
 * @param isWhitelisted - Protocol-whitelist signal from the legacy Voter contract
 * @param isListedOnAero - Listing signal from the Aero TokenRegistry (default false)
 * @returns `{ trusted, outcome, reason }` decision
 */
export function getGateDecisionFromSignals(
  chainId: number,
  address: string,
  isWhitelisted: boolean,
  isListedOnAero = false,
): PriceTrustDecision {
  const isConnector = isConnectorToken(chainId, address);
  if (!isWhitelisted && !isListedOnAero && !isConnector) {
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
    reason: isWhitelisted
      ? PRICE_TRUST_REASON.WL
      : isListedOnAero
        ? PRICE_TRUST_REASON.LISTED
        : PRICE_TRUST_REASON.CONNECTOR,
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
    chainIdOf(token),
    token.address,
    token.isWhitelisted,
    token.isListedOnAero ?? false,
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
