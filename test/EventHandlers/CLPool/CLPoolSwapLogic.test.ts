import type {
  CLPool_Swap_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { processCLPoolSwap } from "../../../src/EventHandlers/CLPool/CLPoolSwapLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolSwapLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();

  const mockEvent: CLPool_Swap_event = {
    params: {
      sender: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
      amount0: 1000000000000000000n, // 1 token
      amount1: -2000000000000000000n, // -2 tokens (negative means token1 out)
      sqrtPriceX96: 2000000000000000000000000000000n, // sqrt price
      liquidity: 1000000000000000000000n,
      tick: 1000n,
    },
    block: {
      timestamp: 1000000,
      number: 123456,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    },
    chainId: 10,
    logIndex: 1,
    srcAddress: "0x3333333333333333333333333333333333333333",
    transaction: {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    },
  } as CLPool_Swap_event;

  const mockLiquidityPoolAggregator: LiquidityPoolAggregator = {
    ...mockLiquidityPoolData,
    id: "0x1234567890123456789012345678901234567890",
    token0_id: mockToken0Data.id,
    token1_id: mockToken1Data.id,
    token0_address: mockToken0Data.address,
    token1_address: mockToken1Data.address,
    reserve0: 10000000n,
    reserve1: 6000000n,
    totalLiquidityUSD: 10000000n,
    token0Price: 1000000000000000000n, // 1 USD
    token1Price: 2000000000000000000n, // 2 USD
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  const mockToken0: Token = {
    ...mockToken0Data,
    id: "token0_id",
    address: "0xtoken0",
    symbol: "TOKEN0",
    name: "Token 0",
    decimals: 18n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD
    isWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  const mockToken1: Token = {
    ...mockToken1Data,
    id: "token1_id",
    address: "0xtoken1",
    symbol: "TOKEN1",
    name: "Token 1",
    decimals: 18n,
    pricePerUSDNew: 2000000000000000000n, // 2 USD
    isWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  const mockContext: handlerContext = {
    log: {
      error: () => {},
      warn: () => {},
      info: () => {},
    },
  } as unknown as handlerContext;

  describe("processCLPoolSwap", () => {
    it("should process swap event successfully with valid data", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Check liquidity pool diff with exact values
      expect(result.liquidityPoolDiff.totalVolume0).toBe(1000000000000000000n); // amount0 (1 token)
      expect(result.liquidityPoolDiff.totalVolume1).toBe(2000000000000000000n); // |amount1| (2 tokens, absolute value)
      expect(result.liquidityPoolDiff.numberOfSwaps).toBe(1n);

      expect(result.liquidityPoolDiff.totalVolumeUSD).toBe(
        1000000000000000000n,
      );

      // Check user swap diff with exact values
      expect(result.userSwapDiff.numberOfSwaps).toBe(1n);
      expect(result.userSwapDiff.totalSwapVolumeAmount0).toBe(
        1000000000000000000n,
      ); // abs(amount0) = abs(1 token) = 1 token
      expect(result.userSwapDiff.totalSwapVolumeAmount1).toBe(
        2000000000000000000n,
      ); // abs(amount1) = abs(-2 tokens) = 2 tokens
      expect(result.userSwapDiff.totalSwapVolumeUSD).toBe(1000000000000000000n); // 1 USD in 18 decimals
    });

    it("should calculate correct volume values for swap event", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // The liquidity pool diff should reflect the swap volumes with exact values
      expect(result.liquidityPoolDiff.totalVolume0).toBe(1000000000000000000n); // amount0
      expect(result.liquidityPoolDiff.totalVolume1).toBe(2000000000000000000n); // |amount1|
      expect(result.liquidityPoolDiff.totalVolumeUSD).toBe(
        1000000000000000000n,
      );
      expect(result.liquidityPoolDiff.numberOfSwaps).toBe(1n);

      // User swap diff should track individual user activity with exact values
      expect(result.userSwapDiff.numberOfSwaps).toBe(1n);
      expect(result.userSwapDiff.totalSwapVolumeAmount0).toBe(
        1000000000000000000n,
      ); // abs(amount0) = abs(1 token) = 1 token
      expect(result.userSwapDiff.totalSwapVolumeAmount1).toBe(
        2000000000000000000n,
      ); // abs(amount1) = abs(-2 tokens) = 2 tokens
      expect(result.userSwapDiff.totalSwapVolumeUSD).toBe(1000000000000000000n);
    });

    it("should handle different token decimals correctly", async () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n, // USDC-like token
      };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        tokenWithDifferentDecimals,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userSwapDiff).toBeDefined();
    });

    it("should handle zero amounts correctly", async () => {
      const eventWithZeroAmounts: CLPool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 0n,
          amount1: 0n,
        },
      };

      const result = await processCLPoolSwap(
        eventWithZeroAmounts,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.totalVolume0).toBe(0n);
      expect(result.liquidityPoolDiff.totalVolume1).toBe(0n);
      expect(result.liquidityPoolDiff.totalVolumeUSD).toBe(0n);
      expect(result.userSwapDiff.totalSwapVolumeAmount0).toBe(0n); // abs(0) = 0
      expect(result.userSwapDiff.totalSwapVolumeAmount1).toBe(0n); // abs(0) = 0
      expect(result.userSwapDiff.totalSwapVolumeUSD).toBe(0n);
    });

    it("should handle existing swap data correctly", async () => {
      const poolWithExistingSwaps: LiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        totalVolume0: 5000n,
        totalVolume1: 3000n,
        totalVolumeUSD: 8000n,
        numberOfSwaps: 5n,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        poolWithExistingSwaps,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.numberOfSwaps).toBe(1n); // Only the diff, not cumulative
      expect(result.liquidityPoolDiff.totalVolume0).toBe(1000000000000000000n); // amount0
      expect(result.liquidityPoolDiff.totalVolume1).toBe(2000000000000000000n); // |amount1|
      expect(result.liquidityPoolDiff.totalVolumeUSD).toBe(
        1000000000000000000n,
      ); // Only the diff, not cumulative
    });

    it("should handle undefined token0 by falling back to original instance", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        mockToken1,
        mockContext,
      );

      // Should still process the swap with token1
      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.liquidityPoolDiff.totalVolume1).toBe(2000000000000000000n);
      // Price should fallback to pool's existing price when token0 is undefined
      expect(result.liquidityPoolDiff.token0Price).toBe(
        mockLiquidityPoolAggregator.token0Price,
      );
      expect(result.liquidityPoolDiff.token0IsWhitelisted).toBe(false);
    });

    it("should handle undefined token1 by falling back to original instance", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        undefined,
        mockContext,
      );

      // Should still process the swap with token0
      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.liquidityPoolDiff.totalVolume0).toBe(1000000000000000000n);
      // Price should fallback to pool's existing price when token1 is undefined
      expect(result.liquidityPoolDiff.token1Price).toBe(
        mockLiquidityPoolAggregator.token1Price,
      );
      expect(result.liquidityPoolDiff.token1IsWhitelisted).toBe(false);
    });

    it("should handle both tokens undefined", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        undefined,
        mockContext,
      );

      // Should still process but with fallback values
      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.liquidityPoolDiff.token0Price).toBe(
        mockLiquidityPoolAggregator.token0Price,
      );
      expect(result.liquidityPoolDiff.token1Price).toBe(
        mockLiquidityPoolAggregator.token1Price,
      );
      expect(result.liquidityPoolDiff.token0IsWhitelisted).toBe(false);
      expect(result.liquidityPoolDiff.token1IsWhitelisted).toBe(false);
    });

    it("should calculate reserves correctly with positive amounts", async () => {
      const eventWithPositiveAmounts: CLPool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 5000000000000000000n, // +5 tokens
          amount1: 3000000000000000000n, // +3 tokens
        },
      };

      const result = await processCLPoolSwap(
        eventWithPositiveAmounts,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Reserves should be added (delta is positive)
      expect(result.liquidityPoolDiff.reserve0).toBe(5000000000000000000n);
      expect(result.liquidityPoolDiff.reserve1).toBe(3000000000000000000n);
      // User swap diff should use absolute values
      expect(result.userSwapDiff.totalSwapVolumeAmount0).toBe(
        5000000000000000000n,
      ); // abs(5 tokens) = 5 tokens
      expect(result.userSwapDiff.totalSwapVolumeAmount1).toBe(
        3000000000000000000n,
      ); // abs(3 tokens) = 3 tokens
    });

    it("should calculate reserves correctly with negative amounts", async () => {
      const eventWithNegativeAmounts: CLPool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: -5000000000000000000n, // -5 tokens (token0 out)
          amount1: -3000000000000000000n, // -3 tokens (token1 out)
        },
      };

      const result = await processCLPoolSwap(
        eventWithNegativeAmounts,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Reserves should be subtracted (delta is negative)
      expect(result.liquidityPoolDiff.reserve0).toBe(-5000000000000000000n);
      expect(result.liquidityPoolDiff.reserve1).toBe(-3000000000000000000n);
      // Volumes should still be absolute values
      expect(result.liquidityPoolDiff.totalVolume0).toBe(5000000000000000000n);
      expect(result.liquidityPoolDiff.totalVolume1).toBe(3000000000000000000n);
      // User swap diff should also use absolute values
      expect(result.userSwapDiff.totalSwapVolumeAmount0).toBe(
        5000000000000000000n,
      ); // abs(-5 tokens) = 5 tokens
      expect(result.userSwapDiff.totalSwapVolumeAmount1).toBe(
        3000000000000000000n,
      ); // abs(-3 tokens) = 3 tokens
    });

    it("should calculate liquidity delta correctly when liquidity increases", async () => {
      const poolWithLowLiquidity: LiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        reserve0: 1000000000000000000n, // 1 token
        reserve1: 2000000000000000000n, // 2 tokens
        totalLiquidityUSD: 5000000000000000000n, // 5 USD
      };

      const eventAddingLiquidity: CLPool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 1000000000000000000n, // +1 token
          amount1: 2000000000000000000n, // +2 tokens
        },
      };

      const result = await processCLPoolSwap(
        eventAddingLiquidity,
        poolWithLowLiquidity,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // New reserves: 1 + 1 = 2 tokens0, 2 + 2 = 4 tokens1
      // New liquidity: 2 * $1 + 4 * $2 = $2 + $8 = $10
      // Delta: $10 - $5 = $5
      expect(result.liquidityPoolDiff.totalLiquidityUSD).toBe(
        5000000000000000000n, // $5 in 18 decimals
      );
    });

    it("should calculate liquidity delta correctly when liquidity decreases", async () => {
      const poolWithHighLiquidity: LiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        reserve0: 10000000000000000000n, // 10 tokens
        reserve1: 20000000000000000000n, // 20 tokens
        totalLiquidityUSD: 50000000000000000000n, // 50 USD
      };

      const eventRemovingLiquidity: CLPool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: -5000000000000000000n, // -5 tokens
          amount1: -10000000000000000000n, // -10 tokens
        },
      };

      const result = await processCLPoolSwap(
        eventRemovingLiquidity,
        poolWithHighLiquidity,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // New reserves: 10 - 5 = 5 tokens0, 20 - 10 = 10 tokens1
      // New liquidity: 5 * $1 + 10 * $2 = $5 + $20 = $25
      // Delta: $25 - $50 = -$25
      expect(result.liquidityPoolDiff.totalLiquidityUSD).toBe(
        -25000000000000000000n, // -$25 in 18 decimals
      );
    });

    it("should use updated token prices when available", async () => {
      const token0WithNewPrice: Token = {
        ...mockToken0,
        pricePerUSDNew: 1500000000000000000n, // $1.50 (was $1.00)
      };

      const token1WithNewPrice: Token = {
        ...mockToken1,
        pricePerUSDNew: 2500000000000000000n, // $2.50 (was $2.00)
      };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        token0WithNewPrice,
        token1WithNewPrice,
        mockContext,
      );

      // Should use the new prices from the updated tokens
      expect(result.liquidityPoolDiff.token0Price).toBe(1500000000000000000n);
      expect(result.liquidityPoolDiff.token1Price).toBe(2500000000000000000n);
    });

    it("should fallback to pool prices when swapData doesn't return updated prices", async () => {
      // This tests the fallback logic when updateSwapTokenData returns undefined tokens
      // In practice, this happens when tokens are undefined, but we can test the fallback
      const poolWithPrices: LiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        token0Price: 999000000000000000n, // $0.999
        token1Price: 1999000000000000000n, // $1.999
      };

      const result = await processCLPoolSwap(
        mockEvent,
        poolWithPrices,
        undefined,
        undefined,
        mockContext,
      );

      // Should fallback to pool's existing prices
      expect(result.liquidityPoolDiff.token0Price).toBe(
        poolWithPrices.token0Price,
      );
      expect(result.liquidityPoolDiff.token1Price).toBe(
        poolWithPrices.token1Price,
      );
    });

    it("should correctly set whitelisted status from updated tokens", async () => {
      const whitelistedToken0: Token = {
        ...mockToken0,
        isWhitelisted: true,
      };

      const whitelistedToken1: Token = {
        ...mockToken1,
        isWhitelisted: true,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        whitelistedToken0,
        whitelistedToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.token0IsWhitelisted).toBe(true);
      expect(result.liquidityPoolDiff.token1IsWhitelisted).toBe(true);
      // When both are whitelisted, whitelisted volume should equal total volume
      expect(result.liquidityPoolDiff.totalVolumeUSDWhitelisted).toBe(
        result.liquidityPoolDiff.totalVolumeUSD,
      );
    });

    it("should fallback whitelisted status to false when tokens are undefined", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        undefined,
        mockContext,
      );

      expect(result.liquidityPoolDiff.token0IsWhitelisted).toBe(false);
      expect(result.liquidityPoolDiff.token1IsWhitelisted).toBe(false);
      expect(result.liquidityPoolDiff.totalVolumeUSDWhitelisted).toBe(0n);
    });

    it("should handle mixed whitelisted status correctly", async () => {
      const whitelistedToken0: Token = {
        ...mockToken0,
        isWhitelisted: true,
      };

      const nonWhitelistedToken1: Token = {
        ...mockToken1,
        isWhitelisted: false,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        whitelistedToken0,
        nonWhitelistedToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.token0IsWhitelisted).toBe(true);
      expect(result.liquidityPoolDiff.token1IsWhitelisted).toBe(false);
      // When only one is whitelisted, whitelisted volume should be 0
      expect(result.liquidityPoolDiff.totalVolumeUSDWhitelisted).toBe(0n);
    });
  });
});
