import { describe, expect, it } from "vitest";
import {
  deriveCLPriceRatios,
  deriveV2PriceRatios,
  pickPriceRatios,
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
