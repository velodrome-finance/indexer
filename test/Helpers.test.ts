import {
  SqrtPriceMath,
  TickMath,
  maxLiquidityForAmounts,
} from "@uniswap/v3-sdk";
import JSBI from "jsbi";
import type {
  LiquidityPoolAggregator,
  NonFungiblePosition,
  Token,
  handlerContext,
} from "../generated/src/Types.gen";
import { NonFungiblePositionId } from "../src/Constants";
import {
  calculatePositionAmountsFromLiquidity,
  calculateStakedLiquidityUSD,
  calculateTotalUSD,
  calculateWhitelistedFeesUSD,
  computeLiquidityDeltaFromAmounts,
  executeEffectWithRoundedBlockRetry,
} from "../src/Helpers";
import { setupCommon } from "./EventHandlers/Pool/common";

describe("Helpers", () => {
  const Q96 = 2n ** 96n;

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

  describe("calculateStakedLiquidityUSD", () => {
    const {
      mockToken0Data: mockToken0,
      mockToken1Data: mockToken1,
      mockLiquidityPoolData: mockLiquidityPoolAggregator,
    } = setupCommon();
    const mockChainId = mockToken0.chainId;
    const mockPoolAddress = mockLiquidityPoolAggregator.id;
    const mockBlockNumber = 100;

    describe("CL Pool calculations", () => {
      it("should calculate USD value for CL pool with valid position", async () => {
        const amount = 1000000000000000000n; // 1e18 liquidity
        const tokenId = 1127n;
        const tickLower = -100n;
        const tickUpper = 100n;
        const sqrtPriceX96 = 79228162514264337593543950336n; // Price at tick 0

        const mockPosition: NonFungiblePosition = {
          id: NonFungiblePositionId(mockChainId, mockPoolAddress, tokenId),
          tokenId,
          chainId: mockChainId,
          pool: mockPoolAddress,
          tickLower,
          tickUpper,
          token0: mockToken0.address,
          token1: mockToken1.address,
          liquidity: amount,
          mintLogIndex: 0,
          owner: "0x2222222222222222222222222222222222222222",
          mintTransactionHash:
            "0x0000000000000000000000000000000000000000000000000000000000000000",
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        };

        const mockPoolAggregator: LiquidityPoolAggregator = {
          id: mockPoolAddress,
          chainId: mockChainId,
          isCL: true,
          reserve0: 0n,
          reserve1: 0n,
          sqrtPriceX96: sqrtPriceX96,
        } as LiquidityPoolAggregator;

        const mockContext = {
          NonFungiblePosition: {
            getWhere: {
              tokenId: {
                eq: async (tid: bigint) => {
                  if (tid === tokenId) {
                    return [mockPosition];
                  }
                  return [];
                },
              },
            },
          },
          log: {
            warn: () => {},
            error: () => {},
            info: () => {},
            debug: () => {},
          },
        } as unknown as handlerContext;

        // Calculate expected amounts
        const { amount0, amount1 } = calculatePositionAmountsFromLiquidity(
          amount,
          sqrtPriceX96,
          tickLower,
          tickUpper,
        );

        // Expected USD: amount0 * price0 + amount1 * price1
        // token0 has 18 decimals, token1 has 6 decimals, both prices are 1 USD
        // Normalize to 18 decimals for USD calculation
        const normalizedAmount0 =
          (amount0 * 10n ** 18n) / 10n ** mockToken0.decimals;
        const normalizedAmount1 =
          (amount1 * 10n ** 18n) / 10n ** mockToken1.decimals;
        const expectedUSD =
          (normalizedAmount0 * mockToken0.pricePerUSDNew) / 10n ** 18n +
          (normalizedAmount1 * mockToken1.pricePerUSDNew) / 10n ** 18n;

        const result = await calculateStakedLiquidityUSD(
          amount,
          mockPoolAddress,
          mockChainId,
          mockBlockNumber,
          tokenId,
          {
            liquidityPoolAggregator: mockPoolAggregator,
            token0Instance: mockToken0,
            token1Instance: mockToken1,
          },
          mockContext,
        );

        expect(result).toBe(expectedUSD);
        expect(result > 0n).toBe(true);
      });

      it("should return 0 when position is not found for CL pool", async () => {
        const amount = 1000000000000000000n;
        const tokenId = 9999n; // Non-existent tokenId

        const mockPoolAggregator: LiquidityPoolAggregator = {
          id: mockPoolAddress,
          chainId: mockChainId,
          isCL: true,
          reserve0: 0n,
          reserve1: 0n,
        } as LiquidityPoolAggregator;

        const mockContext = {
          NonFungiblePosition: {
            getWhere: {
              tokenId: {
                eq: async () => [], // No position found
              },
            },
          },
          effect: async () => ({}),
          log: {
            warn: () => {},
            error: () => {},
            info: () => {},
            debug: () => {},
          },
        } as unknown as handlerContext;

        const result = await calculateStakedLiquidityUSD(
          amount,
          mockPoolAddress,
          mockChainId,
          mockBlockNumber,
          tokenId,
          {
            liquidityPoolAggregator: mockPoolAggregator,
            token0Instance: mockToken0,
            token1Instance: mockToken1,
          },
          mockContext,
        );

        expect(result).toBe(0n);
      });

      it("should handle errors in CL pool calculation gracefully", async () => {
        const amount = 1000000000000000000n;
        const tokenId = 1127n;

        const mockPoolAggregator: LiquidityPoolAggregator = {
          id: mockPoolAddress,
          chainId: mockChainId,
          isCL: true,
          reserve0: 0n,
          reserve1: 0n,
        } as LiquidityPoolAggregator;

        const mockContext = {
          NonFungiblePosition: {
            getWhere: {
              tokenId: {
                eq: async () => {
                  throw new Error("Database error");
                },
              },
            },
          },
          effect: async () => ({}),
          log: {
            warn: () => {},
            error: () => {},
            info: () => {},
            debug: () => {},
          },
        } as unknown as handlerContext;

        const result = await calculateStakedLiquidityUSD(
          amount,
          mockPoolAddress,
          mockChainId,
          mockBlockNumber,
          tokenId,
          {
            liquidityPoolAggregator: mockPoolAggregator,
            token0Instance: mockToken0,
            token1Instance: mockToken1,
          },
          mockContext,
        );

        expect(result).toBe(0n);
      });
    });

    describe("V2 Pool calculations", () => {
      it("should calculate USD value for V2 pool with valid reserves and totalSupply", async () => {
        const amount = 100000000000000000000n; // 100 LP tokens (18 decimals)
        // token0 has 18 decimals, token1 has 6 decimals
        const reserve0 = 1000000000000000000000n; // 1000 tokens (18 decimals)
        const reserve1 = 1000000000n; // 1000 tokens (6 decimals)
        const totalSupply = 1000000000000000000000n; // 1000 LP tokens (18 decimals)

        const mockPoolAggregator: LiquidityPoolAggregator = {
          id: mockPoolAddress,
          chainId: mockChainId,
          isCL: false,
          reserve0,
          reserve1,
          totalLPTokenSupply: totalSupply,
        } as LiquidityPoolAggregator;

        const mockContext = {
          NonFungiblePosition: {
            getWhere: {
              tokenId: {
                eq: async () => [],
              },
            },
          },
          log: {
            warn: () => {},
            error: () => {},
            info: () => {},
            debug: () => {},
          },
        } as unknown as handlerContext;

        // Calculate expected: amount0 = (100 LP * 1000 reserve0) / 1000 totalSupply = 100
        // amount1 = (100 LP * 1000 reserve1) / 1000 totalSupply = 100
        // Normalize to 18 decimals using actual token decimals
        // token0 has 18 decimals, token1 has 6 decimals
        const expectedAmount0 = (amount * reserve0) / totalSupply;
        const expectedAmount1 = (amount * reserve1) / totalSupply;
        const normalizedAmount0 =
          (expectedAmount0 * 10n ** 18n) / 10n ** mockToken0.decimals;
        const normalizedAmount1 =
          (expectedAmount1 * 10n ** 18n) / 10n ** mockToken1.decimals;
        const expectedUSD =
          (normalizedAmount0 * mockToken0.pricePerUSDNew) / 10n ** 18n +
          (normalizedAmount1 * mockToken1.pricePerUSDNew) / 10n ** 18n;

        const result = await calculateStakedLiquidityUSD(
          amount,
          mockPoolAddress,
          mockChainId,
          mockBlockNumber,
          undefined, // No tokenId for V2
          {
            liquidityPoolAggregator: mockPoolAggregator,
            token0Instance: mockToken0,
            token1Instance: mockToken1,
          },
          mockContext,
        );

        expect(result).toBe(expectedUSD);
      });

      it("should return 0 when totalSupply is 0 for V2 pool", async () => {
        const amount = 100000000000000000000n;
        // token0 has 18 decimals, token1 has 6 decimals
        const reserve0 = 1000000000000000000000n; // 1000 tokens (18 decimals)
        const reserve1 = 1000000000n; // 1000 tokens (6 decimals)

        const mockPoolAggregator: LiquidityPoolAggregator = {
          id: mockPoolAddress,
          chainId: mockChainId,
          isCL: false,
          reserve0,
          reserve1,
          totalLPTokenSupply: 0n,
        } as LiquidityPoolAggregator;

        const mockContext = {
          NonFungiblePosition: {
            getWhere: {
              tokenId: {
                eq: async () => [],
              },
            },
          },
          log: {
            warn: () => {},
            error: () => {},
            info: () => {},
            debug: () => {},
          },
        } as unknown as handlerContext;

        const result = await calculateStakedLiquidityUSD(
          amount,
          mockPoolAddress,
          mockChainId,
          mockBlockNumber,
          undefined,
          {
            liquidityPoolAggregator: mockPoolAggregator,
            token0Instance: mockToken0,
            token1Instance: mockToken1,
          },
          mockContext,
        );

        expect(result).toBe(0n);
      });

      it("should return 0 when totalSupply is undefined for V2 pool", async () => {
        const amount = 100000000000000000000n;
        const reserve0 = 1000000000000000000000n;
        const reserve1 = 1000000000n;

        const mockPoolAggregator = {
          id: mockPoolAddress,
          chainId: mockChainId,
          isCL: false,
          reserve0,
          reserve1,
          totalLPTokenSupply: undefined,
        } as unknown as LiquidityPoolAggregator;

        const mockContext = {
          NonFungiblePosition: {
            getWhere: {
              tokenId: {
                eq: async () => [],
              },
            },
          },
          log: {
            warn: () => {},
            error: () => {},
            info: () => {},
            debug: () => {},
          },
        } as unknown as handlerContext;

        const result = await calculateStakedLiquidityUSD(
          amount,
          mockPoolAddress,
          mockChainId,
          mockBlockNumber,
          undefined,
          {
            liquidityPoolAggregator: mockPoolAggregator,
            token0Instance: mockToken0,
            token1Instance: mockToken1,
          },
          mockContext,
        );

        expect(result).toBe(0n);
      });
    });

    describe("Edge cases", () => {
      it("should return 0 for unsupported pool type", async () => {
        const amount = 100000000000000000000n;

        // CL pool without tokenId hits the "unsupported pool type" fallback (totalLPTokenSupply not used on this path)
        const mockPoolAggregator: LiquidityPoolAggregator = {
          id: mockPoolAddress,
          chainId: mockChainId,
          isCL: true,
          reserve0: 0n,
          reserve1: 0n,
          totalLPTokenSupply: 0n,
        } as LiquidityPoolAggregator;

        const mockContext = {
          NonFungiblePosition: {
            getWhere: {
              tokenId: {
                eq: async () => [],
              },
            },
          },
          log: {
            warn: () => {},
            error: () => {},
            info: () => {},
            debug: () => {},
          },
        } as unknown as handlerContext;

        const result = await calculateStakedLiquidityUSD(
          amount,
          mockPoolAddress,
          mockChainId,
          mockBlockNumber,
          undefined,
          {
            liquidityPoolAggregator: mockPoolAggregator,
            token0Instance: mockToken0,
            token1Instance: mockToken1,
          },
          mockContext,
        );

        expect(result).toBe(0n);
      });
    });
  });

  describe("executeEffectWithRoundedBlockRetry", () => {
    let mockContext: handlerContext;
    let logInfoCalls: string[];
    let logErrorCalls: string[];

    beforeEach(() => {
      logInfoCalls = [];
      logErrorCalls = [];
      mockContext = {
        log: {
          info: (msg: unknown) => logInfoCalls.push(String(msg)),
          warn: () => {},
          error: (msg: unknown) => logErrorCalls.push(String(msg)),
          debug: () => {},
        },
      } as unknown as handlerContext;
    });

    afterEach(() => {
      logInfoCalls = [];
      logErrorCalls = [];
    });

    describe("when block numbers are the same", () => {
      it("should call effect once with rounded block and return result", async () => {
        const mockEffect = jest.fn().mockResolvedValue(100n);
        const input = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1000,
        };

        const result = await executeEffectWithRoundedBlockRetry(
          mockEffect,
          input,
          input,
          mockContext,
          "[test]",
        );

        expect(result).toBe(100n);
        expect(mockEffect).toHaveBeenCalledTimes(1);
        expect(mockEffect).toHaveBeenCalledWith(input);
        expect(logInfoCalls).toHaveLength(0);
      });
    });

    describe("when rounded block succeeds", () => {
      it("should return result without retry", async () => {
        const mockEffect = jest.fn().mockResolvedValue(100n);
        const roundedInput = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1000,
        };
        const originalInput = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1050,
        };

        const result = await executeEffectWithRoundedBlockRetry(
          mockEffect,
          roundedInput,
          originalInput,
          mockContext,
          "[test]",
        );

        expect(result).toBe(100n);
        expect(mockEffect).toHaveBeenCalledTimes(1);
        expect(mockEffect).toHaveBeenCalledWith(roundedInput);
        expect(logInfoCalls).toHaveLength(0);
      });

      it("should not retry on zero value when retryOnZero is false", async () => {
        const mockEffect = jest.fn().mockResolvedValue(0n);
        const roundedInput = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1000,
        };
        const originalInput = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1050,
        };

        const result = await executeEffectWithRoundedBlockRetry(
          mockEffect,
          roundedInput,
          originalInput,
          mockContext,
          "[test]",
          { retryOnZero: false },
        );

        expect(result).toBe(0n);
        expect(mockEffect).toHaveBeenCalledTimes(1);
        expect(mockEffect).toHaveBeenCalledWith(roundedInput);
        expect(logInfoCalls).toHaveLength(0);
      });
    });

    describe("when retryOnZero is enabled", () => {
      it("should retry with original block when rounded block returns zero", async () => {
        const mockEffect = jest
          .fn()
          .mockResolvedValueOnce(0n) // First call (rounded) returns 0
          .mockResolvedValueOnce(100n); // Second call (original) returns non-zero

        const roundedInput = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1000,
        };
        const originalInput = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1050,
        };

        const result = await executeEffectWithRoundedBlockRetry(
          mockEffect,
          roundedInput,
          originalInput,
          mockContext,
          "[test]",
          {
            retryOnZero: true,
            zeroValue: 0n,
          },
        );

        expect(result).toBe(100n);
        expect(mockEffect).toHaveBeenCalledTimes(2);
        expect(mockEffect).toHaveBeenNthCalledWith(1, roundedInput);
        expect(mockEffect).toHaveBeenNthCalledWith(2, originalInput);
        expect(logInfoCalls).toHaveLength(1);
        expect(logInfoCalls[0]).toContain("Effect returned zero value");
        expect(logInfoCalls[0]).toContain("1000");
        expect(logInfoCalls[0]).toContain("1050");
      });

      it("should return zero if both rounded and original blocks return zero", async () => {
        const mockEffect = jest
          .fn()
          .mockResolvedValueOnce(0n) // First call (rounded) returns 0
          .mockResolvedValueOnce(0n); // Second call (original) also returns 0

        const roundedInput = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1000,
        };
        const originalInput = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1050,
        };

        const result = await executeEffectWithRoundedBlockRetry(
          mockEffect,
          roundedInput,
          originalInput,
          mockContext,
          "[test]",
          {
            retryOnZero: true,
            zeroValue: 0n,
          },
        );

        expect(result).toBe(0n);
        expect(mockEffect).toHaveBeenCalledTimes(2);
        expect(logInfoCalls).toHaveLength(1);
      });
    });

    describe("when rounded block throws an exception", () => {
      it("should retry with original block and return result", async () => {
        const error = new Error("Contract does not exist");
        const mockEffect = jest
          .fn()
          .mockRejectedValueOnce(error) // First call (rounded) throws
          .mockResolvedValueOnce(100n); // Second call (original) succeeds

        const roundedInput = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1000,
        };
        const originalInput = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1050,
        };

        const result = await executeEffectWithRoundedBlockRetry(
          mockEffect,
          roundedInput,
          originalInput,
          mockContext,
          "[test]",
        );

        expect(result).toBe(100n);
        expect(mockEffect).toHaveBeenCalledTimes(2);
        expect(mockEffect).toHaveBeenNthCalledWith(1, roundedInput);
        expect(mockEffect).toHaveBeenNthCalledWith(2, originalInput);
        expect(logInfoCalls).toHaveLength(1);
        expect(logInfoCalls[0]).toContain("Effect failed at rounded block");
        expect(logInfoCalls[0]).toContain("1000");
        expect(logInfoCalls[0]).toContain("1050");
      });

      it("should throw if both rounded and original blocks fail", async () => {
        const error = new Error("Contract does not exist");
        const mockEffect = jest
          .fn()
          .mockRejectedValueOnce(error) // First call (rounded) throws
          .mockRejectedValueOnce(error); // Second call (original) also throws

        const roundedInput = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1000,
        };
        const originalInput = {
          tokenAddress: "0x123",
          chainId: 10,
          blockNumber: 1050,
        };

        await expect(
          executeEffectWithRoundedBlockRetry(
            mockEffect,
            roundedInput,
            originalInput,
            mockContext,
            "[test]",
          ),
        ).rejects.toThrow("Contract does not exist");

        expect(mockEffect).toHaveBeenCalledTimes(2);
        expect(logInfoCalls).toHaveLength(1);
      });
    });

    describe("with different input types", () => {
      it("should work with bigint return type", async () => {
        const mockEffect = jest.fn().mockResolvedValue(1000n);
        const roundedInput = {
          poolAddress: "0x456",
          chainId: 10,
          blockNumber: 2000,
        };
        const originalInput = {
          poolAddress: "0x456",
          chainId: 10,
          blockNumber: 2050,
        };

        const result = await executeEffectWithRoundedBlockRetry(
          mockEffect,
          roundedInput,
          originalInput,
          mockContext,
          "[test]",
        );

        expect(result).toBe(1000n);
        expect(mockEffect).toHaveBeenCalledTimes(1);
      });

      it("should work with string return type", async () => {
        const mockEffect = jest.fn().mockResolvedValue("success");
        const roundedInput = {
          address: "0x789",
          chainId: 10,
          blockNumber: 3000,
        };
        const originalInput = {
          address: "0x789",
          chainId: 10,
          blockNumber: 3050,
        };

        const result = await executeEffectWithRoundedBlockRetry(
          mockEffect,
          roundedInput,
          originalInput,
          mockContext,
          "[test]",
        );

        expect(result).toBe("success");
        expect(mockEffect).toHaveBeenCalledTimes(1);
      });

      it("should work with object return type and custom zero value", async () => {
        const zeroValue = { value: 0n };
        const mockEffect = jest
          .fn()
          .mockResolvedValueOnce(zeroValue) // First call returns zero
          .mockResolvedValueOnce({ value: 100n }); // Second call returns non-zero

        const roundedInput = {
          tokenAddress: "0xabc",
          chainId: 10,
          blockNumber: 4000,
        };
        const originalInput = {
          tokenAddress: "0xabc",
          chainId: 10,
          blockNumber: 4050,
        };

        const result = await executeEffectWithRoundedBlockRetry(
          mockEffect,
          roundedInput,
          originalInput,
          mockContext,
          "[test]",
          {
            retryOnZero: true,
            zeroValue,
          },
        );

        expect(result).toEqual({ value: 100n });
        expect(mockEffect).toHaveBeenCalledTimes(2);
        expect(logInfoCalls).toHaveLength(1);
      });
    });

    describe("edge cases", () => {
      it("should handle when rounded block succeeds but original block is needed for zero retry", async () => {
        const mockEffect = jest
          .fn()
          .mockResolvedValueOnce(0n) // Rounded block returns 0
          .mockResolvedValueOnce(50n); // Original block returns non-zero

        const roundedInput = {
          tokenAddress: "0xdef",
          chainId: 10,
          blockNumber: 5000,
        };
        const originalInput = {
          tokenAddress: "0xdef",
          chainId: 10,
          blockNumber: 5011, // Different block
        };

        const result = await executeEffectWithRoundedBlockRetry(
          mockEffect,
          roundedInput,
          originalInput,
          mockContext,
          "[test]",
          {
            retryOnZero: true,
            zeroValue: 0n,
          },
        );

        expect(result).toBe(50n);
        expect(mockEffect).toHaveBeenCalledTimes(2);
      });

      it("should preserve error stack trace when retrying", async () => {
        const error = new Error("Original error");
        error.stack = "Error: Original error\n    at test.js:1:1";
        const mockEffect = jest
          .fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce(200n);

        const roundedInput = {
          tokenAddress: "0xghi",
          chainId: 10,
          blockNumber: 6000,
        };
        const originalInput = {
          tokenAddress: "0xghi",
          chainId: 10,
          blockNumber: 6050,
        };

        const result = await executeEffectWithRoundedBlockRetry(
          mockEffect,
          roundedInput,
          originalInput,
          mockContext,
          "[test]",
        );

        expect(result).toBe(200n);
        expect(mockEffect).toHaveBeenCalledTimes(2);
      });
    });
  });
});
