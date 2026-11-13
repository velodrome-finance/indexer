import { describe, expect, it } from "vitest";
import {
  clSpotPrice0,
  deriveCLPriceRatios,
  deriveV2PriceRatios,
  deriveV2StablePriceRatios,
  pickPriceRatios,
  poolSpotPrice0,
  v2StableSpotPrice0,
  v2VolatileSpotPrice0,
} from "../src/PoolPriceRatio";

const TEN_TO_THE_18 = 10n ** 18n;
const Q96 = 2n ** 96n;

describe("deriveV2PriceRatios", () => {
  it("derives token0Price = reserve1/reserve0 for equal-decimal tokens", () => {
    // 1000 token0, 2000 token1 (both 18 decimals): 1 token0 == 2 token1.
    const { token0Price, token1Price } = deriveV2PriceRatios(
      1000n * TEN_TO_THE_18,
      2000n * TEN_TO_THE_18,
      18n,
      18n,
    );

    // token0Price = price of token0 in token1 units = 2.0
    expect(token0Price).toBe(2n * TEN_TO_THE_18);
    // token1Price = price of token1 in token0 units = 0.5
    expect(token1Price).toBe(TEN_TO_THE_18 / 2n);
  });

  it("decimal-adjusts across tokens of different decimals", () => {
    // token0 = USDC (6 dec), 2000 USDC; token1 = WETH (18 dec), 1 WETH.
    // 1 WETH == 2000 USDC, so 1 USDC == 0.0005 WETH.
    const { token0Price, token1Price } = deriveV2PriceRatios(
      2000n * 10n ** 6n,
      1n * TEN_TO_THE_18,
      6n,
      18n,
    );

    // token0Price = price of one USDC in WETH = 0.0005
    expect(token0Price).toBe(5n * 10n ** 14n);
    // token1Price = price of one WETH in USDC = 2000
    expect(token1Price).toBe(2000n * TEN_TO_THE_18);
  });

  it("returns {0n, 0n} for an empty pool (zero reserve)", () => {
    expect(deriveV2PriceRatios(0n, 1n * TEN_TO_THE_18, 18n, 18n)).toEqual({
      token0Price: 0n,
      token1Price: 0n,
    });
    expect(deriveV2PriceRatios(1n * TEN_TO_THE_18, 0n, 18n, 18n)).toEqual({
      token0Price: 0n,
      token1Price: 0n,
    });
  });
});

describe("deriveCLPriceRatios", () => {
  it("derives a price of 1.0 when sqrtPriceX96 = 2^96 and decimals match", () => {
    // (sqrtPriceX96 / 2^96)^2 = 1 → 1 token0 == 1 token1.
    const { token0Price, token1Price } = deriveCLPriceRatios(Q96, 18n, 18n);

    expect(token0Price).toBe(TEN_TO_THE_18);
    expect(token1Price).toBe(TEN_TO_THE_18);
  });

  it("decimal-adjusts across tokens of different decimals", () => {
    // rawPrice = 1 (sqrtPriceX96 = 2^96), token0 = 18 dec, token1 = 6 dec.
    // 1 raw token1 per 1 raw token0 → 1 whole token0 (1e18 raw) buys 1e12 whole token1.
    const { token0Price, token1Price } = deriveCLPriceRatios(Q96, 18n, 6n);

    expect(token0Price).toBe(10n ** 30n); // 1e12 whole token1, 1e18-scaled
    expect(token1Price).toBe(10n ** 6n); // 1e-12 whole token0, 1e18-scaled
  });

  it("returns {0n, 0n} for an uninitialised pool (sqrtPriceX96 = 0)", () => {
    expect(deriveCLPriceRatios(0n, 18n, 18n)).toEqual({
      token0Price: 0n,
      token1Price: 0n,
    });
  });
});

describe("pickPriceRatios", () => {
  const lastKnown = { token0Price: 100n, token1Price: 200n };

  it("keeps the derived ratios when both legs are positive", () => {
    const derived = { token0Price: 3n, token1Price: 7n };
    expect(pickPriceRatios(derived, lastKnown)).toEqual(derived);
  });

  it("falls back to the last-known value only for the leg that derives to 0n", () => {
    expect(
      pickPriceRatios({ token0Price: 0n, token1Price: 7n }, lastKnown),
    ).toEqual({ token0Price: 100n, token1Price: 7n });
  });

  it("returns the last-known ratios when the derivation is fully undefined (both 0n)", () => {
    expect(
      pickPriceRatios({ token0Price: 0n, token1Price: 0n }, lastKnown),
    ).toEqual(lastKnown);
  });
});

