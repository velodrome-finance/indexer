import { hasWhitelistTrustDrift } from "../scripts/integrity-audit";

// Audit-script regression test: the two-tier price-trust gate (#755) defines
// WL && BLACKLISTED ⇒ UNTRUSTED/BLACKLISTED as the correct, intentional
// outcome — an operator override for WL'd tokens with broken oracles. The
// pre-fix audit asserted the looser invariant `isWhitelisted ⇒ TRUSTED` and
// flagged the four legitimate WL-and-BLACKLISTED tokens (wOptiDoge/OP,
// ION/Lisk, XAUt0/Ink, KING/Swell) as NEW_REGRESSION (#855). These cases
// must now classify as non-drift.
describe("hasWhitelistTrustDrift", () => {
  it("flags a WL token persisted as UNTRUSTED/NON_WL (the #761 stuck state)", () => {
    expect(
      hasWhitelistTrustDrift({
        isWhitelisted: true,
        priceTrustOutcome: "UNTRUSTED",
        priceTrustReason: "NON_WL",
      }),
    ).toBe(true);
  });

  it("does NOT flag a WL token correctly overridden as UNTRUSTED/BLACKLISTED (#855)", () => {
    // Mirrors all four flagged rows from the 2026-06-10 audit: wOptiDoge/OP,
    // ION/Lisk, XAUt0/Ink, KING/Swell — all WL on-chain, all in PriceOverrides
    // BLACKLIST, correctly resolved by the two-tier gate.
    expect(
      hasWhitelistTrustDrift({
        isWhitelisted: true,
        priceTrustOutcome: "UNTRUSTED",
        priceTrustReason: "BLACKLISTED",
      }),
    ).toBe(false);
  });

  it("does not flag a WL token correctly persisted as TRUSTED/WL", () => {
    expect(
      hasWhitelistTrustDrift({
        isWhitelisted: true,
        priceTrustOutcome: "TRUSTED",
        priceTrustReason: "WL",
      }),
    ).toBe(false);
  });

  it("does not flag a non-WL token regardless of outcome", () => {
    expect(
      hasWhitelistTrustDrift({
        isWhitelisted: false,
        priceTrustOutcome: "UNTRUSTED",
        priceTrustReason: "NON_WL",
      }),
    ).toBe(false);
  });

  it("does not flag a row with priceTrustOutcome=null (pre-field)", () => {
    expect(
      hasWhitelistTrustDrift({
        isWhitelisted: true,
        priceTrustOutcome: null,
        priceTrustReason: null,
      }),
    ).toBe(false);
  });

  it("accepts the lowercase legacy spelling of TRUSTED", () => {
    expect(
      hasWhitelistTrustDrift({
        isWhitelisted: true,
        priceTrustOutcome: "trusted",
        priceTrustReason: "WL",
      }),
    ).toBe(false);
  });
});
