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
      sender: "0x2222222222222222222222222222222222222222",
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
        srcAddress: commonData.mockLiquidityPoolData.poolAddress,
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

    // Verify that reserves are NOT updated by Mint events
    // Only Sync events update reserves (they contain absolute values)
    expect(updatedAggregator?.reserve0).toBe(
      commonData.mockLiquidityPoolData.reserve0,
    );
    expect(updatedAggregator?.reserve1).toBe(
      commonData.mockLiquidityPoolData.reserve1,
    );
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
          srcAddress: commonData.mockLiquidityPoolData.poolAddress,
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

      // User stats will NOT be created when pool doesn't exist (early return)
      // and no transfer match is found
      const userStats = postEventDB.entities.UserStatsPerPool.get(
        `0x1111111111111111111111111111111111111111_${commonData.mockLiquidityPoolData.poolAddress}_10`,
      );
      expect(userStats).toBeUndefined();
    });
  });
});
