import type { Token, handlerContext } from "generated";
import { TEN_TO_THE_18_BI, TokenId, toChecksumAddress } from "../src/Constants";
import {
  PRICE_TRUST_OUTCOME,
  PRICE_TRUST_REASON,
  getGateDecision,
  getGateDecisionFromSignals,
  getTrustedUSD,
  isTrusted,
} from "../src/PriceTrust";

/**
 * Minimal mock for the slice of {@link handlerContext} that
 * {@link getGateDecision}'s heal-on-read path touches. Records `Token.set`
 * calls in `writes` so tests can assert exact entity payloads and whether
 * any write fired at all.
 */
function makeMockContext(): {
  context: handlerContext;
  writes: Token[];
} {
  const writes: Token[] = [];
  const context = {
    Token: {
      set: (token: Token) => {
        writes.push(token);
      },
    },
  } as unknown as handlerContext;
  return { context, writes };
}

// Real BLACKLIST entries (from src/PriceOverrides.ts) used to exercise the
// blacklist override path without rebuilding the override fixture.
const MANATEE_OP = toChecksumAddress(
  "0x7909Bda52eAf7C3cc12745E727Eb527a485241D8",
);
const ION_LISK = toChecksumAddress(
  "0x3f608A49a3ab475dA7fBb167C1Be6b7a45cD7013",
);

// A canonical, never-blacklisted token (WETH on Optimism).
const WETH_OP = toChecksumAddress("0x4200000000000000000000000000000000000006");

function makeToken(overrides: Partial<Token> = {}): Token {
  const chainId = overrides.chainId ?? 10;
  const address = overrides.address ?? WETH_OP;
  const isWhitelisted = overrides.isWhitelisted ?? true;
  // Derive the stored gate decision from the fixture's own signals so the
  // mock matches what prod will store after Token construction routes through
  // PriceTrust.getGateDecisionFromSignals. Overrides spread last and can still
  // pin specific values for tests that need to exercise stale-decision paths.
  const decision = getGateDecisionFromSignals(chainId, address, isWhitelisted);
  return {
    id: TokenId(chainId, address),
    address: address as `0x${string}`,
    symbol: "WETH",
    name: "Wrapped Ether",
    chainId,
    decimals: 18n,
    pricePerUSDNew: 1n * TEN_TO_THE_18_BI,
    isWhitelisted,
    lastUpdatedTimestamp: new Date(),
    lastSuccessfulPriceTimestamp: new Date(),
    priceTrustOutcome: decision.outcome,
    priceTrustReason: decision.reason,
    ...overrides,
  };
}

