import type { Token } from "envio";
import { TEN_TO_THE_18_BI, TokenId, toChecksumAddress } from "../src/Constants";
import type { handlerContext } from "../src/EntityTypes";
import { isBlacklistedToken } from "../src/PriceOverrides";
import {
  PRICE_TRUST_OUTCOME,
  PRICE_TRUST_REASON,
  getGateDecision,
  getGateDecisionFromSignals,
  getHardAnchorUnitUSD,
  getPoolImpliedUSD,
  getTrustedUSD,
  isConnectorToken,
  isHardAnchor,
  isTrusted,
} from "../src/PriceTrust";
import PriceConnectors from "../src/constants/price_connectors.json";

// Real anchor + non-anchor addresses on Base (chainId 8453) used by the #892
// hard-anchor helpers. USDC is the chain's `destinationToken` (excluded from the
// stablecoins set by buildStablecoinSet), DAI is a member of that set, WETH is
// the canonical OP-stack connector, and LFI is a non-anchor whitelisted token.
const BASE = 8453;
const BASE_USDC = toChecksumAddress(
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
);
const BASE_DAI = toChecksumAddress(
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
);
const BASE_WETH = toChecksumAddress(
  "0x4200000000000000000000000000000000000006",
);
const LFI_BASE = toChecksumAddress(
  "0x3722264aB15a1dfCe5a5af89e6547F7949A8ABA3",
);

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

// Issue #898 fixtures. WETH (`0x4200…0006`) is a price connector on every
// OP-stack chain, so it can no longer stand in for a "generic untrusted token";
// SNX on Optimism is a real token that is NOT a connector and NOT blacklisted,
// used wherever a test needs a token with no positive trust signal.
const SNX_OP = toChecksumAddress("0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4");
// Canonical superchain WETH on Mode (34443) — a connector token that captured
// zero on-chain WhitelistToken events (the bug this issue fixes).
const MODE = 34443;
const WETH_SUPERCHAIN = toChecksumAddress(
  "0x4200000000000000000000000000000000000006",
);
// Already-whitelisted Base connector — the regression anchor: must stay WL.
const USDC_BASE = toChecksumAddress(
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
);

