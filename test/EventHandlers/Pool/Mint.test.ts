import { MockDb, Pool } from "../../../generated/src/TestHelpers.gen";
import * as PoolBurnAndMintLogic from "../../../src/EventHandlers/Pool/PoolBurnAndMintLogic";
import { setupCommon } from "./common";

describe("Pool Mint Event", () => {
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

  it("should process mint event and update liquidity pool aggregator", async () => {
    const mockEvent = Pool.Mint.createMockEvent({
      sender: "0x1111111111111111111111111111111111111111",
      amount0: 1000n * 10n ** 18n,
      amount1: 2000n * 10n ** 18n,
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

    const result = await Pool.Mint.processEvent({ event: mockEvent, mockDb });

    // Verify that the liquidity pool aggregator was updated
    const updatedAggregator = result.entities.LiquidityPoolAggregator.get(
      commonData.mockLiquidityPoolData.id,
    );
    expect(updatedAggregator).toBeDefined();
    expect(updatedAggregator?.lastUpdatedTimestamp).toEqual(
      new Date(1000000 * 1000),
    );

    // Verify that reserves increased (mint adds liquidity)
    const initialReserve0 = commonData.mockLiquidityPoolData.reserve0;
    const initialReserve1 = commonData.mockLiquidityPoolData.reserve1;
    const mintAmount0 = 1000n * 10n ** 18n;
    const mintAmount1 = 2000n * 10n ** 18n;
    expect(updatedAggregator?.reserve0).toBe(initialReserve0 + mintAmount0);
    expect(updatedAggregator?.reserve1).toBe(initialReserve1 + mintAmount1);

    // Verify that user stats were updated with positive liquidity (mint adds liquidity)
    const userStats = result.entities.UserStatsPerPool.get(
      `0x1111111111111111111111111111111111111111_${commonData.mockLiquidityPoolData.id}_10`,
    );
    expect(userStats).toBeDefined();
    if (userStats) {
      // For mint events, currentLiquidityToken0/1 should be positive (added)
      // The amounts are: amount0 = 1000n * 10n ** 18n, amount1 = 2000n * 10n ** 18n
      expect(userStats.currentLiquidityToken0).toBeGreaterThan(0n);
      expect(userStats.currentLiquidityToken1).toBeGreaterThan(0n);
      expect(userStats.currentLiquidityUSD).toBeGreaterThan(0n);
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

      const mockEvent = Pool.Mint.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        amount0: 1000n * 10n ** 18n,
        amount1: 2000n * 10n ** 18n,
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

      const postEventDB = await Pool.Mint.processEvent({
        event: mockEvent,
        mockDb: updatedDB2,
      });

      // Pool should not exist
      const pool = postEventDB.entities.LiquidityPoolAggregator.get(
        commonData.mockLiquidityPoolData.id,
      );
      expect(pool).toBeUndefined();

      // User stats will still be created because loadOrCreateUserData is called in parallel
      // but they should have default/zero values since no mint processing occurred
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
            incrementalReserve0: 1000n * 10n ** 18n,
            incrementalReserve1: 2000n * 10n ** 18n,
            incrementalCurrentLiquidityUSD: 3000n * 10n ** 18n,
            token0Price: 1000000000000000000n,
            token1Price: 1000000000000000000n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userLiquidityDiff: undefined, // Test the undefined branch
        });

      const mockEvent = Pool.Mint.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        amount0: 1000n * 10n ** 18n,
        amount1: 2000n * 10n ** 18n,
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

      const result = await Pool.Mint.processEvent({ event: mockEvent, mockDb });

      // Pool should still be updated
      const updatedAggregator = result.entities.LiquidityPoolAggregator.get(
        commonData.mockLiquidityPoolData.id,
      );
      expect(updatedAggregator).toBeDefined();
      expect(updatedAggregator?.reserve0).toBe(
        commonData.mockLiquidityPoolData.reserve0 + 1000n * 10n ** 18n,
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
