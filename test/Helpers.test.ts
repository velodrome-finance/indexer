import { SqrtPriceMath, TickMath } from "@uniswap/v3-sdk";
import { expect } from "chai";
import JSBI from "jsbi";
import { calculatePositionAmountsFromLiquidity } from "../src/Helpers";

describe("Helpers - calculatePositionAmountsFromLiquidity", () => {
  const Q96 = 2n ** 96n;

  describe("Price within range", () => {
    it("should calculate both amount0 and amount1 when price is within tick range", () => {
      // Example: liquidity = 1e18, price is between tickLower and tickUpper
      // Use actual TickMath to get sqrt price at tick 0
      const liquidity = 1000000000000000000n; // 1e18
      const tickLower = -100n;
      const tickUpper = 100n;

      // Current price at tick 0 (middle of range)
      const sqrtPriceX96JSBI = TickMath.getSqrtRatioAtTick(0);
      const sqrtPriceX96 = BigInt(sqrtPriceX96JSBI.toString());

      // Calculate expected values
      const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
      const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
      const liquidityJSBI = JSBI.BigInt(liquidity.toString());

      const expectedAmount0JSBI = SqrtPriceMath.getAmount0Delta(
        sqrtPriceX96JSBI,
        sqrtPriceUpperJSBI,
        liquidityJSBI,
        false,
      );
      const expectedAmount1JSBI = SqrtPriceMath.getAmount1Delta(
        sqrtPriceLowerJSBI,
        sqrtPriceX96JSBI,
        liquidityJSBI,
        false,
      );

      const expectedAmount0 = BigInt(expectedAmount0JSBI.toString());
      const expectedAmount1 = BigInt(expectedAmount1JSBI.toString());

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      // Verify exact equality
      expect(result.amount0).to.equal(expectedAmount0);
      expect(result.amount1).to.equal(expectedAmount1);
    });

    it("should handle price closer to lower tick", () => {
      const liquidity = 1000000000000000000n;
      const tickLower = -100n;
      const tickUpper = 100n;

      // Price closer to lower tick (25% of the way from lower to upper)
      // Use actual TickMath to get correct sqrt ratios
      const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
      const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
      // Interpolate 25% from lower to upper
      const sqrtPriceX96JSBI = JSBI.add(
        sqrtPriceLowerJSBI,
        JSBI.divide(
          JSBI.subtract(sqrtPriceUpperJSBI, sqrtPriceLowerJSBI),
          JSBI.BigInt(4),
        ),
      );
      const sqrtPriceX96 = BigInt(sqrtPriceX96JSBI.toString());

      // Calculate expected values
      const liquidityJSBI = JSBI.BigInt(liquidity.toString());
      const expectedAmount0JSBI = SqrtPriceMath.getAmount0Delta(
        sqrtPriceX96JSBI,
        sqrtPriceUpperJSBI,
        liquidityJSBI,
        false,
      );
      const expectedAmount1JSBI = SqrtPriceMath.getAmount1Delta(
        sqrtPriceLowerJSBI,
        sqrtPriceX96JSBI,
        liquidityJSBI,
        false,
      );

      const expectedAmount0 = BigInt(expectedAmount0JSBI.toString());
      const expectedAmount1 = BigInt(expectedAmount1JSBI.toString());

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      // Verify exact equality
      expect(result.amount0).to.equal(expectedAmount0);
      expect(result.amount1).to.equal(expectedAmount1);
      // Should have more amount0 (token0) than amount1 when price is lower
      expect(result.amount0 > result.amount1).to.be.true;
    });

    it("should handle price closer to upper tick", () => {
      const liquidity = 1000000000000000000n;
      const tickLower = -100n;
      const tickUpper = 100n;

      // Price closer to upper tick (75% of the way from lower to upper)
      // Use actual TickMath to get correct sqrt ratios
      const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
      const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
      // Interpolate 75% from lower to upper
      const diff = JSBI.subtract(sqrtPriceUpperJSBI, sqrtPriceLowerJSBI);
      const threeQuarters = JSBI.divide(
        JSBI.multiply(diff, JSBI.BigInt(3)),
        JSBI.BigInt(4),
      );
      const sqrtPriceX96JSBI = JSBI.add(sqrtPriceLowerJSBI, threeQuarters);
      const sqrtPriceX96 = BigInt(sqrtPriceX96JSBI.toString());

      // Calculate expected values
      const liquidityJSBI = JSBI.BigInt(liquidity.toString());
      const expectedAmount0JSBI = SqrtPriceMath.getAmount0Delta(
        sqrtPriceX96JSBI,
        sqrtPriceUpperJSBI,
        liquidityJSBI,
        false,
      );
      const expectedAmount1JSBI = SqrtPriceMath.getAmount1Delta(
        sqrtPriceLowerJSBI,
        sqrtPriceX96JSBI,
        liquidityJSBI,
        false,
      );

      const expectedAmount0 = BigInt(expectedAmount0JSBI.toString());
      const expectedAmount1 = BigInt(expectedAmount1JSBI.toString());

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      // Verify exact equality
      expect(result.amount0).to.equal(expectedAmount0);
      expect(result.amount1).to.equal(expectedAmount1);
      // Should have more amount1 (token1) than amount0 when price is higher
      expect(result.amount1 > result.amount0).to.be.true;
    });
  });

  describe("Price below range", () => {
    it("should return only amount0 when price is below tickLower", () => {
      const liquidity = 1000000000000000000n;
      const tickLower = 0n;
      const tickUpper = 100n;

      // Price below the range
      const sqrtPriceX96 = Q96 / 2n; // Half of Q96, definitely below tickLower

      // Calculate expected values - price is below range, so all token0
      const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
      const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
      const liquidityJSBI = JSBI.BigInt(liquidity.toString());

      const expectedAmount0JSBI = SqrtPriceMath.getAmount0Delta(
        sqrtPriceLowerJSBI,
        sqrtPriceUpperJSBI,
        liquidityJSBI,
        false,
      );
      const expectedAmount0 = BigInt(expectedAmount0JSBI.toString());
      const expectedAmount1 = 0n;

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      // Verify exact equality
      expect(result.amount0).to.equal(expectedAmount0);
      expect(result.amount1).to.equal(expectedAmount1);
    });

    it("should handle price exactly at tickLower", () => {
      const liquidity = 1000000000000000000n;
      const tickLower = 0n;
      const tickUpper = 100n;

      // Price exactly at lower tick
      const sqrtPriceX96JSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
      const sqrtPriceX96 = BigInt(sqrtPriceX96JSBI.toString());

      // Calculate expected values
      const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
      const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
      const liquidityJSBI = JSBI.BigInt(liquidity.toString());

      const expectedAmount0JSBI = SqrtPriceMath.getAmount0Delta(
        sqrtPriceX96JSBI,
        sqrtPriceUpperJSBI,
        liquidityJSBI,
        false,
      );
      const expectedAmount1JSBI = SqrtPriceMath.getAmount1Delta(
        sqrtPriceLowerJSBI,
        sqrtPriceX96JSBI,
        liquidityJSBI,
        false,
      );

      const expectedAmount0 = BigInt(expectedAmount0JSBI.toString());
      const expectedAmount1 = BigInt(expectedAmount1JSBI.toString());

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      // Verify exact equality
      expect(result.amount0).to.equal(expectedAmount0);
      expect(result.amount1).to.equal(expectedAmount1);
    });
  });

  describe("Price above range", () => {
    it("should return only amount1 when price is above tickUpper", () => {
      const liquidity = 1000000000000000000n;
      const tickLower = -100n;
      const tickUpper = 0n;

      // Price above the range
      const sqrtPriceX96 = Q96 * 2n; // Double Q96, definitely above tickUpper

      // Calculate expected values - price is above range, so all token1
      const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
      const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
      const liquidityJSBI = JSBI.BigInt(liquidity.toString());

      const expectedAmount0 = 0n;
      const expectedAmount1JSBI = SqrtPriceMath.getAmount1Delta(
        sqrtPriceLowerJSBI,
        sqrtPriceUpperJSBI,
        liquidityJSBI,
        false,
      );
      const expectedAmount1 = BigInt(expectedAmount1JSBI.toString());

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      // Verify exact equality
      expect(result.amount0).to.equal(expectedAmount0);
      expect(result.amount1).to.equal(expectedAmount1);
    });

    it("should handle price exactly at tickUpper", () => {
      const liquidity = 1000000000000000000n;
      const tickLower = -100n;
      const tickUpper = 0n;

      // Price exactly at upper tick
      const sqrtPriceX96JSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
      const sqrtPriceX96 = BigInt(sqrtPriceX96JSBI.toString());

      // Calculate expected values
      const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
      const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
      const liquidityJSBI = JSBI.BigInt(liquidity.toString());

      const expectedAmount0JSBI = SqrtPriceMath.getAmount0Delta(
        sqrtPriceX96JSBI,
        sqrtPriceUpperJSBI,
        liquidityJSBI,
        false,
      );
      const expectedAmount1JSBI = SqrtPriceMath.getAmount1Delta(
        sqrtPriceLowerJSBI,
        sqrtPriceX96JSBI,
        liquidityJSBI,
        false,
      );

      const expectedAmount0 = BigInt(expectedAmount0JSBI.toString());
      const expectedAmount1 = BigInt(expectedAmount1JSBI.toString());

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      // Verify exact equality
      expect(result.amount0).to.equal(expectedAmount0);
      expect(result.amount1).to.equal(expectedAmount1);
    });
  });

  describe("Edge cases", () => {
    it("should handle zero liquidity", () => {
      const liquidity = 0n;
      const sqrtPriceX96JSBI = TickMath.getSqrtRatioAtTick(0);
      const sqrtPriceX96 = BigInt(sqrtPriceX96JSBI.toString());
      const tickLower = -100n;
      const tickUpper = 100n;

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      expect(result.amount0).to.equal(0n);
      expect(result.amount1).to.equal(0n);
    });

    it("should handle equal ticks", () => {
      const liquidity = 1000000000000000000n;
      const tickLower = 0n;
      const tickUpper = 0n;
      const sqrtPriceX96JSBI = TickMath.getSqrtRatioAtTick(0);
      const sqrtPriceX96 = BigInt(sqrtPriceX96JSBI.toString());

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      // When ticks are equal, both amounts should be 0
      expect(result.amount0).to.equal(0n);
      expect(result.amount1).to.equal(0n);
    });

    it("should handle very large liquidity values", () => {
      const liquidity = 1000000000000000000000000000n; // 1e27
      const sqrtPriceX96JSBI = TickMath.getSqrtRatioAtTick(0);
      const sqrtPriceX96 = BigInt(sqrtPriceX96JSBI.toString());
      const tickLower = -100n;
      const tickUpper = 100n;

      // Calculate expected values
      const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
      const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
      const liquidityJSBI = JSBI.BigInt(liquidity.toString());

      const expectedAmount0JSBI = SqrtPriceMath.getAmount0Delta(
        sqrtPriceX96JSBI,
        sqrtPriceUpperJSBI,
        liquidityJSBI,
        false,
      );
      const expectedAmount1JSBI = SqrtPriceMath.getAmount1Delta(
        sqrtPriceLowerJSBI,
        sqrtPriceX96JSBI,
        liquidityJSBI,
        false,
      );

      const expectedAmount0 = BigInt(expectedAmount0JSBI.toString());
      const expectedAmount1 = BigInt(expectedAmount1JSBI.toString());

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      // Verify exact equality
      expect(result.amount0).to.equal(expectedAmount0);
      expect(result.amount1).to.equal(expectedAmount1);
    });

    it("should handle negative ticks", () => {
      const liquidity = 1000000000000000000n;
      const tickLower = -200n;
      const tickUpper = -100n;
      const sqrtPriceX96 = Q96 - Q96 / 10n; // Below both ticks

      // Calculate expected values - price is below range, so all token0
      const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
      const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
      const liquidityJSBI = JSBI.BigInt(liquidity.toString());

      const expectedAmount0JSBI = SqrtPriceMath.getAmount0Delta(
        sqrtPriceLowerJSBI,
        sqrtPriceUpperJSBI,
        liquidityJSBI,
        false,
      );
      const expectedAmount0 = BigInt(expectedAmount0JSBI.toString());
      const expectedAmount1 = 0n;

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      // Verify exact equality
      expect(result.amount0).to.equal(expectedAmount0);
      expect(result.amount1).to.equal(expectedAmount1);
    });

    it("should handle positive ticks", () => {
      const liquidity = 1000000000000000000n;
      const tickLower = 100n;
      const tickUpper = 200n;
      const sqrtPriceX96 = Q96 * 2n; // Above both ticks

      // Calculate expected values - price is above range, so all token1
      const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
      const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
      const liquidityJSBI = JSBI.BigInt(liquidity.toString());

      const expectedAmount0 = 0n;
      const expectedAmount1JSBI = SqrtPriceMath.getAmount1Delta(
        sqrtPriceLowerJSBI,
        sqrtPriceUpperJSBI,
        liquidityJSBI,
        false,
      );
      const expectedAmount1 = BigInt(expectedAmount1JSBI.toString());

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      // Verify exact equality
      expect(result.amount0).to.equal(expectedAmount0);
      expect(result.amount1).to.equal(expectedAmount1);
    });
  });

  describe("Real-world scenarios", () => {
    it("should handle typical Uniswap V3 position parameters", () => {
      // Typical values: liquidity ~1e18, ticks around 0, price near 1:1
      const liquidity = 79228162514264337593543950336n; // Typical liquidity value
      const tickLower = -887272n; // Full range lower
      const tickUpper = 887272n; // Full range upper
      const sqrtPriceX96 = 79228162514264337593543950336n; // Price = 1.0 (Q96)

      const result = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      // Calculate expected values using the same logic to verify correctness
      // For a full-range position at price 1.0 (tick 0), we expect:
      // - amount0: liquidity between current price (tick 0) and upper tick (887272)
      // - amount1: liquidity between lower tick (-887272) and current price (tick 0)
      // Since price is at tick 0 (middle of full range), both should be present and roughly equal
      const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
      const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
      const sqrtPriceCurrentJSBI = TickMath.getSqrtRatioAtTick(0);
      const liquidityJSBI = JSBI.BigInt(liquidity.toString());

      // Calculate expected amounts using SqrtPriceMath (same as the function does)
      const expectedAmount0JSBI = SqrtPriceMath.getAmount0Delta(
        sqrtPriceCurrentJSBI,
        sqrtPriceUpperJSBI,
        liquidityJSBI,
        false,
      );
      const expectedAmount1JSBI = SqrtPriceMath.getAmount1Delta(
        sqrtPriceLowerJSBI,
        sqrtPriceCurrentJSBI,
        liquidityJSBI,
        false,
      );

      const expectedAmount0 = BigInt(expectedAmount0JSBI.toString());
      const expectedAmount1 = BigInt(expectedAmount1JSBI.toString());

      // Verify the calculated amounts match expected values exactly
      expect(result.amount0).to.equal(expectedAmount0);
      expect(result.amount1).to.equal(expectedAmount1);
    });
  });
});