describe("PriceTrust", () => {
  describe("isTrusted", () => {
    it("returns true for WL + not-BL", () => {
      expect(isTrusted(makeToken({ isWhitelisted: true }))).toBe(true);
    });

    it("returns false for WL + BL (operator override beats protocol whitelist)", () => {
      const token = makeToken({
        chainId: 1135,
        address: ION_LISK,
        isWhitelisted: true,
      });
      expect(isTrusted(token)).toBe(false);
    });

    it("returns false for non-WL + not-BL", () => {
      expect(isTrusted(makeToken({ isWhitelisted: false }))).toBe(false);
    });

    it("returns false for non-WL + BL (both signals agree)", () => {
      const token = makeToken({
        chainId: 10,
        address: MANATEE_OP,
        isWhitelisted: false,
      });
      expect(isTrusted(token)).toBe(false);
    });

    it("returns false for undefined token", () => {
      expect(isTrusted(undefined)).toBe(false);
    });
  });

  describe("getGateDecision", () => {
    it("returns trusted=true and reason='WL' for WL + not-BL", () => {
      expect(getGateDecision(makeToken())).toEqual({
        trusted: true,
        outcome: PRICE_TRUST_OUTCOME.TRUSTED,
        reason: PRICE_TRUST_REASON.WL,
      });
    });

    it("returns trusted=false and reason='BLACKLISTED' for WL + BL", () => {
      const token = makeToken({
        chainId: 1135,
        address: ION_LISK,
        isWhitelisted: true,
      });
      expect(getGateDecision(token)).toEqual({
        trusted: false,
        outcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
        reason: PRICE_TRUST_REASON.BLACKLISTED,
      });
    });

    it("returns trusted=false and reason='NON_WL' for non-WL (not blacklisted)", () => {
      expect(getGateDecision(makeToken({ isWhitelisted: false }))).toEqual({
        trusted: false,
        outcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
        reason: PRICE_TRUST_REASON.NON_WL,
      });
    });

    it("returns trusted=false and reason='NON_WL' for non-WL (even if also blacklisted)", () => {
      const token = makeToken({
        chainId: 10,
        address: MANATEE_OP,
        isWhitelisted: false,
      });
      expect(getGateDecision(token)).toEqual({
        trusted: false,
        outcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
        reason: PRICE_TRUST_REASON.NON_WL,
      });
    });

    it("returns trusted=false and reason='NON_WL' for undefined token", () => {
      expect(getGateDecision(undefined)).toEqual({
        trusted: false,
        outcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
        reason: PRICE_TRUST_REASON.NON_WL,
      });
    });
  });

  // Defensive shim (#762): when called with a handler context, getGateDecision
  // recomputes the decision from live signals and persists a corrected Token
  // entity via context.Token.set whenever the stored priceTrust* fields
  // disagree with what getGateDecisionFromSignals would produce now. This
  // self-heals tokens stuck in the Issue B desync state (#761) on the current
  // deployment without requiring a re-replay.
  describe("getGateDecision heal-on-read", () => {
    it("heals stuck UNTRUSTED token (WL=true, stored UNTRUSTED/NON_WL) → returns TRUSTED/WL and writes correction", () => {
      const { context, writes } = makeMockContext();
      const stuck = makeToken({
        isWhitelisted: true,
        priceTrustOutcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
        priceTrustReason: PRICE_TRUST_REASON.NON_WL,
      });

      const decision = getGateDecision(stuck, context);

      expect(decision).toEqual({
        trusted: true,
        outcome: PRICE_TRUST_OUTCOME.TRUSTED,
        reason: PRICE_TRUST_REASON.WL,
      });
      expect(writes).toHaveLength(1);
      expect(writes[0]).toEqual({
        ...stuck,
        priceTrustOutcome: PRICE_TRUST_OUTCOME.TRUSTED,
        priceTrustReason: PRICE_TRUST_REASON.WL,
      });
    });

    it("downgrades stored-TRUSTED token (WL=false, stored TRUSTED/WL) → returns UNTRUSTED/NON_WL and writes correction", () => {
      const { context, writes } = makeMockContext();
      const stale = makeToken({
        isWhitelisted: false,
        priceTrustOutcome: PRICE_TRUST_OUTCOME.TRUSTED,
        priceTrustReason: PRICE_TRUST_REASON.WL,
      });

      const decision = getGateDecision(stale, context);

      expect(decision).toEqual({
        trusted: false,
        outcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
        reason: PRICE_TRUST_REASON.NON_WL,
      });
      expect(writes).toHaveLength(1);
      expect(writes[0]).toEqual({
        ...stale,
        priceTrustOutcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
        priceTrustReason: PRICE_TRUST_REASON.NON_WL,
      });
    });

    it("is idempotent for an already-consistent token (no spurious Token.set)", () => {
      const { context, writes } = makeMockContext();
      // makeToken() derives stored fields from signals, so this is consistent.
      const consistent = makeToken({ isWhitelisted: true });

      const decision = getGateDecision(consistent, context);

      expect(decision.trusted).toBe(true);
      expect(decision.outcome).toBe(PRICE_TRUST_OUTCOME.TRUSTED);
      expect(decision.reason).toBe(PRICE_TRUST_REASON.WL);
      expect(writes).toHaveLength(0);
    });

    it("heals a BLACKLISTED address with WL=true to UNTRUSTED/BLACKLISTED (precedence preserved)", () => {
      const { context, writes } = makeMockContext();
      // Token sat in DB with stale TRUSTED/WL fields but address is in BLACKLIST.
      const blacklisted = makeToken({
        chainId: 1135,
        address: ION_LISK,
        isWhitelisted: true,
        priceTrustOutcome: PRICE_TRUST_OUTCOME.TRUSTED,
        priceTrustReason: PRICE_TRUST_REASON.WL,
      });

      const decision = getGateDecision(blacklisted, context);

      expect(decision).toEqual({
        trusted: false,
        outcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
        reason: PRICE_TRUST_REASON.BLACKLISTED,
      });
      expect(writes).toHaveLength(1);
      expect(writes[0]).toEqual({
        ...blacklisted,
        priceTrustOutcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
        priceTrustReason: PRICE_TRUST_REASON.BLACKLISTED,
      });
    });

    it("does not write when called without a context (pure-read mode)", () => {
      // Stuck token but no context provided — heal must not throw and must not
      // attempt any persistence path. Behaviour matches the legacy
      // single-argument call shape that aggregator unit tests still use.
      const stuck = makeToken({
        isWhitelisted: true,
        priceTrustOutcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
        priceTrustReason: PRICE_TRUST_REASON.NON_WL,
      });

      expect(() => getGateDecision(stuck)).not.toThrow();
      const decision = getGateDecision(stuck);
      expect(decision.trusted).toBe(true);
      expect(decision.outcome).toBe(PRICE_TRUST_OUTCOME.TRUSTED);
      expect(decision.reason).toBe(PRICE_TRUST_REASON.WL);
    });
  });

  describe("getTrustedUSD", () => {
    it("returns amount × price (1e18-base) for a trusted 18-decimal token", () => {
      const token = makeToken({
        decimals: 18n,
        pricePerUSDNew: 1n * TEN_TO_THE_18_BI,
      });
      expect(getTrustedUSD(2n * TEN_TO_THE_18_BI, token)).toBe(
        2n * TEN_TO_THE_18_BI,
      );
    });

    it("normalises across decimals (1 unit of a 6-decimal token at $1 → 1e18)", () => {
      const token = makeToken({
        decimals: 6n,
        pricePerUSDNew: 1n * TEN_TO_THE_18_BI,
      });
      const oneUnit = 1_000_000n;
      expect(getTrustedUSD(oneUnit, token)).toBe(1n * TEN_TO_THE_18_BI);
    });

    it("scales with pricePerUSDNew (1 WETH at $2000 → 2000e18)", () => {
      const token = makeToken({
        decimals: 18n,
        pricePerUSDNew: 2000n * TEN_TO_THE_18_BI,
      });
      expect(getTrustedUSD(1n * TEN_TO_THE_18_BI, token)).toBe(
        2000n * TEN_TO_THE_18_BI,
      );
    });

    it("returns 0n for a non-whitelisted token regardless of price", () => {
      const token = makeToken({
        isWhitelisted: false,
        pricePerUSDNew: 1n * TEN_TO_THE_18_BI,
      });
      expect(getTrustedUSD(2n * TEN_TO_THE_18_BI, token)).toBe(0n);
    });

    it("returns 0n for a WL + BL token (blacklist overrides oracle output)", () => {
      const token = makeToken({
        chainId: 1135,
        address: ION_LISK,
        isWhitelisted: true,
        pricePerUSDNew: 5n * TEN_TO_THE_18_BI,
      });
      expect(getTrustedUSD(100n * TEN_TO_THE_18_BI, token)).toBe(0n);
    });

    it("returns 0n for a zero amount on a trusted token", () => {
      expect(getTrustedUSD(0n, makeToken())).toBe(0n);
    });

    it("returns 0n for an undefined token", () => {
      expect(getTrustedUSD(2n * TEN_TO_THE_18_BI, undefined)).toBe(0n);
    });
  });
});
