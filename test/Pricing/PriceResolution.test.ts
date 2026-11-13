import {
  applyPriceResolution,
  isPriceRefreshDue,
} from "../../src/Pricing/PriceResolution";
import { ONE_USD } from "../../src/Pricing/PricingConfig";
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
          poolId: "10-0xPool",
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

    it("rebind: takes the source price as a success", () => {
      const applied = applyPriceResolution(
        priced,
        { kind: "rebind", priceUSD: USD(5) },
        nowMs,
      );
      expect(applied.token.pricePerUSDNew).toBe(USD(5));
      expect(applied.token.lastSuccessfulPriceTimestamp).toEqual(at(now));
      expect(applied.priceSource).toBe("rebind");
      expect(applied.pricingPoolId).toBeUndefined();
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
  });
});
