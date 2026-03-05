import {
  SqrtPriceMath,
  TickMath,
  maxLiquidityForAmounts,
} from "@uniswap/v3-sdk";
import type {
  LiquidityPoolAggregator,
  NonFungiblePosition,
  Token,
  handlerContext,
} from "generated";
import JSBI from "jsbi";
import { toChecksumAddress } from "../src/Constants";
import {
  calculatePositionAmountsFromLiquidity,
  calculateTotalUSD,
  calculateWhitelistedFeesUSD,
  computeCLStakedUSDFromPositions,
  computeLiquidityDeltaFromAmounts,
  computeNonCLStakedUSD,
  concentratedLiquidityToUSD,
  runAsyncWithErrorLog,
  sortByBlockThenLogIndex,
} from "../src/Helpers";
import { setupCommon } from "./EventHandlers/Pool/common";

describe("Helpers", () => {
  const Q96 = 2n ** 96n;

  describe("sortByBlockThenLogIndex", () => {
    it("should sort by block number ascending when blocks differ", () => {
      const items = [
        { block: 200, logIndex: 1 },
        { block: 100, logIndex: 2 },
        { block: 150, logIndex: 0 },
      ];
      const result = sortByBlockThenLogIndex(
        items,
        (x) => x.block,
        (x) => x.logIndex,
      );
      expect(result.map((x) => x.block)).toEqual([100, 150, 200]);
    });

    it("should sort by log index when block numbers are equal", () => {
      const items = [
        { block: 10, logIndex: 3 },
        { block: 10, logIndex: 1 },
        { block: 10, logIndex: 2 },
      ];
      const result = sortByBlockThenLogIndex(
        items,
        (x) => x.block,
        (x) => x.logIndex,
      );
      expect(result.map((x) => x.logIndex)).toEqual([1, 2, 3]);
    });

    it("should default log index to 0 when getLogIndex is omitted", () => {
      const items = [{ block: 2 }, { block: 1 }, { block: 3 }];
      const result = sortByBlockThenLogIndex(items, (x) => x.block);
      expect(result.map((x) => x.block)).toEqual([1, 2, 3]);
    });

    it("should not mutate the input array", () => {
      const items = [{ block: 2 }, { block: 1 }];
      const copy = [...items];
      sortByBlockThenLogIndex(items, (x) => x.block);
      expect(items).toEqual(copy);
    });
  });

  describe("runAsyncWithErrorLog", () => {
    it("should run fn and not log when fn resolves", async () => {
      const logError = vi.fn();
      const context = {
        log: { error: logError },
      } as unknown as handlerContext;
      const fn = vi.fn().mockResolvedValue(undefined);

      await runAsyncWithErrorLog(context, "Test message", fn);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(logError).not.toHaveBeenCalled();
    });

    it("should log message and error and not throw when fn rejects", async () => {
      const logError = vi.fn();
      const context = {
        log: { error: logError },
      } as unknown as handlerContext;
      const err = new Error("Something failed");
      const fn = vi.fn().mockRejectedValue(err);

      await expect(
        runAsyncWithErrorLog(context, "Test message", fn),
      ).resolves.toBeUndefined();

      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith("Test message: Something failed");
    });

    it("should log String(error) and not throw when fn rejects with non-Error", async () => {
      const logError = vi.fn();
      const context = {
        log: { error: logError },
      } as unknown as handlerContext;
      const fn = vi.fn().mockRejectedValue("string error");

      await expect(
        runAsyncWithErrorLog(context, "Test message", fn),
      ).resolves.toBeUndefined();

      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith("Test message: string error");
    });
  });

  describe("calculateWhitelistedFeesUSD", () => {
    const { mockToken0Data, mockToken1Data } = setupCommon();

    it("should sum USD for both tokens when both are whitelisted", () => {
      const amount0 = 1000000000000000000n;
      const amount1 = 2000000000000000000n;
      const total = calculateWhitelistedFeesUSD(
        amount0,
        amount1,
        mockToken0Data,
        mockToken1Data,
      );
      const expected = calculateTotalUSD(
        amount0,
        amount1,
        mockToken0Data,
        mockToken1Data,
      );
      expect(total).toBe(expected);
    });

    it("should include only token0 USD when only token0 is whitelisted", () => {
      const amount0 = 1000000000000000000n;
      const amount1 = 2000000000000000000n;
      const token1NotWhitelisted: Token = {
        ...mockToken1Data,
        isWhitelisted: false,
      };
      const total = calculateWhitelistedFeesUSD(
        amount0,
        amount1,
        mockToken0Data,
        token1NotWhitelisted,
      );
      const expectedToken0USD = calculateTotalUSD(
        amount0,
        0n,
        mockToken0Data,
        undefined,
      );
      expect(total).toBe(expectedToken0USD);
    });

    it("should include only token1 USD when only token1 is whitelisted", () => {
      const amount0 = 1000000000000000000n;
      const amount1 = 2000000000000000000n;
      const token0NotWhitelisted: Token = {
        ...mockToken0Data,
        isWhitelisted: false,
      };
      const total = calculateWhitelistedFeesUSD(
        amount0,
        amount1,
        token0NotWhitelisted,
        mockToken1Data,
      );
      const expectedToken1USD = calculateTotalUSD(
        0n,
        amount1,
        undefined,
        mockToken1Data,
      );
      expect(total).toBe(expectedToken1USD);
    });

    it("should return 0n when neither token is whitelisted", () => {
      const token0NotWhitelisted: Token = {
        ...mockToken0Data,
        isWhitelisted: false,
      };
      const token1NotWhitelisted: Token = {
        ...mockToken1Data,
        isWhitelisted: false,
      };
      const total = calculateWhitelistedFeesUSD(
        1000n,
        2000n,
        token0NotWhitelisted,
        token1NotWhitelisted,
      );
      expect(total).toBe(0n);
    });
  });

  describe("calculatePositionAmountsFromLiquidity", () => {
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
        const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickLower),
        );
        const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickUpper),
        );
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
        expect(result.amount0).toBe(expectedAmount0);
        expect(result.amount1).toBe(expectedAmount1);
      });

      it("should handle price closer to lower tick", () => {
        const liquidity = 1000000000000000000n;
        const tickLower = -100n;
        const tickUpper = 100n;

        // Price closer to lower tick (25% of the way from lower to upper)
        // Use actual TickMath to get correct sqrt ratios
        const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickLower),
        );
        const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickUpper),
        );
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
        expect(result.amount0).toBe(expectedAmount0);
        expect(result.amount1).toBe(expectedAmount1);
        // Should have more amount0 (token0) than amount1 when price is lower
        expect(result.amount0 > result.amount1).toBe(true);
      });

      it("should handle price closer to upper tick", () => {
        const liquidity = 1000000000000000000n;
        const tickLower = -100n;
        const tickUpper = 100n;

        // Price closer to upper tick (75% of the way from lower to upper)
        // Use actual TickMath to get correct sqrt ratios
        const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickLower),
        );
        const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickUpper),
        );
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
        expect(result.amount0).toBe(expectedAmount0);
        expect(result.amount1).toBe(expectedAmount1);
        // Should have more amount1 (token1) than amount0 when price is higher
        expect(result.amount1 > result.amount0).toBe(true);
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
        const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickLower),
        );
        const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickUpper),
        );
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
        expect(result.amount0).toBe(expectedAmount0);
        expect(result.amount1).toBe(expectedAmount1);
      });

      it("should handle price exactly at tickLower", () => {
        const liquidity = 1000000000000000000n;
        const tickLower = 0n;
        const tickUpper = 100n;

        // Price exactly at lower tick
        const sqrtPriceX96JSBI = TickMath.getSqrtRatioAtTick(Number(tickLower));
        const sqrtPriceX96 = BigInt(sqrtPriceX96JSBI.toString());

        // Calculate expected values
        const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickLower),
        );
        const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickUpper),
        );
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
        expect(result.amount0).toBe(expectedAmount0);
        expect(result.amount1).toBe(expectedAmount1);
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
        const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickLower),
        );
        const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickUpper),
        );
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
        expect(result.amount0).toBe(expectedAmount0);
        expect(result.amount1).toBe(expectedAmount1);
      });

      it("should handle price exactly at tickUpper", () => {
        const liquidity = 1000000000000000000n;
        const tickLower = -100n;
        const tickUpper = 0n;

        // Price exactly at upper tick
        const sqrtPriceX96JSBI = TickMath.getSqrtRatioAtTick(Number(tickUpper));
        const sqrtPriceX96 = BigInt(sqrtPriceX96JSBI.toString());

        // Calculate expected values
        const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickLower),
        );
        const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickUpper),
        );
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
        expect(result.amount0).toBe(expectedAmount0);
        expect(result.amount1).toBe(expectedAmount1);
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

        expect(result.amount0).toBe(0n);
        expect(result.amount1).toBe(0n);
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
        expect(result.amount0).toBe(0n);
        expect(result.amount1).toBe(0n);
      });

      it("should handle very large liquidity values", () => {
        const liquidity = 1000000000000000000000000000n; // 1e27
        const sqrtPriceX96JSBI = TickMath.getSqrtRatioAtTick(0);
        const sqrtPriceX96 = BigInt(sqrtPriceX96JSBI.toString());
        const tickLower = -100n;
        const tickUpper = 100n;

        // Calculate expected values
        const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickLower),
        );
        const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickUpper),
        );
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
        expect(result.amount0).toBe(expectedAmount0);
        expect(result.amount1).toBe(expectedAmount1);
      });

      it("should handle negative ticks", () => {
        const liquidity = 1000000000000000000n;
        const tickLower = -200n;
        const tickUpper = -100n;
        const sqrtPriceX96 = Q96 - Q96 / 10n; // Below both ticks

        // Calculate expected values - price is below range, so all token0
        const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickLower),
        );
        const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickUpper),
        );
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
        expect(result.amount0).toBe(expectedAmount0);
        expect(result.amount1).toBe(expectedAmount1);
      });

      it("should handle positive ticks", () => {
        const liquidity = 1000000000000000000n;
        const tickLower = 100n;
        const tickUpper = 200n;
        const sqrtPriceX96 = Q96 * 2n; // Above both ticks

        // Calculate expected values - price is above range, so all token1
        const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickLower),
        );
        const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickUpper),
        );
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
        expect(result.amount0).toBe(expectedAmount0);
        expect(result.amount1).toBe(expectedAmount1);
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
        const sqrtPriceLowerJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickLower),
        );
        const sqrtPriceUpperJSBI = TickMath.getSqrtRatioAtTick(
          Number(tickUpper),
        );
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
        expect(result.amount0).toBe(expectedAmount0);
        expect(result.amount1).toBe(expectedAmount1);
      });
    });
  });

  describe("computeLiquidityDeltaFromAmounts", () => {
    it("should match SDK maxLiquidityForAmounts for price within range", () => {
      const amount0 = 1000000000000000000n; // 1e18
      const amount1 = 1000000000000000000n; // 1e18
      const tickLower = -100n;
      const tickUpper = 100n;
      const sqrtPriceX96JSBI = TickMath.getSqrtRatioAtTick(0);
      const sqrtPriceX96 = BigInt(sqrtPriceX96JSBI.toString());

      const expectedL = maxLiquidityForAmounts(
        sqrtPriceX96JSBI,
        TickMath.getSqrtRatioAtTick(Number(tickLower)),
        TickMath.getSqrtRatioAtTick(Number(tickUpper)),
        amount0.toString(),
        amount1.toString(),
        true,
      );
      const expectedLBigInt = BigInt(expectedL.toString());

      const result = computeLiquidityDeltaFromAmounts(
        amount0,
        amount1,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      expect(result).toBe(expectedLBigInt);
    });

    it("should round-trip with calculatePositionAmountsFromLiquidity", () => {
      const amount0 = 500000000000000000n; // 0.5e18
      const amount1 = 600000000000000000n; // 0.6e18
      const tickLower = 1449n;
      const tickUpper = 1459n;
      const sqrtPriceX96 = BigInt("85202306940083509697531739922");

      const deltaL = computeLiquidityDeltaFromAmounts(
        amount0,
        amount1,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      const { amount0: back0, amount1: back1 } =
        calculatePositionAmountsFromLiquidity(
          deltaL,
          sqrtPriceX96,
          tickLower,
          tickUpper,
        );

      // Integer liquidity truncates: amounts back should be <= original
      expect(back0 <= amount0).toBe(true);
      expect(back1 <= amount1).toBe(true);
      // deltaL should be positive and round-trip should yield non-zero amounts
      expect(deltaL > 0n).toBe(true);
      expect(back0 + back1 > 0n).toBe(true);
    });

    it("should return zero for zero amounts", () => {
      const tickLower = 0n;
      const tickUpper = 100n;
      const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(50).toString());

      const result = computeLiquidityDeltaFromAmounts(
        0n,
        0n,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      expect(result).toBe(0n);
    });

    it("should return consistent liquidity for ALM-style tick range", () => {
      // Narrow range similar to StrategyCreated in events (tick 1449-1459)
      const amount0 = 2299999999999999999n;
      const amount1 = 1148196843480035830n;
      const tickLower = 1449n;
      const tickUpper = 1459n;
      const sqrtPriceX96 = BigInt("85202936913728687396774655363");

      const result = computeLiquidityDeltaFromAmounts(
        amount0,
        amount1,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );

      const expectedL = maxLiquidityForAmounts(
        JSBI.BigInt(sqrtPriceX96.toString()),
        TickMath.getSqrtRatioAtTick(Number(tickLower)),
        TickMath.getSqrtRatioAtTick(Number(tickUpper)),
        amount0.toString(),
        amount1.toString(),
        true,
      );

      expect(result).toBe(BigInt(expectedL.toString()));
      expect(result > 0n).toBe(true);
    });
  });

  describe("concentratedLiquidityToUSD", () => {
    const { mockToken0Data: mockToken0, mockToken1Data: mockToken1 } =
      setupCommon();

    it("should return USD value from liquidity and tick range when tokens provided", () => {
      const liquidity = 1000000000000000000n;
      const tickLower = -100n;
      const tickUpper = 100n;
      const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(0).toString());

      const { amount0, amount1 } = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );
      const expectedUSD = calculateTotalUSD(
        amount0,
        amount1,
        mockToken0,
        mockToken1,
      );

      const result = concentratedLiquidityToUSD(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
        mockToken0,
        mockToken1,
      );

      expect(result).toBe(expectedUSD);
      expect(result > 0n).toBe(true);
    });

    it("should return 0n when token instances are omitted", () => {
      const liquidity = 1000000000000000000n;
      const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(0).toString());

      const result = concentratedLiquidityToUSD(
        liquidity,
        sqrtPriceX96,
        -100n,
        100n,
        undefined,
        undefined,
      );

      expect(result).toBe(0n);
    });

    it("should return 0n for zero liquidity", () => {
      const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(0).toString());

      const result = concentratedLiquidityToUSD(
        0n,
        sqrtPriceX96,
        -100n,
        100n,
        mockToken0,
        mockToken1,
      );

      expect(result).toBe(0n);
    });
  });

  describe("computeNonCLStakedUSD", () => {
    const {
      mockToken0Data: mockToken0,
      mockToken1Data: mockToken1,
      mockLiquidityPoolData: mockPool,
    } = setupCommon();
    const mockContext = {
      log: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    } as unknown as handlerContext;

    it("should compute proportional USD from stake, reserves and totalSupply", () => {
      const stakeAmount = 100n * 10n ** 18n;
      const reserve0 = 1000n * 10n ** 18n;
      const reserve1 = 1000n * 10n ** 6n;
      const totalSupply = 1000n * 10n ** 18n;

      const poolEntity: LiquidityPoolAggregator = {
        ...mockPool,
        isCL: false,
        reserve0,
        reserve1,
        totalLPTokenSupply: totalSupply,
      } as LiquidityPoolAggregator;

      const amount0 = (stakeAmount * reserve0) / totalSupply;
      const amount1 = (stakeAmount * reserve1) / totalSupply;
      const expectedUSD = calculateTotalUSD(
        amount0,
        amount1,
        mockToken0,
        mockToken1,
      );

      const result = computeNonCLStakedUSD(
        stakeAmount,
        poolEntity,
        {
          liquidityPoolAggregator: poolEntity,
          token0Instance: mockToken0,
          token1Instance: mockToken1,
        },
        mockContext,
      );

      expect(result).toBe(expectedUSD);
      expect(result > 0n).toBe(true);
    });

    it("should return 0n when stakeAmount is 0", () => {
      const poolEntity = {
        ...mockPool,
        isCL: false,
        reserve0: 1000n,
        reserve1: 1000n,
        totalLPTokenSupply: 1000n,
      } as LiquidityPoolAggregator;

      const result = computeNonCLStakedUSD(
        0n,
        poolEntity,
        {
          liquidityPoolAggregator: poolEntity,
          token0Instance: mockToken0,
          token1Instance: mockToken1,
        },
        mockContext,
      );

      expect(result).toBe(0n);
    });

    it("should return 0n when totalSupply is 0", () => {
      const poolEntity = {
        ...mockPool,
        isCL: false,
        reserve0: 1000n,
        reserve1: 1000n,
        totalLPTokenSupply: 0n,
      } as LiquidityPoolAggregator;

      const result = computeNonCLStakedUSD(
        100n,
        poolEntity,
        {
          liquidityPoolAggregator: poolEntity,
          token0Instance: mockToken0,
          token1Instance: mockToken1,
        },
        mockContext,
      );

      expect(result).toBe(0n);
    });

    it("should return 0n when totalSupply is undefined", () => {
      const poolEntity = {
        ...mockPool,
        isCL: false,
        reserve0: 1000n,
        reserve1: 1000n,
        totalLPTokenSupply: undefined,
      } as unknown as LiquidityPoolAggregator;

      const result = computeNonCLStakedUSD(
        100n,
        poolEntity,
        {
          liquidityPoolAggregator: poolEntity,
          token0Instance: mockToken0,
          token1Instance: mockToken1,
        },
        mockContext,
      );

      expect(result).toBe(0n);
    });
  });

  describe("computeCLStakedUSDFromPositions", () => {
    const {
      mockToken0Data: mockToken0,
      mockToken1Data: mockToken1,
      mockLiquidityPoolData: mockPool,
      createMockNonFungiblePosition,
    } = setupCommon();
    const chainId = mockToken0.chainId;
    const poolAddress = mockPool.poolAddress ?? mockPool.id;

    it("should sum USD from staked positions for pool when no user filter", async () => {
      const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(0).toString());
      const poolEntity = {
        ...mockPool,
        isCL: true,
        sqrtPriceX96,
      } as LiquidityPoolAggregator;

      const pos1 = createMockNonFungiblePosition({
        tokenId: 1n,
        liquidity: 1000000000000000000n,
        tickLower: -100n,
        tickUpper: 100n,
        isStakedInGauge: true,
      });
      const pos2 = createMockNonFungiblePosition({
        tokenId: 2n,
        liquidity: 2000000000000000000n,
        tickLower: -200n,
        tickUpper: 200n,
        isStakedInGauge: true,
      });

      const expectedSum =
        concentratedLiquidityToUSD(
          pos1.liquidity,
          sqrtPriceX96,
          pos1.tickLower,
          pos1.tickUpper,
          mockToken0,
          mockToken1,
        ) +
        concentratedLiquidityToUSD(
          pos2.liquidity,
          sqrtPriceX96,
          pos2.tickLower,
          pos2.tickUpper,
          mockToken0,
          mockToken1,
        );

      const mockContext = {
        NonFungiblePosition: {
          getWhere: vi.fn().mockResolvedValue([pos1, pos2]),
        },
        log: {
          warn: () => {},
          error: () => {},
          info: () => {},
          debug: () => {},
        },
      } as unknown as handlerContext;

      const result = await computeCLStakedUSDFromPositions(
        chainId,
        poolAddress,
        poolEntity,
        {
          liquidityPoolAggregator: poolEntity,
          token0Instance: mockToken0,
          token1Instance: mockToken1,
        },
        mockContext,
        { logLabel: "computeCLStakedUSDFromPositions" },
      );

      expect(result).toBe(expectedSum);
      expect(result > 0n).toBe(true);
    });

    it("should filter by userAddress when option provided", async () => {
      const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(0).toString());
      const poolEntity = {
        ...mockPool,
        isCL: true,
        sqrtPriceX96,
      } as LiquidityPoolAggregator;

      const userA = toChecksumAddress(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      const posStakedByA = createMockNonFungiblePosition({
        tokenId: 1n,
        owner: userA,
        liquidity: 1000000000000000000n,
        tickLower: -100n,
        tickUpper: 100n,
        isStakedInGauge: true,
      });
      const posStakedByB = createMockNonFungiblePosition({
        tokenId: 2n,
        owner: toChecksumAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        liquidity: 2000000000000000000n,
        tickLower: -100n,
        tickUpper: 100n,
        isStakedInGauge: true,
      });

      const expectedUserAUSD = concentratedLiquidityToUSD(
        posStakedByA.liquidity,
        sqrtPriceX96,
        posStakedByA.tickLower,
        posStakedByA.tickUpper,
        mockToken0,
        mockToken1,
      );

      const mockContext = {
        NonFungiblePosition: {
          getWhere: vi.fn().mockResolvedValue([posStakedByA, posStakedByB]),
        },
        log: {
          warn: () => {},
          error: () => {},
          info: () => {},
          debug: () => {},
        },
      } as unknown as handlerContext;

      const result = await computeCLStakedUSDFromPositions(
        chainId,
        poolAddress,
        poolEntity,
        {
          liquidityPoolAggregator: poolEntity,
          token0Instance: mockToken0,
          token1Instance: mockToken1,
        },
        mockContext,
        { userAddress: userA, logLabel: "computeCLStakedUSDFromPositions" },
      );

      expect(result).toBe(expectedUserAUSD);
    });

    it("should return 0n when sqrtPriceX96 is undefined", async () => {
      const poolEntity = {
        ...mockPool,
        isCL: true,
        sqrtPriceX96: undefined,
      } as unknown as LiquidityPoolAggregator;

      const mockContext = {
        NonFungiblePosition: { getWhere: vi.fn().mockResolvedValue([]) },
        log: {
          warn: () => {},
          error: () => {},
          info: () => {},
          debug: () => {},
        },
      } as unknown as handlerContext;

      const result = await computeCLStakedUSDFromPositions(
        chainId,
        poolAddress,
        poolEntity,
        {
          liquidityPoolAggregator: poolEntity,
          token0Instance: mockToken0,
          token1Instance: mockToken1,
        },
        mockContext,
        { logLabel: "computeCLStakedUSDFromPositions" },
      );

      expect(result).toBe(0n);
    });

    it("should return 0n when getWhere throws and log warn", async () => {
      const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(0).toString());
      const poolEntity = {
        ...mockPool,
        isCL: true,
        sqrtPriceX96,
      } as LiquidityPoolAggregator;

      const logWarn = vi.fn();
      const mockContext = {
        NonFungiblePosition: {
          getWhere: vi.fn().mockRejectedValue(new Error("DB error")),
        },
        log: {
          warn: logWarn,
          error: () => {},
          info: () => {},
          debug: () => {},
        },
      } as unknown as handlerContext;

      const result = await computeCLStakedUSDFromPositions(
        chainId,
        poolAddress,
        poolEntity,
        {
          liquidityPoolAggregator: poolEntity,
          token0Instance: mockToken0,
          token1Instance: mockToken1,
        },
        mockContext,
        { logLabel: "TestLabel" },
      );

      expect(result).toBe(0n);
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining("[TestLabel]"),
      );
    });

    it("should exclude positions not staked in gauge", async () => {
      const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(0).toString());
      const poolEntity = {
        ...mockPool,
        isCL: true,
        sqrtPriceX96,
      } as LiquidityPoolAggregator;

      const stakedPos = createMockNonFungiblePosition({
        tokenId: 1n,
        liquidity: 1000000000000000000n,
        tickLower: -100n,
        tickUpper: 100n,
        isStakedInGauge: true,
      });
      const unstakedPos = createMockNonFungiblePosition({
        tokenId: 2n,
        liquidity: 2000000000000000000n,
        tickLower: -100n,
        tickUpper: 100n,
        isStakedInGauge: false,
      });

      const expectedUSD = concentratedLiquidityToUSD(
        stakedPos.liquidity,
        sqrtPriceX96,
        stakedPos.tickLower,
        stakedPos.tickUpper,
        mockToken0,
        mockToken1,
      );

      const mockContext = {
        NonFungiblePosition: {
          getWhere: vi.fn().mockResolvedValue([stakedPos, unstakedPos]),
        },
        log: {
          warn: () => {},
          error: () => {},
          info: () => {},
          debug: () => {},
        },
      } as unknown as handlerContext;

      const result = await computeCLStakedUSDFromPositions(
        chainId,
        poolAddress,
        poolEntity,
        {
          liquidityPoolAggregator: poolEntity,
          token0Instance: mockToken0,
          token1Instance: mockToken1,
        },
        mockContext,
        { logLabel: "computeCLStakedUSDFromPositions" },
      );

      expect(result).toBe(expectedUSD);
    });

    it("should sum only staked positions when pool has multiple staked and unstaked", async () => {
      const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(0).toString());
      const poolEntity = {
        ...mockPool,
        isCL: true,
        sqrtPriceX96,
      } as LiquidityPoolAggregator;

      const staked1 = createMockNonFungiblePosition({
        tokenId: 1n,
        liquidity: 1000000000000000000n,
        tickLower: -100n,
        tickUpper: 100n,
        isStakedInGauge: true,
      });
      const staked2 = createMockNonFungiblePosition({
        tokenId: 2n,
        liquidity: 2000000000000000000n,
        tickLower: -200n,
        tickUpper: 200n,
        isStakedInGauge: true,
      });
      const unstaked1 = createMockNonFungiblePosition({
        tokenId: 3n,
        liquidity: 3000000000000000000n,
        tickLower: -100n,
        tickUpper: 100n,
        isStakedInGauge: false,
      });
      const unstaked2 = createMockNonFungiblePosition({
        tokenId: 4n,
        liquidity: 4000000000000000000n,
        tickLower: -100n,
        tickUpper: 100n,
        isStakedInGauge: false,
      });

      const expectedSum =
        concentratedLiquidityToUSD(
          staked1.liquidity,
          sqrtPriceX96,
          staked1.tickLower,
          staked1.tickUpper,
          mockToken0,
          mockToken1,
        ) +
        concentratedLiquidityToUSD(
          staked2.liquidity,
          sqrtPriceX96,
          staked2.tickLower,
          staked2.tickUpper,
          mockToken0,
          mockToken1,
        );

      const mockContext = {
        NonFungiblePosition: {
          getWhere: vi
            .fn()
            .mockResolvedValue([staked1, unstaked1, staked2, unstaked2]),
        },
        log: {
          warn: () => {},
          error: () => {},
          info: () => {},
          debug: () => {},
        },
      } as unknown as handlerContext;

      const result = await computeCLStakedUSDFromPositions(
        chainId,
        poolAddress,
        poolEntity,
        {
          liquidityPoolAggregator: poolEntity,
          token0Instance: mockToken0,
          token1Instance: mockToken1,
        },
        mockContext,
        { logLabel: "computeCLStakedUSDFromPositions" },
      );

      expect(result).toBe(expectedSum);
      expect(result > 0n).toBe(true);
    });

    it("should return only the given user's staked positions when multiple users have both staked and unstaked", async () => {
      const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(0).toString());
      const poolEntity = {
        ...mockPool,
        isCL: true,
        sqrtPriceX96,
      } as LiquidityPoolAggregator;

      const userA = toChecksumAddress(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      const userB = toChecksumAddress(
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      );

      const aStaked = createMockNonFungiblePosition({
        tokenId: 1n,
        owner: userA,
        liquidity: 1000000000000000000n,
        tickLower: -100n,
        tickUpper: 100n,
        isStakedInGauge: true,
      });
      const aUnstaked = createMockNonFungiblePosition({
        tokenId: 2n,
        owner: userA,
        liquidity: 500000000000000000n,
        tickLower: -100n,
        tickUpper: 100n,
        isStakedInGauge: false,
      });
      const bStaked = createMockNonFungiblePosition({
        tokenId: 3n,
        owner: userB,
        liquidity: 2000000000000000000n,
        tickLower: -200n,
        tickUpper: 200n,
        isStakedInGauge: true,
      });
      const bUnstaked = createMockNonFungiblePosition({
        tokenId: 4n,
        owner: userB,
        liquidity: 700000000000000000n,
        tickLower: -100n,
        tickUpper: 100n,
        isStakedInGauge: false,
      });

      const expectedAStakedUSD = concentratedLiquidityToUSD(
        aStaked.liquidity,
        sqrtPriceX96,
        aStaked.tickLower,
        aStaked.tickUpper,
        mockToken0,
        mockToken1,
      );
      const expectedBStakedUSD = concentratedLiquidityToUSD(
        bStaked.liquidity,
        sqrtPriceX96,
        bStaked.tickLower,
        bStaked.tickUpper,
        mockToken0,
        mockToken1,
      );

      const allPositions = [aStaked, aUnstaked, bStaked, bUnstaked];
      const mockContext = {
        NonFungiblePosition: {
          getWhere: vi.fn().mockResolvedValue(allPositions),
        },
        log: {
          warn: () => {},
          error: () => {},
          info: () => {},
          debug: () => {},
        },
      } as unknown as handlerContext;

      const resultA = await computeCLStakedUSDFromPositions(
        chainId,
        poolAddress,
        poolEntity,
        {
          liquidityPoolAggregator: poolEntity,
          token0Instance: mockToken0,
          token1Instance: mockToken1,
        },
        mockContext,
        { userAddress: userA, logLabel: "computeCLStakedUSDFromPositions" },
      );
      const resultB = await computeCLStakedUSDFromPositions(
        chainId,
        poolAddress,
        poolEntity,
        {
          liquidityPoolAggregator: poolEntity,
          token0Instance: mockToken0,
          token1Instance: mockToken1,
        },
        mockContext,
        { userAddress: userB, logLabel: "computeCLStakedUSDFromPositions" },
      );

      expect(resultA).toBe(expectedAStakedUSD);
      expect(resultB).toBe(expectedBStakedUSD);
      expect(resultA > 0n).toBe(true);
      expect(resultB > 0n).toBe(true);
    });
  });
});
