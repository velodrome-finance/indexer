import { Pool } from "../../../generated/src/TestHelpers.gen";
import { MockDb } from "../../../generated/src/TestHelpers.gen";
import * as PoolBurnAndMintLogic from "../../../src/EventHandlers/Pool/PoolBurnAndMintLogic";
import { setupCommon } from "./common";

describe("Pool Burn Event", () => {
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let commonData: ReturnType<typeof setupCommon>;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
    commonData = setupCommon();

    // Set up mock database with common data
    const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
      commonData.mockLiquidityPoolData,
    );
    const updatedDB2 = updatedDB1.entities.Token.set(commonData.mockToken0Data);
    mockDb = updatedDB2.entities.Token.set(commonData.mockToken1Data);
  });

  it("should process burn event and update liquidity pool aggregator", async () => {
    const mockEvent = Pool.Burn.createMockEvent({
      sender: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      amount0: 500n * 10n ** 18n,
      amount1: 1000n * 10n ** 18n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: commonData.mockLiquidityPoolData.id,
      },
    });

    const result = await Pool.Burn.processEvent({ event: mockEvent, mockDb });

    // Verify that the liquidity pool aggregator was updated
    const updatedAggregator = result.entities.LiquidityPoolAggregator.get(
      commonData.mockLiquidityPoolData.id,
    );
    expect(updatedAggregator).toBeDefined();
    expect(updatedAggregator?.lastUpdatedTimestamp).toEqual(
      new Date(1000000 * 1000),
    );

    // Verify that reserves decreased (burn removes liquidity)
    const initialReserve0 = commonData.mockLiquidityPoolData.reserve0;
    const initialReserve1 = commonData.mockLiquidityPoolData.reserve1;
    const burnAmount0 = 500n * 10n ** 18n;
    const burnAmount1 = 1000n * 10n ** 18n;
    expect(updatedAggregator?.reserve0).toBe(initialReserve0 - burnAmount0);
    expect(updatedAggregator?.reserve1).toBe(initialReserve1 - burnAmount1);

    // Verify that user stats were updated with negative liquidity (burn removes liquidity)
    const userStats = result.entities.UserStatsPerPool.get(
      `0x1111111111111111111111111111111111111111_${commonData.mockLiquidityPoolData.id}_10`,
    );
    expect(userStats).toBeDefined();
    if (userStats) {
      // For burn events, currentLiquidityToken0/1 should be negative (subtracted)
      // The amounts are: amount0 = 500n * 10n ** 18n, amount1 = 1000n * 10n ** 18n
      expect(userStats.currentLiquidityToken0).toBeLessThan(0n);
      expect(userStats.currentLiquidityToken1).toBeLessThan(0n);
      expect(userStats.currentLiquidityUSD).toBeLessThan(0n);
    }
  });

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      // Create a fresh mockDb without the pool
      const freshMockDb = MockDb.createMockDb();
      const updatedDB1 = freshMockDb.entities.Token.set(
        commonData.mockToken0Data,
      );
      const updatedDB2 = updatedDB1.entities.Token.set(
        commonData.mockToken1Data,
      );
      // Note: We intentionally don't set the LiquidityPoolAggregator

      const mockEvent = Pool.Burn.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        amount0: 500n * 10n ** 18n,
        amount1: 1000n * 10n ** 18n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 1,
          srcAddress: commonData.mockLiquidityPoolData.id,
        },
      });

      const postEventDB = await Pool.Burn.processEvent({
        event: mockEvent,
        mockDb: updatedDB2,
      });

      // Pool should not exist
      const pool = postEventDB.entities.LiquidityPoolAggregator.get(
        commonData.mockLiquidityPoolData.id,
      );
      expect(pool).toBeUndefined();

      // User stats will still be created because loadOrCreateUserData is called in parallel
      // but they should have default/zero values since no burn processing occurred
      const userStats = postEventDB.entities.UserStatsPerPool.get(
        `0x1111111111111111111111111111111111111111_${commonData.mockLiquidityPoolData.id}_10`,
      );
      expect(userStats).toBeDefined();
      // Verify no liquidity activity was recorded
      expect(userStats?.currentLiquidityToken0).toBe(0n);
      expect(userStats?.currentLiquidityToken1).toBe(0n);
      expect(userStats?.currentLiquidityUSD).toBe(0n);
    });
  });

  describe("when userLiquidityDiff is undefined", () => {
    it("should handle undefined userLiquidityDiff gracefully", async () => {
      // Mock processPoolLiquidityEvent to return undefined userLiquidityDiff
      const processSpy = jest
        .spyOn(PoolBurnAndMintLogic, "processPoolLiquidityEvent")
        .mockReturnValue({
          liquidityPoolDiff: {
            incrementalReserve0: -500n * 10n ** 18n,
            incrementalReserve1: -1000n * 10n ** 18n,
            incrementalCurrentLiquidityUSD: -1500n * 10n ** 18n,
            token0Price: 1000000000000000000n,
            token1Price: 1000000000000000000n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userLiquidityDiff: undefined, // Test the undefined branch
        });

      const mockEvent = Pool.Burn.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        amount0: 500n * 10n ** 18n,
        amount1: 1000n * 10n ** 18n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 1,
          srcAddress: commonData.mockLiquidityPoolData.id,
        },
      });

      const result = await Pool.Burn.processEvent({ event: mockEvent, mockDb });

      // Pool should still be updated
      const updatedAggregator = result.entities.LiquidityPoolAggregator.get(
        commonData.mockLiquidityPoolData.id,
      );
      expect(updatedAggregator).toBeDefined();
      expect(updatedAggregator?.reserve0).toBe(
        commonData.mockLiquidityPoolData.reserve0 - 500n * 10n ** 18n,
      );

      // User stats should still be created (from loadOrCreateUserData) but not updated
      const userStats = result.entities.UserStatsPerPool.get(
        `0x1111111111111111111111111111111111111111_${commonData.mockLiquidityPoolData.id}_10`,
      );
      expect(userStats).toBeDefined();
      // Should have default values since userLiquidityDiff was undefined
      expect(userStats?.currentLiquidityToken0).toBe(0n);
      expect(userStats?.currentLiquidityToken1).toBe(0n);

      processSpy.mockRestore();
    });
  });
});
