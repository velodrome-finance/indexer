import { ALMCore, MockDb } from "../../../generated/src/TestHelpers.gen";
import type {
  ALM_LP_Wrapper,
  UserStatsPerPool,
} from "../../../generated/src/Types.gen";
import { ALMLPWrapperId, toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

type MockDbInstance = ReturnType<typeof MockDb.createMockDb>;

/** Extends mockDb with getWhere for ALM_LP_Wrapper (and optionally UserStatsPerPool) so processEvent can query by pool / poolAddress. */
function extendMockDbWithGetWhere(
  mockDb: MockDbInstance,
  options: {
    wrappers: ALM_LP_Wrapper[];
    userStatsPerPool?: UserStatsPerPool[];
  },
): MockDbInstance {
  const { wrappers, userStatsPerPool } = options;
  const entities = {
    ...mockDb.entities,
    ALM_LP_Wrapper: {
      ...mockDb.entities.ALM_LP_Wrapper,
      getWhere: {
        pool: {
          eq: async (poolAddr: string) =>
            wrappers.filter((e) => e.pool === toChecksumAddress(poolAddr)),
        },
      },
    },
    ...(userStatsPerPool !== undefined
      ? {
          UserStatsPerPool: {
            ...mockDb.entities.UserStatsPerPool,
            getWhere: {
              poolAddress: {
                eq: async (addr: string) =>
                  userStatsPerPool.filter(
                    (u) => u.poolAddress.toLowerCase() === addr.toLowerCase(),
                  ),
              },
            },
          },
        }
      : {}),
  };
  return { ...mockDb, entities } as MockDbInstance;
}

describe("ALMCore Rebalance Event", () => {
  const {
    mockALMLPWrapperData,
    mockLiquidityPoolData,
    createMockUserStatsPerPool,
  } = setupCommon();
  const chainId = mockLiquidityPoolData.chainId;
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const wrapperAddress = mockALMLPWrapperData.id.split("_")[0];
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const blockTimestamp = 1000000;
  const blockNumber = 123456;

  const mockEventData = {
    block: {
      timestamp: blockTimestamp,
      number: blockNumber,
      hash: transactionHash,
    },
    chainId,
    logIndex: 1,
    transaction: {
      hash: transactionHash,
    },
  };

  describe("Rebalance event", () => {
    it("should update ALM_LP_Wrapper entity with new position state", async () => {
      let mockDb = MockDb.createMockDb();
      const wrapperId = mockALMLPWrapperData.id;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set(mockALMLPWrapperData);
      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, {
        wrappers: [mockALMLPWrapperData],
      });

      const newAmount0 = 800n * 10n ** 18n;
      const newAmount1 = 400n * 10n ** 6n;
      const newLiquidity = 2000000n;
      const newTokenId = 2n;
      const newTickLower = -1500n;
      const newTickUpper = 1500n;
      const newProperty = 3000n;
      const sqrtPriceX96 = 79228162514264337593543950336n; // sqrt(1) * 2^96

      const mockEvent = ALMCore.Rebalance.createMockEvent({
        rebalanceEventParams: [
          poolAddress,
          [
            mockALMLPWrapperData.token0,
            mockALMLPWrapperData.token1,
            newProperty,
            newTickLower,
            newTickUpper,
            newLiquidity,
          ],
          sqrtPriceX96,
          newAmount0,
          newAmount1,
          1n, // ammPositionIdBefore
          newTokenId, // ammPositionIdAfter
        ],
        mockEventData,
      });

      const result = await ALMCore.Rebalance.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      const updatedWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(updatedWrapper).toBeDefined();
      expect(updatedWrapper?.liquidity).toBe(newLiquidity);
      expect(updatedWrapper?.tokenId).toBe(newTokenId);
      expect(updatedWrapper?.tickLower).toBe(newTickLower);
      expect(updatedWrapper?.tickUpper).toBe(newTickUpper);
      expect(updatedWrapper?.property).toBe(newProperty);
      expect(updatedWrapper?.lastUpdatedTimestamp).toEqual(
        new Date(blockTimestamp * 1000),
      );

      // Verify wrapper-level lpAmount aggregation is preserved
      expect(updatedWrapper?.lpAmount).toBe(mockALMLPWrapperData.lpAmount);
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const mockDb = MockDb.createMockDb();
      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, {
        wrappers: [],
      });

      const mockEvent = ALMCore.Rebalance.createMockEvent({
        rebalanceEventParams: [
          poolAddress,
          [
            mockALMLPWrapperData.token0,
            mockALMLPWrapperData.token1,
            3000n,
            -1000n,
            1000n,
            1000000n,
          ],
          79228162514264337593543950336n,
          500n * 10n ** 18n,
          250n * 10n ** 6n,
          1n,
          2n,
        ],
        mockEventData,
      });

      const result = await ALMCore.Rebalance.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      // Verify that no wrapper was created or updated
      expect(Array.from(result.entities.ALM_LP_Wrapper.getAll())).toHaveLength(
        0,
      );
    });

    it("should handle multiple wrappers and update the first one", async () => {
      let mockDb = MockDb.createMockDb();

      // Create multiple wrappers with the same pool address
      const wrapper1: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        id: ALMLPWrapperId(
          chainId,
          toChecksumAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        ),
      };

      const wrapper2: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        id: ALMLPWrapperId(
          chainId,
          toChecksumAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        ),
      };

      mockDb = mockDb.entities.ALM_LP_Wrapper.set(wrapper1);
      mockDb = mockDb.entities.ALM_LP_Wrapper.set(wrapper2);
      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, {
        wrappers: [wrapper1, wrapper2],
      });

      const newTokenId = 3n;
      const mockEvent = ALMCore.Rebalance.createMockEvent({
        rebalanceEventParams: [
          poolAddress,
          [
            mockALMLPWrapperData.token0,
            mockALMLPWrapperData.token1,
            3000n,
            -1000n,
            1000n,
            1000000n,
          ],
          79228162514264337593543950336n,
          500n * 10n ** 18n,
          250n * 10n ** 6n,
          1n,
          newTokenId,
        ],
        mockEventData,
      });

      const result = await ALMCore.Rebalance.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      // Should update the first wrapper (wrapper1)
      const updatedWrapper1 = result.entities.ALM_LP_Wrapper.get(wrapper1.id);
      expect(updatedWrapper1?.tokenId).toBe(newTokenId);

      // Second wrapper should remain unchanged
      const unchangedWrapper2 = result.entities.ALM_LP_Wrapper.get(wrapper2.id);
      expect(unchangedWrapper2?.tokenId).toBe(wrapper2.tokenId);
    });

    it("should not update UserStatsPerPool on Rebalance (underlyings derived at snapshot time)", async () => {
      let mockDb = MockDb.createMockDb();
      mockDb = mockDb.entities.ALM_LP_Wrapper.set(mockALMLPWrapperData);

      const userAlmLpAmount = 1000n * 10n ** 18n;
      const userStats = createMockUserStatsPerPool({
        poolAddress,
        chainId,
        almAddress: wrapperAddress,
        almLpAmount: userAlmLpAmount,
      });
      mockDb = mockDb.entities.UserStatsPerPool.set(userStats);
      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, {
        wrappers: [mockALMLPWrapperData],
        userStatsPerPool: [userStats],
      });

      const mockEvent = ALMCore.Rebalance.createMockEvent({
        rebalanceEventParams: [
          poolAddress,
          [
            mockALMLPWrapperData.token0,
            mockALMLPWrapperData.token1,
            3000n,
            -1000n,
            1000n,
            1000000n,
          ],
          79228162514264337593543950336n,
          800n * 10n ** 18n,
          400n * 10n ** 6n,
          1n,
          2n,
        ],
        mockEventData,
      });

      const result = await ALMCore.Rebalance.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      const updatedWrapper = result.entities.ALM_LP_Wrapper.get(
        mockALMLPWrapperData.id,
      );
      expect(updatedWrapper?.liquidity).toBe(1000000n);
      expect(updatedWrapper?.tokenId).toBe(2n);

      // User stats unchanged (almAmount0/almAmount1 are derived at snapshot time, not stored)
      const updatedUser = result.entities.UserStatsPerPool.get(userStats.id);
      expect(updatedUser).toBeDefined();
      expect(updatedUser?.almLpAmount).toBe(userAlmLpAmount);
    });
  });
});
