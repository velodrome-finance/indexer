import type {
  CLPool_CollectFees_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { processCLPoolCollectFees } from "../../../src/EventHandlers/CLPool/CLPoolCollectFeesLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolCollectFeesLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const mockEvent: CLPool_CollectFees_event = {
    params: {
      owner: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
      amount0: 1000000000000000000n, // 1 token
      amount1: 2000000000000000000n, // 2 tokens
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
  } as CLPool_CollectFees_event;

  const mockLiquidityPoolAggregator: LiquidityPoolAggregator = {
    ...mockLiquidityPoolData,
    id: "0x1234567890123456789012345678901234567890",
    token0_id: mockToken0Data.id,
    token1_id: mockToken1Data.id,
    token0_address: mockToken0Data.address,
    token1_address: mockToken1Data.address,
    isCL: true,
    reserve0: 10000000n,
    reserve1: 6000000n,
    totalLiquidityUSD: 10000000n,
    token0Price: 1000000000000000000n,
    token1Price: 2000000000000000000n,
    gaugeIsAlive: false,
    token0IsWhitelisted: false,
    token1IsWhitelisted: false,
    totalUnstakedFeesCollected0: 0n,
    totalUnstakedFeesCollected1: 0n,
    totalUnstakedFeesCollectedUSD: 0n,
    totalStakedFeesCollected0: 0n, // Override to 0 for this test
    totalStakedFeesCollected1: 0n, // Override to 0 for this test
    totalStakedFeesCollectedUSD: 0n, // Override to 0 for this test
    totalFeesUSDWhitelisted: 0n, // Override to 0 for this test
    lastUpdatedTimestamp: new Date(1000000 * 1000),
    lastSnapshotTimestamp: new Date(1000000 * 1000),
  };

  const mockToken0: Token = {
    ...mockToken0Data,
    id: "token0_id",
    address: "0xtoken0",
    symbol: "TOKEN0",
    name: "Token 0",
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
    pricePerUSDNew: 2000000000000000000n,
    isWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  describe("processCLPoolCollectFees", () => {
    it("should process collect fees event successfully with valid data", () => {
      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      // Check liquidity pool diff with exact values (staked fees)
      expect(result.liquidityPoolDiff.totalStakedFeesCollected0).toBe(
        1000000000000000000n,
      );
      expect(result.liquidityPoolDiff.totalStakedFeesCollected1).toBe(
        2000000000000000000n,
      );

      // Exact USD calculation: 1 USD + 4 USD = 5 USD
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(
        5000000000000000000n,
      );

      // Check user diff
      expect(result.userDiff.totalFeesContributedUSD).toBe(
        5000000000000000000n,
      );
      expect(result.userDiff.totalFeesContributed0).toBe(1000000000000000000n);
      expect(result.userDiff.totalFeesContributed1).toBe(2000000000000000000n);
    });

    it("should calculate correct fee values for collect fees event", () => {
      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      // The liquidity pool diff should reflect the staked fees being collected with exact values
      expect(result.liquidityPoolDiff.totalStakedFeesCollected0).toBe(
        1000000000000000000n,
      );
      expect(result.liquidityPoolDiff.totalStakedFeesCollected1).toBe(
        2000000000000000000n,
      );
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(
        5000000000000000000n,
      );
    });

    it("should handle different token decimals correctly", () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n, // USDC-like token
      };

      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        tokenWithDifferentDecimals,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).toBeDefined();
    });

    it("should handle zero amounts correctly", () => {
      const eventWithZeroAmounts: CLPool_CollectFees_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 0n,
          amount1: 0n,
        },
      };

      const result = processCLPoolCollectFees(
        eventWithZeroAmounts,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff.totalStakedFeesCollected0).toBe(0n);
      expect(result.liquidityPoolDiff.totalStakedFeesCollected1).toBe(0n);
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(0n);
    });

    it("should use refreshed token prices for USD calculations", () => {
      // Test that when prices change, USD calculations reflect the new prices
      const token0WithNewPrice: Token = {
        ...mockToken0,
        pricePerUSDNew: 1500000000000000000n, // $1.50 (was $1.00)
      };

      const token1WithNewPrice: Token = {
        ...mockToken1,
        pricePerUSDNew: 2500000000000000000n, // $2.50 (was $2.00)
      };

      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        token0WithNewPrice,
        token1WithNewPrice,
      );

      // USD calculation with new prices:
      // amount0: 1 token * $1.50 = $1.50
      // amount1: 2 tokens * $2.50 = $5.00
      // Total: $6.50
      const expectedUSD = 6500000000000000000n;
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(
        expectedUSD,
      );

      // Verify the calculation uses the new prices, not old ones
      // If it used old prices ($1.00 and $2.00), it would be $5.00
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).not.toBe(
        5000000000000000000n,
      );
    });

    it("should correctly calculate USD when one token price is zero", () => {
      const token0WithZeroPrice: Token = {
        ...mockToken0,
        pricePerUSDNew: 0n,
      };

      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        token0WithZeroPrice,
        mockToken1,
      );

      // Only token1 contributes to USD (token0 has 0 price)
      // amount1: 2 tokens * $2.00 = $4.00
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(
        4000000000000000000n,
      );
    });

    it("should handle undefined token0Instance correctly", () => {
      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        mockToken1,
      );

      // Fees are still tracked even when token instance is undefined
      expect(result.liquidityPoolDiff.totalStakedFeesCollected0).toBe(
        1000000000000000000n,
      );
      expect(result.liquidityPoolDiff.totalStakedFeesCollected1).toBe(
        2000000000000000000n,
      );
      // USD should only include token1 (token0 has no instance to calculate price)
      // token1: 2 tokens * $2.00 = $4.00
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(
        4000000000000000000n,
      );
      // Whitelisted fees should not include token0 (undefined), only token1 if whitelisted
      // Since mockToken1.isWhitelisted is false, whitelisted fees should be 0
      expect(result.liquidityPoolDiff.totalFeesUSDWhitelisted).toBe(0n);
    });

    it("should handle undefined token1Instance correctly", () => {
      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        undefined,
      );

      // Fees are still tracked even when token instance is undefined
      expect(result.liquidityPoolDiff.totalStakedFeesCollected0).toBe(
        1000000000000000000n,
      );
      expect(result.liquidityPoolDiff.totalStakedFeesCollected1).toBe(
        2000000000000000000n,
      );
      // USD should only include token0 (token1 has no instance to calculate price)
      // token0: 1 token * $1.00 = $1.00
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(
        1000000000000000000n,
      );
      // Whitelisted fees should not include token1 (undefined), only token0 if whitelisted
      // Since mockToken0.isWhitelisted is false, whitelisted fees should be 0
      expect(result.liquidityPoolDiff.totalFeesUSDWhitelisted).toBe(0n);
    });

    it("should handle both tokens undefined", () => {
      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        undefined,
      );

      // Fees should still be tracked
      expect(result.liquidityPoolDiff.totalStakedFeesCollected0).toBe(
        1000000000000000000n,
      );
      expect(result.liquidityPoolDiff.totalStakedFeesCollected1).toBe(
        2000000000000000000n,
      );
      // USD should be 0 since no tokens to calculate price
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(0n);
      // Whitelisted fees should be 0
      expect(result.liquidityPoolDiff.totalFeesUSDWhitelisted).toBe(0n);
    });

    it("should add to whitelisted fees when token0 is whitelisted", () => {
      const whitelistedToken0: Token = {
        ...mockToken0,
        isWhitelisted: true,
        pricePerUSDNew: 1000000000000000000n, // $1.00
      };

      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        whitelistedToken0,
        mockToken1,
      );

      // Total fees USD should include both tokens
      // token0: 1 token * $1.00 = $1.00, token1: 2 tokens * $2.00 = $4.00
      // Total: $5.00
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(
        5000000000000000000n,
      );
      // Whitelisted fees should include token0 fees (1 token * $1.00 = $1.00)
      expect(result.liquidityPoolDiff.totalFeesUSDWhitelisted).toBe(
        1000000000000000000n,
      );
    });

    it("should add to whitelisted fees when token1 is whitelisted", () => {
      const whitelistedToken1: Token = {
        ...mockToken1,
        isWhitelisted: true,
        pricePerUSDNew: 2000000000000000000n, // $2.00
      };

      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        whitelistedToken1,
      );

      // Total fees USD should include both tokens
      // token0: 1 token * $1.00 = $1.00, token1: 2 tokens * $2.00 = $4.00
      // Total: $5.00
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(
        5000000000000000000n,
      );
      // Whitelisted fees should include token1 fees (2 tokens * $2.00 = $4.00)
      expect(result.liquidityPoolDiff.totalFeesUSDWhitelisted).toBe(
        4000000000000000000n,
      );
    });

    it("should add to whitelisted fees when both tokens are whitelisted", () => {
      const whitelistedToken0: Token = {
        ...mockToken0,
        isWhitelisted: true,
        pricePerUSDNew: 1000000000000000000n, // $1.00
      };

      const whitelistedToken1: Token = {
        ...mockToken1,
        isWhitelisted: true,
        pricePerUSDNew: 2000000000000000000n, // $2.00
      };

      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        whitelistedToken0,
        whitelistedToken1,
      );

      // Total fees USD should include both tokens
      // token0: 1 token * $1.00 = $1.00, token1: 2 tokens * $2.00 = $4.00
      // Total: $5.00
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(
        5000000000000000000n,
      );
      // Whitelisted fees should include both: token0 (1 * $1.00 = $1.00) + token1 (2 * $2.00 = $4.00) = $5.00
      expect(result.liquidityPoolDiff.totalFeesUSDWhitelisted).toBe(
        5000000000000000000n,
      );
      // Whitelisted fees should equal total fees when both are whitelisted
      expect(result.liquidityPoolDiff.totalFeesUSDWhitelisted).toBe(
        result.liquidityPoolDiff.totalStakedFeesCollectedUSD,
      );
    });

    it("should not add to whitelisted fees when tokens are not whitelisted", () => {
      const nonWhitelistedToken0: Token = {
        ...mockToken0,
        isWhitelisted: false,
      };

      const nonWhitelistedToken1: Token = {
        ...mockToken1,
        isWhitelisted: false,
      };

      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        nonWhitelistedToken0,
        nonWhitelistedToken1,
      );

      // Total fees USD should still be calculated
      // token0: 1 token * $1.00 = $1.00, token1: 2 tokens * $2.00 = $4.00
      // Total: $5.00
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(
        5000000000000000000n,
      );
      // Whitelisted fees should be 0 when neither token is whitelisted
      expect(result.liquidityPoolDiff.totalFeesUSDWhitelisted).toBe(0n);
    });

    it("should only track staked fees, not unstaked fees", () => {
      const result = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      // CollectFees events should only update staked fees
      expect(result.liquidityPoolDiff.totalStakedFeesCollected0).toBe(
        1000000000000000000n,
      );
      expect(result.liquidityPoolDiff.totalStakedFeesCollected1).toBe(
        2000000000000000000n,
      );
      expect(result.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(
        5000000000000000000n,
      );

      // Unstaked fees should not be present in the diff (they're undefined, not 0)
      // The aggregator will handle the addition, but the diff only contains staked fees
      expect(result.liquidityPoolDiff).not.toHaveProperty(
        "totalUnstakedFeesCollected0",
      );
      expect(result.liquidityPoolDiff).not.toHaveProperty(
        "totalUnstakedFeesCollected1",
      );
      expect(result.liquidityPoolDiff).not.toHaveProperty(
        "totalUnstakedFeesCollectedUSD",
      );
    });

    it("should correctly accumulate staked fees from multiple events", () => {
      // First event
      const result1 = processCLPoolCollectFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      // Create aggregator with first event's fees
      const aggregatorAfterFirst: LiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        totalStakedFeesCollected0:
          result1.liquidityPoolDiff.totalStakedFeesCollected0,
        totalStakedFeesCollected1:
          result1.liquidityPoolDiff.totalStakedFeesCollected1,
        totalStakedFeesCollectedUSD:
          result1.liquidityPoolDiff.totalStakedFeesCollectedUSD,
      };

      // Second event with same amounts
      const result2 = processCLPoolCollectFees(
        mockEvent,
        aggregatorAfterFirst,
        mockToken0,
        mockToken1,
      );

      // Should accumulate: 1 + 1 = 2 tokens for token0, 2 + 2 = 4 tokens for token1
      expect(result2.liquidityPoolDiff.totalStakedFeesCollected0).toBe(
        2000000000000000000n,
      );
      expect(result2.liquidityPoolDiff.totalStakedFeesCollected1).toBe(
        4000000000000000000n,
      );
      // USD: 5 + 5 = 10
      expect(result2.liquidityPoolDiff.totalStakedFeesCollectedUSD).toBe(
        10000000000000000000n,
      );
    });
  });
});
