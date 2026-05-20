import type { Token } from "generated";
import { TEN_TO_THE_18_BI, TokenId, toChecksumAddress } from "../src/Constants";
import { getGateDecision, getTrustedUSD, isTrusted } from "../src/PriceTrust";

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
  return {
    id: TokenId(chainId, address),
    address: address as `0x${string}`,
    symbol: "WETH",
    name: "Wrapped Ether",
    chainId,
    decimals: 18n,
    pricePerUSDNew: 1n * TEN_TO_THE_18_BI,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
    lastSuccessfulPriceTimestamp: new Date(),
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
        reason: "WL",
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
        reason: "BLACKLISTED",
      });
    });

    it("returns trusted=false and reason='NON_WL' for non-WL (not blacklisted)", () => {
      expect(getGateDecision(makeToken({ isWhitelisted: false }))).toEqual({
        trusted: false,
        reason: "NON_WL",
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
        reason: "NON_WL",
      });
    });

    it("returns trusted=false and reason='NON_WL' for undefined token", () => {
      expect(getGateDecision(undefined)).toEqual({
        trusted: false,
        reason: "NON_WL",
      });
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
