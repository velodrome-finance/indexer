import type {
  LiquidityPoolAggregator,
  Pool_Sync_event,
  Token,
  handlerContext,
} from "generated";
import { toChecksumAddress } from "../../../src/Constants";
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
    srcAddress: toChecksumAddress("0x3333333333333333333333333333333333333333"),
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
    gaugeAddress: toChecksumAddress(
      "0x4444444444444444444444444444444444444444",
    ),
    gaugeIsAlive: true,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  } as LiquidityPoolAggregator;

  const mockToken0 = {
    id: toChecksumAddress("0x2222222222222222222222222222222222222222"),
    address: toChecksumAddress("0x2222222222222222222222222222222222222222"),
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD
    isWhitelisted: true,
    chainId: 10,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  } as Token;

  const mockToken1 = {
    id: toChecksumAddress("0x3333333333333333333333333333333333333333"),
    address: toChecksumAddress("0x3333333333333333333333333333333333333333"),
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
    it("should create entity and calculate sync updates for successful sync", () => {
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

    it("should calculate total liquidity USD correctly with both tokens", () => {
      const result = processPoolSync(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff?.currentTotalLiquidityUSD).toBe(
        1000000000004000n,
      );
    });

    it("should calculate total liquidity USD correctly with only token0", () => {
      const result = processPoolSync(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        undefined,
      );

      expect(result.liquidityPoolDiff?.currentTotalLiquidityUSD).toBe(
        1000000000000000n,
      );
    });

    it("should calculate total liquidity USD correctly with only token1", () => {
      const result = processPoolSync(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        mockToken1,
      );

      expect(result.liquidityPoolDiff?.currentTotalLiquidityUSD).toBe(4000n);
    });

    it("should leave totalLiquidityUSD unchanged when no tokens are available", () => {
      const result = processPoolSync(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        undefined,
      );

      // No tokens available: keep existing values (no change)
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBeUndefined();
    });

    it("should handle different token decimals correctly", () => {
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

      expect(result.liquidityPoolDiff?.currentTotalLiquidityUSD).toBe(
        10000000004000n,
      );
    });

    it("should handle zero amounts correctly", () => {
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
      expect(result.liquidityPoolDiff?.currentTotalLiquidityUSD).toBe(0n);
    });

    it("should handle missing token instances gracefully", () => {
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

    it("should update token prices correctly", () => {
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