// Maps each price_connectors.json key to its chain ID. A drift guard below
// asserts this stays in lockstep with the JSON, so adding a chain to the config
// without a chain ID here fails loudly rather than silently skipping coverage.
const CONNECTOR_CHAIN_IDS: Record<string, number> = {
  optimism: 10,
  base: 8453,
  mode: 34443,
  lisk: 1135,
  fraxtal: 252,
  soneium: 1868,
  ink: 57073,
  metal: 1750,
  unichain: 130,
  celo: 42220,
  superseed: 5330,
  swellchain: 1923,
};

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
  describe("isConnectorToken (#898)", () => {
    it("returns true for a chain's configured price connector (WETH/Mode)", () => {
      expect(isConnectorToken(MODE, WETH_SUPERCHAIN)).toBe(true);
    });

    it("returns false for a token that is not a connector (SNX/Optimism)", () => {
      expect(isConnectorToken(10, SNX_OP)).toBe(false);
    });

    it("is case-insensitive on the address", () => {
      expect(isConnectorToken(MODE, WETH_SUPERCHAIN.toLowerCase())).toBe(true);
    });

    it("returns false for an unknown chain", () => {
      expect(isConnectorToken(999999, WETH_SUPERCHAIN)).toBe(false);
    });
  });

  describe("getGateDecisionFromSignals connector path (#898)", () => {
    it("trusts a non-whitelisted connector with reason CONNECTOR (WETH/Mode)", () => {
      expect(getGateDecisionFromSignals(MODE, WETH_SUPERCHAIN, false)).toEqual({
        trusted: true,
        outcome: PRICE_TRUST_OUTCOME.TRUSTED,
        reason: PRICE_TRUST_REASON.CONNECTOR,
      });
    });

    it("reports WL (not CONNECTOR) when a connector is also whitelisted — protocol signal wins", () => {
      expect(getGateDecisionFromSignals(MODE, WETH_SUPERCHAIN, true)).toEqual({
        trusted: true,
        outcome: PRICE_TRUST_OUTCOME.TRUSTED,
        reason: PRICE_TRUST_REASON.WL,
      });
    });

    it("still reports NON_WL for a non-whitelisted, non-connector token (SNX/Optimism)", () => {
      expect(getGateDecisionFromSignals(10, SNX_OP, false)).toEqual({
        trusted: false,
        outcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
        reason: PRICE_TRUST_REASON.NON_WL,
      });
    });
  });

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

    it("returns false for non-WL + not-BL (not a connector)", () => {
      expect(
        isTrusted(makeToken({ isWhitelisted: false, address: SNX_OP })),
      ).toBe(false);
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

    it("returns true for a non-whitelisted connector token (#898)", () => {
      // WETH on Mode is a connector but never captured a WhitelistToken event.
      const token = makeToken({
        chainId: MODE,
        address: WETH_SUPERCHAIN,
        isWhitelisted: false,
      });
      expect(isTrusted(token)).toBe(true);
    });

    it("returns false for a non-whitelisted, non-connector token", () => {
      expect(
        isTrusted(makeToken({ isWhitelisted: false, address: SNX_OP })),
      ).toBe(false);
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

    it("returns trusted=false and reason='NON_WL' for non-WL (not blacklisted, not a connector)", () => {
      expect(
        getGateDecision(makeToken({ isWhitelisted: false, address: SNX_OP })),
      ).toEqual({
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
        address: SNX_OP,
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

    it("returns 0n for a non-whitelisted, non-connector token regardless of price", () => {
      const token = makeToken({
        isWhitelisted: false,
        address: SNX_OP,
        pricePerUSDNew: 1n * TEN_TO_THE_18_BI,
      });
      expect(getTrustedUSD(2n * TEN_TO_THE_18_BI, token)).toBe(0n);
    });

    it("returns amount × price for a non-whitelisted connector token (#898)", () => {
      // The fix: a connector leg now contributes USD even with no WhitelistToken
      // event — this is what un-zeroes Mode/Swell TVL and Soneium/Metal WETH.
      const token = makeToken({
        chainId: MODE,
        address: WETH_SUPERCHAIN,
        isWhitelisted: false,
        decimals: 18n,
        pricePerUSDNew: 1500n * TEN_TO_THE_18_BI,
      });
      expect(getTrustedUSD(2n * TEN_TO_THE_18_BI, token)).toBe(
        3000n * TEN_TO_THE_18_BI,
      );
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

  describe("getPoolImpliedUSD", () => {
    it("scales the pool price ratio by the counterparty's trusted USD price", () => {
      // token0 worth 0.00005 of token1; token1 (WETH) priced $2000.
      // implied token0 USD = 0.00005 * 2000 = $0.10.
      const ratio1e18 = 50_000_000_000_000n; // 0.00005 * 1e18
      const counterparty = makeToken({
        isWhitelisted: true,
        pricePerUSDNew: 2000n * TEN_TO_THE_18_BI,
      });
      expect(getPoolImpliedUSD(ratio1e18, counterparty)).toBe(
        100_000_000_000_000_000n, // $0.10 * 1e18
      );
    });

    it("returns 0n when the counterparty is untrusted (no ground truth)", () => {
      const ratio1e18 = 50_000_000_000_000n;
      const untrusted = makeToken({
        isWhitelisted: false,
        address: SNX_OP,
        pricePerUSDNew: 2000n * TEN_TO_THE_18_BI,
      });
      expect(getPoolImpliedUSD(ratio1e18, untrusted)).toBe(0n);
    });

    it("returns 0n for a zero ratio or undefined counterparty", () => {
      const trusted = makeToken({
        isWhitelisted: true,
        pricePerUSDNew: 2000n * TEN_TO_THE_18_BI,
      });
      expect(getPoolImpliedUSD(0n, trusted)).toBe(0n);
      expect(getPoolImpliedUSD(50_000_000_000_000n, undefined)).toBe(0n);
    });
  });

  describe("isHardAnchor (#892)", () => {
    it("returns true for the chain's destination token (USDC/Base)", () => {
      // USDC is the destinationToken — excluded from the stablecoins set, so
      // this proves the explicit destinationToken check is load-bearing.
      expect(isHardAnchor(BASE, BASE_USDC)).toBe(true);
    });

    it("returns true for a stablecoin-set member (DAI/Base)", () => {
      expect(isHardAnchor(BASE, BASE_DAI)).toBe(true);
    });

    it("returns true for the chain's WETH connector", () => {
      expect(isHardAnchor(BASE, BASE_WETH)).toBe(true);
    });

    it("is case-insensitive on the address", () => {
      expect(isHardAnchor(BASE, BASE_USDC.toLowerCase())).toBe(true);
    });

    it("returns false for a non-anchor whitelisted token (LFI/Base)", () => {
      expect(isHardAnchor(BASE, LFI_BASE)).toBe(false);
    });

    it("returns false for an unknown chain", () => {
      expect(isHardAnchor(999999, BASE_USDC)).toBe(false);
    });
  });

  describe("getHardAnchorUnitUSD (#892)", () => {
    it("pins a destination-token stablecoin to $1, ignoring its oracle price", () => {
      const usdc = makeToken({
        chainId: BASE,
        address: BASE_USDC,
        decimals: 6n,
        // Deliberately wrong oracle value — the $1 pin must override it.
        pricePerUSDNew: 999n * TEN_TO_THE_18_BI,
      });
      expect(getHardAnchorUnitUSD(BASE, usdc)).toBe(TEN_TO_THE_18_BI);
    });

    it("pins a stablecoin-set member to $1", () => {
      const dai = makeToken({
        chainId: BASE,
        address: BASE_DAI,
        decimals: 18n,
      });
      expect(getHardAnchorUnitUSD(BASE, dai)).toBe(TEN_TO_THE_18_BI);
    });

    it("values WETH at its oracle pricePerUSDNew", () => {
      const weth = makeToken({
        chainId: BASE,
        address: BASE_WETH,
        decimals: 18n,
        pricePerUSDNew: 1600n * TEN_TO_THE_18_BI,
      });
      expect(getHardAnchorUnitUSD(BASE, weth)).toBe(1600n * TEN_TO_THE_18_BI);
    });

    it("returns 0n for a non-anchor token", () => {
      const lfi = makeToken({
        chainId: BASE,
        address: LFI_BASE,
        pricePerUSDNew: 24n * TEN_TO_THE_18_BI,
      });
      expect(getHardAnchorUnitUSD(BASE, lfi)).toBe(0n);
    });

    it("returns 0n for an undefined token and for an unknown chain", () => {
      expect(getHardAnchorUnitUSD(BASE, undefined)).toBe(0n);
      const usdc = makeToken({ chainId: BASE, address: BASE_USDC });
      expect(getHardAnchorUnitUSD(999999, usdc)).toBe(0n);
    });
  });

  // AC (#898): "A test asserts connector tokens are trusted on each chain that
  // defines a connector list." Data-driven straight from price_connectors.json
  // so config and trust policy can never silently drift apart.
  describe("every configured connector resolves to TRUSTED/CONNECTOR (#898)", () => {
    it("covers exactly the chains defined in price_connectors.json (no silent gaps)", () => {
      expect(Object.keys(PriceConnectors).sort()).toEqual(
        Object.keys(CONNECTOR_CHAIN_IDS).sort(),
      );
    });

    for (const [chainName, chainId] of Object.entries(CONNECTOR_CHAIN_IDS)) {
      const connectors = (
        PriceConnectors as Record<string, { address: string }[]>
      )[chainName];

      it(`${chainName} (${chainId}): all ${connectors.length} connectors trusted with reason CONNECTOR when not whitelisted`, () => {
        expect(connectors.length).toBeGreaterThan(0);
        for (const { address } of connectors) {
          expect(isConnectorToken(chainId, address)).toBe(true);
          expect(
            getGateDecisionFromSignals(
              chainId,
              toChecksumAddress(address),
              false,
            ),
          ).toEqual({
            trusted: true,
            outcome: PRICE_TRUST_OUTCOME.TRUSTED,
            reason: PRICE_TRUST_REASON.CONNECTOR,
          });
        }
      });
    }

    // The CONNECTOR reason above assumes no connector is also blacklisted. If
    // that ever changes, the operator BLACKLIST must still win — blacklist is
    // checked after the trust-signal gate, so such a token resolves
    // UNTRUSTED/BLACKLISTED — and these assertions force a deliberate review.
    it("no configured connector is also blacklisted (connector-trust ∩ BLACKLIST = ∅)", () => {
      for (const [chainName, chainId] of Object.entries(CONNECTOR_CHAIN_IDS)) {
        const connectors = (
          PriceConnectors as Record<string, { address: string }[]>
        )[chainName];
        for (const { address } of connectors) {
          expect(isBlacklistedToken(chainId, toChecksumAddress(address))).toBe(
            false,
          );
        }
      }
    });
  });

  // Regression (#898): chains/tokens that were already correct must not move.
  describe("regression: already-whitelisted connectors keep reason WL (#898)", () => {
    it("Base USDC (whitelisted connector) stays TRUSTED/WL, not CONNECTOR", () => {
      expect(getGateDecisionFromSignals(BASE, USDC_BASE, true)).toEqual({
        trusted: true,
        outcome: PRICE_TRUST_OUTCOME.TRUSTED,
        reason: PRICE_TRUST_REASON.WL,
      });
    });
  });
});
