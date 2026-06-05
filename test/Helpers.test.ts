import {
  SqrtPriceMath,
  TickMath,
  maxLiquidityForAmounts,
} from "@uniswap/v3-sdk";
import type { Token } from "envio";
import JSBI from "jsbi";
import { TokenId, toChecksumAddress } from "../src/Constants";
import type { handlerContext } from "../src/EntityTypes";
import type { Pool } from "../src/EntityTypes";
import {
  calculatePositionAmountsFromLiquidity,
  calculateTotalUSD,
  computeLiquidityDeltaFromAmounts,
  computeNonCLStakedUSD,
  concentratedLiquidityToUSD,
  optionalBigintEffect,
  pickTrustedSwapVolumeUSD,
  runAsyncWithErrorLog,
  sortByBlockThenLogIndex,
} from "../src/Helpers";
import { setupCommon } from "./EventHandlers/Pool/common";

describe("Helpers", () => {
  const Q96 = 2n ** 96n;

  describe("optionalBigintEffect", () => {
    it("passes a genuine bigint through unchanged", () => {
      expect(optionalBigintEffect(500n)).toBe(500n);
      expect(optionalBigintEffect(0n)).toBe(0n);
    });

    it("maps undefined to undefined", () => {
      expect(optionalBigintEffect(undefined)).toBeUndefined();
    });

    it("maps the envio v3.1.0-rc.x nested-option sentinel (Some(None)) to undefined", () => {
      // ReScript's runtime encoding of Some(None) for an option<option<bigint>>
      // — what a cached S.optional(S.bigint) effect leaks on a None cache hit.
      const sentinel = { BS_PRIVATE_NESTED_SOME_NONE: 0 };
      expect(optionalBigintEffect(sentinel)).toBeUndefined();
    });
  });

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

  describe("calculateTotalUSD (#755 trust gate)", () => {
    const { mockToken0Data, mockToken1Data } = setupCommon();
    const ION_LISK = toChecksumAddress(
      "0x3f608A49a3ab475dA7fBb167C1Be6b7a45cD7013",
    );

    it("sums both legs when both tokens are trusted (WL + not blacklisted)", () => {
      const amount0 = 1000000000000000000n; // 1.0 in 18-decimal
      const amount1 = 2000000n; // 2.0 in 6-decimal
      const total = calculateTotalUSD(
        amount0,
        amount1,
        mockToken0Data,
        mockToken1Data,
      );
      // 1 token0 * $1 + 2 token1 * $1 = $3, in 1e18-base
      expect(total).toBe(3n * 1000000000000000000n);
    });

    it("zeros token0's leg when token0 is non-whitelisted", () => {
      const amount0 = 1000000000000000000n;
      const amount1 = 2000000n;
      const token0NonWL: Token = {
        ...mockToken0Data,
        isWhitelisted: false,
      };
      const total = calculateTotalUSD(
        amount0,
        amount1,
        token0NonWL,
        mockToken1Data,
      );
      // Only token1 contributes: 2 * $1 = $2
      expect(total).toBe(2n * 1000000000000000000n);
    });

    it("zeros token1's leg when token1 is non-whitelisted", () => {
      const amount0 = 1000000000000000000n;
      const amount1 = 2000000n;
      const token1NonWL: Token = {
        ...mockToken1Data,
        isWhitelisted: false,
      };
      const total = calculateTotalUSD(
        amount0,
        amount1,
        mockToken0Data,
        token1NonWL,
      );
      // Only token0 contributes: 1 * $1 = $1
      expect(total).toBe(1n * 1000000000000000000n);
    });

    it("returns 0n when both tokens are non-whitelisted", () => {
      const token0NonWL: Token = {
        ...mockToken0Data,
        isWhitelisted: false,
      };
      const token1NonWL: Token = {
        ...mockToken1Data,
        isWhitelisted: false,
      };
      const total = calculateTotalUSD(
        1000000000000000000n,
        2000000n,
        token0NonWL,
        token1NonWL,
      );
      expect(total).toBe(0n);
    });

    it("zeros a WL token's leg when the token is BLACKLISTED", () => {
      const amount0 = 1000000000000000000n;
      const amount1 = 2000000n;
      // ION on Lisk is WL'd by the protocol but operator-blacklisted (#671)
      const blacklistedToken0: Token = {
        ...mockToken0Data,
        id: TokenId(1135, ION_LISK),
        address: ION_LISK as `0x${string}`,
        chainId: 1135,
        isWhitelisted: true,
      };
      const total = calculateTotalUSD(
        amount0,
        amount1,
        blacklistedToken0,
        mockToken1Data,
      );
      // token0 gated to 0 by BLACKLIST; only token1 contributes
      expect(total).toBe(2n * 1000000000000000000n);
    });

    it("treats undefined token entities as untrusted (contributes 0n)", () => {
      const total = calculateTotalUSD(
        1000000000000000000n,
        2000000n,
        undefined,
        mockToken1Data,
      );
      // token0 undefined -> 0; only token1 contributes
      expect(total).toBe(2n * 1000000000000000000n);
    });

    it("returns 0n when both token entities are undefined", () => {
      const total = calculateTotalUSD(
        1000000000000000000n,
        2000000n,
        undefined,
        undefined,
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

      const poolEntity: Pool = {
        ...mockPool,
        isCL: false,
        reserve0,
        reserve1,
        totalLPTokenSupply: totalSupply,
      } as Pool;

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
      } as Pool;

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
      } as Pool;

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
      } as unknown as Pool;

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

  describe("pickTrustedSwapVolumeUSD", () => {
    // After #755 slice 3e, the picker operates on pre-gated inputs: callers
    // route per-leg USD through PriceTrust.getTrustedUSD so untrusted legs
    // arrive as 0n. The picker is therefore a pure min/single-leg picker.
    // The #737 single-leg-non-WL refusal is now enforced upstream — its
    // regression intent is covered by PoolSwapLogic.test.ts and
    // CLPoolSwapLogic.test.ts at the integration level.
    it("returns min when both legs are non-zero", () => {
      expect(pickTrustedSwapVolumeUSD(100n, 99n)).toBe(99n);
      expect(pickTrustedSwapVolumeUSD(99n, 100n)).toBe(99n);
    });

    it("falls back to the non-zero leg when one is zero (single-leg fallback)", () => {
      expect(pickTrustedSwapVolumeUSD(0n, 500n)).toBe(500n);
      expect(pickTrustedSwapVolumeUSD(500n, 0n)).toBe(500n);
    });

    it("treats undefined as zero", () => {
      expect(pickTrustedSwapVolumeUSD(undefined, 500n)).toBe(500n);
      expect(pickTrustedSwapVolumeUSD(500n, undefined)).toBe(500n);
    });

    it("returns 0n when both legs are zero/undefined", () => {
      expect(pickTrustedSwapVolumeUSD(0n, 0n)).toBe(0n);
      expect(pickTrustedSwapVolumeUSD(undefined, undefined)).toBe(0n);
      expect(pickTrustedSwapVolumeUSD(undefined, 0n)).toBe(0n);
    });
  });
});