describe("deriveV2StablePriceRatios (sAMM x³y + xy³)", () => {
  it("is exactly 1:1 for a balanced pool, across 6/18 decimals", () => {
    // 1M USDC (6 dec) vs 1M DAI (18 dec)
    expect(
      deriveV2StablePriceRatios(
        1_000_000n * 10n ** 6n,
        1_000_000n * TEN_TO_THE_18,
        6n,
        18n,
      ),
    ).toEqual({ token0Price: TEN_TO_THE_18, token1Price: TEN_TO_THE_18 });
  });

  it("uses the curve's marginal price for an imbalanced pool", () => {
    // x = 1, y = 2 (whole units): dy/dx = y(3x²+y²)/(x(x²+3y²)) = 14/13.
    const { token0Price, token1Price } = deriveV2StablePriceRatios(
      1_000_000n * 10n ** 6n,
      2_000_000n * TEN_TO_THE_18,
      6n,
      18n,
    );
    expect(token0Price).toBe((14n * TEN_TO_THE_18) / 13n);
    expect(token1Price).toBe((13n * TEN_TO_THE_18) / 14n);
    // The constant-product ratio would have said 2.0.
    expect(deriveV2PriceRatios(1n, 2n, 0n, 0n).token0Price).toBe(
      2n * TEN_TO_THE_18,
    );
  });

  it("handles 0- and 8-decimal tokens exactly", () => {
    // 3 whole units of a 0-dec token vs 3 whole units of an 8-dec token.
    expect(deriveV2StablePriceRatios(3n, 3n * 10n ** 8n, 0n, 8n)).toEqual({
      token0Price: TEN_TO_THE_18,
      token1Price: TEN_TO_THE_18,
    });
  });

  it("returns zeros for an empty pool", () => {
    expect(deriveV2StablePriceRatios(0n, 5n, 18n, 18n)).toEqual({
      token0Price: 0n,
      token1Price: 0n,
    });
  });
});

describe("spot price fractions", () => {
  it("v2VolatileSpotPrice0 folds decimals into an exact fraction", () => {
    // 1M USDC (6) vs 10 WBTC (8): 1 USDC = 1e-5 WBTC.
    const f = v2VolatileSpotPrice0(10n ** 12n, 10n ** 9n, 6n, 8n);
    if (!f) throw new Error("expected a fraction");
    expect((f.num * 100_000n) / f.den).toBe(1n);
    expect((f.num * 100_000n) % f.den).toBe(0n);
  });

  it("clSpotPrice0 is (sqrtPriceX96/2^96)² decimal-adjusted", () => {
    const f = clSpotPrice0(20_000n * Q96, 6n, 18n);
    if (!f) throw new Error("expected a fraction");
    // raw 4e8 wei per micro-USDC → 0.0004 WETH per USDC, exactly
    expect((f.num * 10_000n) / f.den).toBe(4n);
    expect((f.num * 10_000n) % f.den).toBe(0n);
  });

  it("rejects pools without a defined price", () => {
    expect(v2StableSpotPrice0(1n, 0n, 18n, 18n)).toBeUndefined();
    expect(v2VolatileSpotPrice0(0n, 1n, 18n, 18n)).toBeUndefined();
    expect(clSpotPrice0(0n, 18n, 18n)).toBeUndefined();
  });

  it("poolSpotPrice0 dispatches on pool kind", () => {
    const reserves = { reserve0: TEN_TO_THE_18, reserve1: 2n * TEN_TO_THE_18 };
    expect(
      poolSpotPrice0({ isCL: false, isStable: false, ...reserves }, 18n, 18n),
    ).toEqual(
      v2VolatileSpotPrice0(reserves.reserve0, reserves.reserve1, 18n, 18n),
    );
    expect(
      poolSpotPrice0({ isCL: false, isStable: true, ...reserves }, 18n, 18n),
    ).toEqual(
      v2StableSpotPrice0(reserves.reserve0, reserves.reserve1, 18n, 18n),
    );
    expect(
      poolSpotPrice0(
        { isCL: true, isStable: false, ...reserves, sqrtPriceX96: Q96 },
        18n,
        18n,
      ),
    ).toEqual(clSpotPrice0(Q96, 18n, 18n));
    expect(
      poolSpotPrice0(
        { isCL: true, isStable: false, ...reserves, sqrtPriceX96: undefined },
        18n,
        18n,
      ),
    ).toBeUndefined();
  });
});
