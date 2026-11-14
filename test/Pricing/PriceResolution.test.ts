import {
  applyPriceResolution,
  isCounterpartyPriceFresh,
  isPriceRefreshDue,
} from "../../src/Pricing/PriceResolution";
import {
  COUNTERPARTY_FRESHNESS_MS,
  ONE_USD,
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

    it("none: every tier's carry ends after 7 days (no exemption for WETH or connectors)", () => {
      const token = {
        ...makeToken(OP, OP_TOKEN_X, 18n, USD(2400), now - 7 * DAY_S),
        pricingDepthUSD: USD(2150),
      };
      const applied = applyPriceResolution(token, { kind: "none" }, nowMs);
      expect(applied.token.pricePerUSDNew).toBe(0n);
      expect(applied.token.pricingDepthUSD).toBeUndefined();
      expect(applied.priceSource).toBe("unpriced");
    });
  });

  describe("isCounterpartyPriceFresh (a route is only as fresh as its base)", () => {
    const now = HOUR_START_S + 10 * DAY_S;
    const nowMs = now * 1000;

    it(`accepts a counterparty whose last success is at most ${COUNTERPARTY_FRESHNESS_MS / (HOUR_S * 1000)} h old`, () => {
      expect(isCounterpartyPriceFresh(at(now), nowMs)).toBe(true);
      expect(
        isCounterpartyPriceFresh(
          new Date(nowMs - COUNTERPARTY_FRESHNESS_MS),
          nowMs,
        ),
      ).toBe(true);
    });

    it("rejects one that is older, or was never priced", () => {
      expect(
        isCounterpartyPriceFresh(
          new Date(nowMs - COUNTERPARTY_FRESHNESS_MS - 1000),
          nowMs,
        ),
      ).toBe(false);
      expect(isCounterpartyPriceFresh(at(now - 120 * DAY_S), nowMs)).toBe(
        false,
      );
      expect(isCounterpartyPriceFresh(undefined, nowMs)).toBe(false);
    });

    it("accepts a success later than the block (a deferred replay)", () => {
      expect(isCounterpartyPriceFresh(at(now + HOUR_S), nowMs)).toBe(true);
    });
  });
});
