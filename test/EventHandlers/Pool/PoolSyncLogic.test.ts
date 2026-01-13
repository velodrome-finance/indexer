import type {
  LiquidityPoolAggregator,
  Pool_Sync_event,
  Token,
  handlerContext,
} from "generated";
import { processPoolSync } from "../../../src/EventHandlers/Pool/PoolSyncLogic";
import { setupCommon } from "./common";

describe("PoolSyncLogic", () => {
  const { mockLiquidityPoolData } = setupCommon();

  const mockEvent: Pool_Sync_event = {
    chainId: 10,
    block: {
      number: 123456,
      timestamp: 1000000,
      hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
    },
    logIndex: 1,
    srcAddress: "0x3333333333333333333333333333333333333333",
    transaction: {
      hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
    },
    params: {
      reserve0: 1000n,
      reserve1: 2000n,
    },
  };

  const mockLiquidityPoolAggregator = {
    ...mockLiquidityPoolData,
    reserve0: 500n,
    reserve1: 1000n,
    totalLiquidityUSD: 2000n,
    token0Price: 1000000000000000000n, // 1 USD
    token1Price: 2000000000000000000n, // 2 USD
    numberOfSwaps: 10n,
    totalVolume0: 5000n,
    totalVolume1: 10000n,
    totalVolumeUSD: 15000n,
    totalVolumeUSDWhitelisted: 12000n,
    totalUnstakedFeesCollected0: 100n,
    totalUnstakedFeesCollected1: 200n,
    totalUnstakedFeesCollectedUSD: 300n,
    totalFeesUSDWhitelisted: 250n,
    totalEmissions: 1000n,
    totalEmissionsUSD: 2000n,
    totalVotesDeposited: 5000n,
    totalVotesDepositedUSD: 10000n,
    gaugeAddress: "0x4444444444444444444444444444444444444444",
    gaugeIsAlive: true,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  } as LiquidityPoolAggregator;

  const mockToken0 = {
    id: "0x2222222222222222222222222222222222222222",
    address: "0x2222222222222222222222222222222222222222",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD
    isWhitelisted: true,
    chainId: 10,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  } as Token;

  const mockToken1 = {
    id: "0x3333333333333333333333333333333333333333",
    address: "0x3333333333333333333333333333333333333333",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18n,
    pricePerUSDNew: 2000000000000000000n, // 2 USD
    isWhitelisted: true,
    chainId: 10,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  } as Token;

  const mockContext = {
    log: {
      error: () => {},
      warn: () => {},
      info: () => {},
    },
  } as unknown as handlerContext;

  describe("processPoolSync", () => {
    it("should create entity and calculate sync updates for successful sync", async () => {
      const result = processPoolSync(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).toBeDefined();

      expect(result.liquidityPoolDiff).toMatchObject({
        incrementalReserve0: 500n, // 1000n - 500n (incremental change)
        incrementalReserve1: 1000n, // 2000n - 1000n (incremental change)
        token0Price: 1000000000000000000n,
        token1Price: 2000000000000000000n,
      });
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });

    it("should calculate total liquidity USD correctly with both tokens", async () => {
      const result = processPoolSync(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      // Current total: 2000n, New total: 1000000000004000n, Incremental change: 1000000000002000n
      expect(result.liquidityPoolDiff?.incrementalCurrentLiquidityUSD).toBe(
        1000000000002000n,
      );
    });

    it("should calculate total liquidity USD correctly with only token0", async () => {
      const result = processPoolSync(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        undefined,
      );

      // Current: 2000n, New: 1000000000000000n, Incremental change: 999999999998000n
      expect(result.liquidityPoolDiff?.incrementalCurrentLiquidityUSD).toBe(
        999999999998000n,
      );
    });

    it("should calculate total liquidity USD correctly with only token1", async () => {
      const result = processPoolSync(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        mockToken1,
      );

      // Current: 1000 * 10^0 * 2 USD = 2000n
      // New: 2000 * 10^0 * 2 USD = 4000n
      // Incremental change: 4000n - 2000n = 2000n
      expect(result.liquidityPoolDiff?.incrementalCurrentLiquidityUSD).toBe(
        2000n,
      );
    });

    it("should use existing incrementalCurrentLiquidityUSD when no tokens are available", async () => {
      const result = processPoolSync(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        undefined,
      );

      // No tokens available: keep existing values (no change)
      expect(result.liquidityPoolDiff?.incrementalCurrentLiquidityUSD).toBe(0n);
    });

    it("should handle different token decimals correctly", async () => {
      const mockToken0WithDifferentDecimals = {
        ...mockToken0,
        decimals: 8n, // Different decimals
      };

      const result = processPoolSync(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0WithDifferentDecimals,
        mockToken1,
      );

      // Current: 2000n, New: 10000000004000n, Incremental change: 10000000002000n
      expect(result.liquidityPoolDiff?.incrementalCurrentLiquidityUSD).toBe(
        10000000002000n,
      );
    });

    it("should handle zero amounts correctly", async () => {
      const mockEventWithZeroAmounts: Pool_Sync_event = {
        ...mockEvent,
        params: {
          reserve0: 0n,
          reserve1: 0n,
        },
      };

      const result = processPoolSync(
        mockEventWithZeroAmounts,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).toMatchObject({
        incrementalReserve0: -500n, // Set to zero: subtract current reserves
        incrementalReserve1: -1000n, // Set to zero: subtract current reserves
      });
      // Zero amounts: set reserves to zero (snapshot behavior)
      // This means subtracting current reserves to get to zero
      expect(result.liquidityPoolDiff?.incrementalCurrentLiquidityUSD).toBe(
        -2000n,
      );
    });

    it("should handle missing token instances gracefully", async () => {
      const result = processPoolSync(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        undefined,
      );

      expect(result.liquidityPoolDiff).toBeDefined();

      // Should use existing prices from aggregator
      expect(result.liquidityPoolDiff).toMatchObject({
        token0Price: mockLiquidityPoolAggregator.token0Price,
        token1Price: mockLiquidityPoolAggregator.token1Price,
      });
    });

    it("should update token prices correctly", async () => {
      const mockToken0WithNewPrice = {
        ...mockToken0,
        pricePerUSDNew: 1500000000000000000n, // 1.5 USD
      };

      const mockToken1WithNewPrice = {
        ...mockToken1,
        pricePerUSDNew: 2500000000000000000n, // 2.5 USD
      };

      const result = processPoolSync(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0WithNewPrice,
        mockToken1WithNewPrice,
      );

      expect(result.liquidityPoolDiff).toMatchObject({
        token0Price: 1500000000000000000n,
        token1Price: 2500000000000000000n,
      });
    });
  });
});
