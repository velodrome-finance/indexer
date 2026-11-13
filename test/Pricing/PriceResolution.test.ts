import {
  applyPriceResolution,
  isPriceRefreshDue,
} from "../../src/Pricing/PriceResolution";
import {
  ONE_USD,
  PRICING_TIER,
  carriesWithoutExpiry,
} from "../../src/Pricing/PricingConfig";
import {
  DAY_S,
  HOUR_S,
  HOUR_START_S,
  OP,
  OP_TOKEN_X,
  USD,
  makeToken,
} from "./pricingHarness";

const at = (s: number): Date => new Date(s * 1000);

describe("PriceResolution", () => {
  describe("isPriceRefreshDue (strict once-per-clock-hour throttle)", () => {
    it("is due for a token never refreshed", () => {
      expect(isPriceRefreshDue(undefined, HOUR_START_S * 1000)).toBe(true);
    });

    it("is not due again anywhere inside the same clock hour", () => {
      const last = at(HOUR_START_S + 60);
      expect(isPriceRefreshDue(last, (HOUR_START_S + 60) * 1000)).toBe(false);
      expect(isPriceRefreshDue(last, (HOUR_START_S + HOUR_S - 1) * 1000)).toBe(
        false,
      );
    });

    it("is due as soon as the block lands in the next clock hour", () => {
      const last = at(HOUR_START_S + HOUR_S - 1);
      expect(isPriceRefreshDue(last, (HOUR_START_S + HOUR_S) * 1000)).toBe(
        true,
      );
    });

    it("is never due for a block older than the last attempt (deferred replay)", () => {
      const last = at(HOUR_START_S + 5 * HOUR_S);
      expect(isPriceRefreshDue(last, HOUR_START_S * 1000)).toBe(false);
    });
  });

  describe("applyPriceResolution", () => {
    const now = HOUR_START_S + 10 * DAY_S;
    const nowMs = now * 1000;
    const priced = makeToken(OP, OP_TOKEN_X, 18n, USD(3), now - 2 * DAY_S);

    it("pinned: $1 and both clocks advance", () => {
      const { token, priceSource } = applyPriceResolution(
        { ...priced, pricePerUSDNew: 0n },
        { kind: "pinned" },
        nowMs,
      );
      expect(token.pricePerUSDNew).toBe(ONE_USD);
      expect(token.lastUpdatedTimestamp).toEqual(at(now));
      expect(token.lastSuccessfulPriceTimestamp).toEqual(at(now));
      expect(priceSource).toBe("pinned");
    });

    it("pool: takes the price and records pool + depth", () => {
      const applied = applyPriceResolution(
        priced,
        {
          kind: "pool",
          priceUSD: USD(4),
          sourceId: "10-0xPool",
          depthUSD: USD(9),
        },
        nowMs,
      );
      expect(applied.token.pricePerUSDNew).toBe(USD(4));
      expect(applied.token.lastSuccessfulPriceTimestamp).toEqual(at(now));
      expect(applied.priceSource).toBe("pool");
      expect(applied.pricingPoolId).toBe("10-0xPool");
      expect(applied.pricingDepthUSD).toBe(USD(9));
    });

    it("pool and canonical store the winning depth on the token", () => {
      const pool = applyPriceResolution(
        priced,
        {
          kind: "pool",
          priceUSD: USD(4),
          sourceId: "10-0xPool",
          depthUSD: USD(9),
        },
        nowMs,
      );
      expect(pool.token.pricingDepthUSD).toBe(USD(9));
    });

    it("canonical: takes the source price and records the source token", () => {
      const applied = applyPriceResolution(
        priced,
        {
          kind: "canonical",
          priceUSD: USD(5),
          sourceId: "10-0xWETH",
          depthUSD: USD(7_000_000),
        },
        nowMs,
      );
      expect(applied.token.pricePerUSDNew).toBe(USD(5));
      expect(applied.token.pricingDepthUSD).toBe(USD(7_000_000));
      expect(applied.token.lastSuccessfulPriceTimestamp).toEqual(at(now));
      expect(applied.priceSource).toBe("canonical");
      expect(applied.pricingSourceTokenId).toBe("10-0xWETH");
      expect(applied.pricingDepthUSD).toBe(USD(7_000_000));
      expect(applied.pricingPoolId).toBeUndefined();
    });

    it("keeps the depth while carrying and clears it when pinned, overridden or unpriced", () => {
      const withDepth = { ...priced, pricingDepthUSD: USD(9) };
      expect(
        applyPriceResolution(withDepth, { kind: "none" }, nowMs).token
          .pricingDepthUSD,
      ).toBe(USD(9));
      expect(
        applyPriceResolution(withDepth, { kind: "pinned" }, nowMs).token
          .pricingDepthUSD,
      ).toBeUndefined();
      expect(
        applyPriceResolution(withDepth, { kind: "override" }, nowMs).token
          .pricingDepthUSD,
      ).toBeUndefined();
      expect(
        applyPriceResolution(
          { ...withDepth, lastSuccessfulPriceTimestamp: at(now - 8 * DAY_S) },
          { kind: "none" },
          nowMs,
        ).token.pricingDepthUSD,
      ).toBeUndefined();
    });

    it("override: zeroes the price without touching the success clock", () => {
      const applied = applyPriceResolution(priced, { kind: "override" }, nowMs);
      expect(applied.token.pricePerUSDNew).toBe(0n);
      expect(applied.token.lastUpdatedTimestamp).toEqual(at(now));
      expect(applied.token.lastSuccessfulPriceTimestamp).toEqual(
        priced.lastSuccessfulPriceTimestamp,
      );
      expect(applied.priceSource).toBe("override");
    });

    it("none: carries a price whose last success is under 7 days old", () => {
      const lastSuccess = now - 7 * DAY_S + 1;
      const token = makeToken(OP, OP_TOKEN_X, 18n, USD(3), lastSuccess);
      const applied = applyPriceResolution(token, { kind: "none" }, nowMs);
      expect(applied.token.pricePerUSDNew).toBe(USD(3));
      expect(applied.token.lastUpdatedTimestamp).toEqual(at(now));
      expect(applied.token.lastSuccessfulPriceTimestamp).toEqual(
        at(lastSuccess),
      );
      expect(applied.priceSource).toBe("carried");
    });

    it("none: drops to 0 once the last success is 7 days old", () => {
      const lastSuccess = now - 7 * DAY_S;
      const token = makeToken(OP, OP_TOKEN_X, 18n, USD(3), lastSuccess);
      const applied = applyPriceResolution(token, { kind: "none" }, nowMs);
      expect(applied.token.pricePerUSDNew).toBe(0n);
      expect(applied.token.lastSuccessfulPriceTimestamp).toEqual(
        at(lastSuccess),
      );
      expect(applied.priceSource).toBe("unpriced");
    });

    it("none: a token never priced stays at 0", () => {
      const token = makeToken(OP, OP_TOKEN_X, 18n, 0n, now - HOUR_S);
      const applied = applyPriceResolution(token, { kind: "none" }, nowMs);
      expect(applied.token.pricePerUSDNew).toBe(0n);
      expect(applied.token.lastSuccessfulPriceTimestamp).toBeUndefined();
      expect(applied.priceSource).toBe("unpriced");
    });

    it("none: a positive price with no success stamp is not carried", () => {
      const token = {
        ...priced,
        lastSuccessfulPriceTimestamp: undefined,
      };
      const applied = applyPriceResolution(token, { kind: "none" }, nowMs);
      expect(applied.token.pricePerUSDNew).toBe(0n);
      expect(applied.priceSource).toBe("unpriced");
    });

    it("none without expiry (tier 1): carries a price of any age, depth and success clock kept", () => {
      const lastSuccess = now - 90 * DAY_S;
      const token = {
        ...makeToken(OP, OP_TOKEN_X, 18n, USD(2400), lastSuccess),
        pricingDepthUSD: USD(2150),
      };
      const applied = applyPriceResolution(
        token,
        { kind: "none" },
        nowMs,
        true,
      );
      expect(applied.token.pricePerUSDNew).toBe(USD(2400));
      expect(applied.token.pricingDepthUSD).toBe(USD(2150));
      expect(applied.token.lastSuccessfulPriceTimestamp).toEqual(
        at(lastSuccess),
      );
      expect(applied.token.lastUpdatedTimestamp).toEqual(at(now));
      expect(applied.priceSource).toBe("carried");
    });

    it("none without expiry still never invents a price", () => {
      const never = makeToken(OP, OP_TOKEN_X, 18n, 0n, now - HOUR_S);
      expect(
        applyPriceResolution(never, { kind: "none" }, nowMs, true).priceSource,
      ).toBe("unpriced");
      const unstamped = { ...priced, lastSuccessfulPriceTimestamp: undefined };
      expect(
        applyPriceResolution(unstamped, { kind: "none" }, nowMs, true).token
          .pricePerUSDNew,
      ).toBe(0n);
    });

    it("without expiry, an override still zeroes the price", () => {
      expect(
        applyPriceResolution(priced, { kind: "override" }, nowMs, true).token
          .pricePerUSDNew,
      ).toBe(0n);
    });
  });

  describe("carriesWithoutExpiry", () => {
    it("is tier 1 (the chain's WETH) only", () => {
      expect(carriesWithoutExpiry(PRICING_TIER.PINNED)).toBe(false);
      expect(carriesWithoutExpiry(PRICING_TIER.WETH)).toBe(true);
      expect(carriesWithoutExpiry(PRICING_TIER.CONNECTOR)).toBe(false);
      expect(carriesWithoutExpiry(PRICING_TIER.OTHER)).toBe(false);
    });
  });
});
