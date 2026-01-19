import { Pool } from "../../../generated/src/TestHelpers.gen";
import { processPoolLiquidityEvent } from "../../../src/EventHandlers/Pool/PoolBurnAndMintLogic";
import { setupCommon } from "./common";

describe("processPoolLiquidityEvent", () => {
  const commonData = setupCommon();

  describe("Mint events", () => {
    it("should return liquidity pool diff with correct timestamp", async () => {
      const mockEvent = Pool.Mint.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        amount0: 1000n * 10n ** 18n,
        amount1: 2000n * 10n ** 18n,
        mockEventData: {
          block: { timestamp: 1000000, number: 123456, hash: "0x123" },
          chainId: 10,
          logIndex: 1,
          srcAddress: commonData.mockLiquidityPoolData.id,
        },
      });

      const result = processPoolLiquidityEvent(
        mockEvent,
        commonData.mockToken0Data,
        commonData.mockToken1Data,
        mockEvent.params.amount0,
        mockEvent.params.amount1,
      );

      // Verify the function returns the expected structure
      expect(result).toHaveProperty("liquidityPoolDiff");
      expect(result.liquidityPoolDiff).toBeDefined();

      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
      // These values should match what updateReserveTokenData returns
      expect(result.liquidityPoolDiff?.token0Price).toBe(1000000000000000000n);
      expect(result.liquidityPoolDiff?.token1Price).toBe(1000000000000000000n);
      expect(result.liquidityPoolDiff?.incrementalCurrentLiquidityUSD).toBe(
        2000000000001000000000000000000000n,
      );
    });

    it("should return positive user liquidity diff for mint events", async () => {
      const amount0 = 1000n * 10n ** 18n;
      const amount1 = 2000n * 10n ** 18n;

      const mockEvent = Pool.Mint.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        amount0,
        amount1,
        mockEventData: {
          block: { timestamp: 1000000, number: 123456, hash: "0x123" },
          chainId: 10,
          logIndex: 1,
          srcAddress: commonData.mockLiquidityPoolData.id,
        },
      });

      const result = processPoolLiquidityEvent(
        mockEvent,
        commonData.mockToken0Data,
        commonData.mockToken1Data,
        mockEvent.params.amount0,
        mockEvent.params.amount1,
      );

      // For mint events, user liquidity should be positive (adding liquidity)
      expect(result.userLiquidityDiff).toBeDefined();
      expect(result.userLiquidityDiff?.incrementalCurrentLiquidityToken0).toBe(
        amount0,
      );
      expect(result.userLiquidityDiff?.incrementalCurrentLiquidityToken1).toBe(
        amount1,
      );
      expect(
        result.userLiquidityDiff?.incrementalCurrentLiquidityUSD,
      ).toBeGreaterThan(0n);
      // For mint events, incrementalTotalLiquidityAddedUSD should be set
      expect(
        result.userLiquidityDiff?.incrementalTotalLiquidityAddedUSD,
      ).toBeDefined();
      expect(
        result.userLiquidityDiff?.incrementalTotalLiquidityAddedUSD,
      ).toBeGreaterThan(0n);
      // For mint events, incrementalTotalLiquidityRemovedUSD should be 0n
      expect(
        result.userLiquidityDiff?.incrementalTotalLiquidityRemovedUSD,
      ).toBe(0n);
      expect(result.userLiquidityDiff?.lastActivityTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });
  });

  describe("Burn events", () => {
    it("should return negative user liquidity diff for burn events", async () => {
      const amount0 = 500n * 10n ** 18n;
      const amount1 = 1000n * 10n ** 18n;

      const mockEvent = Pool.Burn.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        amount0,
        amount1,
        mockEventData: {
          block: { timestamp: 1000000, number: 123456, hash: "0x123" },
          chainId: 10,
          logIndex: 1,
          srcAddress: commonData.mockLiquidityPoolData.id,
        },
      });

      const result = processPoolLiquidityEvent(
        mockEvent,
        commonData.mockToken0Data,
        commonData.mockToken1Data,
        mockEvent.params.amount0,
        mockEvent.params.amount1,
      );

      // For burn events, user liquidity should be negative (removing liquidity)
      expect(result.userLiquidityDiff).toBeDefined();
      expect(result.userLiquidityDiff?.incrementalCurrentLiquidityToken0).toBe(
        -amount0,
      );
      expect(result.userLiquidityDiff?.incrementalCurrentLiquidityToken1).toBe(
        -amount1,
      );
      expect(
        result.userLiquidityDiff?.incrementalCurrentLiquidityUSD,
      ).toBeLessThan(0n);
      // For burn events, incrementalTotalLiquidityRemovedUSD should be set
      expect(
        result.userLiquidityDiff?.incrementalTotalLiquidityRemovedUSD,
      ).toBeDefined();
      expect(
        result.userLiquidityDiff?.incrementalTotalLiquidityRemovedUSD,
      ).toBeGreaterThan(0n);
      // For burn events, incrementalTotalLiquidityAddedUSD should be 0n
      expect(result.userLiquidityDiff?.incrementalTotalLiquidityAddedUSD).toBe(
        0n,
      );
      expect(result.userLiquidityDiff?.lastActivityTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });
  });

  describe("Token price handling", () => {
    const createMintEvent = () =>
      Pool.Mint.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        amount0: 1000n * 10n ** 18n,
        amount1: 2000n * 10n ** 18n,
        mockEventData: {
          block: { timestamp: 1000000, number: 123456, hash: "0x123" },
          chainId: 10,
          logIndex: 1,
          srcAddress: commonData.mockLiquidityPoolData.id,
        },
      });

    it("should use token prices directly from token instances", () => {
      const mockEvent = createMintEvent();

      // Create tokens with specific prices
      const token0WithPrice = {
        ...commonData.mockToken0Data,
        pricePerUSDNew: 2000000000000000000n, // 2 USD
      };
      const token1WithPrice = {
        ...commonData.mockToken1Data,
        pricePerUSDNew: 3000000000000000000n, // 3 USD
      };

      const result = processPoolLiquidityEvent(
        mockEvent,
        token0WithPrice,
        token1WithPrice,
        mockEvent.params.amount0,
        mockEvent.params.amount1,
      );

      // Should use prices directly from token instances (not from aggregator)
      expect(result.liquidityPoolDiff?.token0Price).toBe(2000000000000000000n);
      expect(result.liquidityPoolDiff?.token1Price).toBe(3000000000000000000n);
    });

    it("should calculate zero liquidity USD when amounts are zero", () => {
      const mockEvent = createMintEvent();

      // Test with zero amounts - should result in 0n liquidity USD
      const result = processPoolLiquidityEvent(
        mockEvent,
        commonData.mockToken0Data,
        commonData.mockToken1Data,
        0n, // amount0 = 0
        0n, // amount1 = 0
      );

      // When amounts are zero, liquidity USD should be 0n
      expect(result.liquidityPoolDiff?.incrementalCurrentLiquidityUSD).toBe(0n);
      expect(result.userLiquidityDiff?.incrementalCurrentLiquidityUSD).toBe(0n);
    });
  });
});
