import { SqrtPriceMath, TickMath } from "@uniswap/v3-sdk";
import JSBI from "jsbi";
import type {
  LiquidityPoolAggregator,
  NonFungiblePosition,
  handlerContext,
} from "../generated/src/Types.gen";
import {
  calculatePositionAmountsFromLiquidity,
  calculateStakedLiquidityUSD,
} from "../src/Helpers";
import { setupCommon } from "./EventHandlers/Pool/common";

describe("Helpers", () => {
  const Q96 = 2n ** 96n;

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
          id: `${tokenId}-${mockChainId}`,
          tokenId,
          chainId: mockChainId,
          pool: mockPoolAddress,
          tickLower,
          tickUpper,
          token0: mockToken0.address,
          token1: mockToken1.address,
          liquidity: amount,
          amount0: 0n,
          amount1: 0n,
          amountUSD: 0n,
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
          effect: async (fn: { name: string }, params: unknown) => {
            if (fn.name === "getSqrtPriceX96") {
              return sqrtPriceX96;
            }
            return {};
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
        } as LiquidityPoolAggregator;

        const mockContext = {
          NonFungiblePosition: {
            getWhere: {
              tokenId: {
                eq: async () => [],
              },
            },
          },
          effect: async (fn: { name: string }) => {
            if (fn.name === "getTotalSupply") {
              return totalSupply;
            }
            return {};
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
        } as LiquidityPoolAggregator;

        const mockContext = {
          NonFungiblePosition: {
            getWhere: {
              tokenId: {
                eq: async () => [],
              },
            },
          },
          effect: async (fn: { name: string }) => {
            if (fn.name === "getTotalSupply") {
              return 0n; // Zero totalSupply
            }
            return {};
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

      it("should handle errors in V2 pool calculation gracefully", async () => {
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
        } as LiquidityPoolAggregator;

        const mockContext = {
          NonFungiblePosition: {
            getWhere: {
              tokenId: {
                eq: async () => [],
              },
            },
          },
          effect: async () => {
            throw new Error("RPC error");
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

        // Pool that is neither CL nor V2 (edge case)
        const mockPoolAggregator: LiquidityPoolAggregator = {
          id: mockPoolAddress,
          chainId: mockChainId,
          isCL: false, // Not CL
          reserve0: 0n,
          reserve1: 0n,
        } as LiquidityPoolAggregator;

        const mockContext = {
          NonFungiblePosition: {
            getWhere: {
              tokenId: {
                eq: async () => [],
              },
            },
          },
          effect: async () => 0n, // Return 0 totalSupply to trigger fallback
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

        // Should return 0 due to zero totalSupply
        expect(result).toBe(0n);
      });

      it("should handle CL pool without tokenId", async () => {
        const amount = 1000000000000000000n;

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
                eq: async () => [],
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

        // CL pool without tokenId should fall through to fallback
        const result = await calculateStakedLiquidityUSD(
          amount,
          mockPoolAddress,
          mockChainId,
          mockBlockNumber,
          undefined, // No tokenId
          {
            liquidityPoolAggregator: mockPoolAggregator,
            token0Instance: mockToken0,
            token1Instance: mockToken1,
          },
          mockContext,
        );

        // Should return 0 (fallback case)
        expect(result).toBe(0n);
      });
    });
  });
});
