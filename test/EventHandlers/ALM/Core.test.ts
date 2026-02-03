import { ALMCore, MockDb } from "../../../generated/src/TestHelpers.gen";
import type { ALM_LP_Wrapper } from "../../../generated/src/Types.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("ALMCore Rebalance Event", () => {
  const { mockALMLPWrapperData, mockLiquidityPoolData } = setupCommon();
  const chainId = mockLiquidityPoolData.chainId;
  const poolAddress = mockLiquidityPoolData.poolAddress;
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

      // Pre-populate with existing wrapper
      const wrapperId = mockALMLPWrapperData.id;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set(mockALMLPWrapperData);

      // Track entities for getWhere query
      const storedEntities = [mockALMLPWrapperData];

      // Extend mockDb to include getWhere for ALM_LP_Wrapper
      const mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          ALM_LP_Wrapper: {
            ...mockDb.entities.ALM_LP_Wrapper,
            getWhere: {
              pool: {
                eq: async (poolAddr: string) => {
                  return storedEntities.filter(
                    (entity) => entity.pool === toChecksumAddress(poolAddr),
                  );
                },
              },
            },
          },
        },
      };

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
      expect(updatedWrapper?.amount0).toBe(newAmount0);
      expect(updatedWrapper?.amount1).toBe(newAmount1);
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

      // Extend mockDb to include getWhere (returning empty array)
      const mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          ALM_LP_Wrapper: {
            ...mockDb.entities.ALM_LP_Wrapper,
            getWhere: {
              pool: {
                eq: async (_poolAddr: string) => {
                  return []; // No entities found
                },
              },
            },
          },
        },
      };

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
        id: `${toChecksumAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")}_${chainId}`,
      };

      const wrapper2: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        id: `${toChecksumAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")}_${chainId}`,
      };

      mockDb = mockDb.entities.ALM_LP_Wrapper.set(wrapper1);
      mockDb = mockDb.entities.ALM_LP_Wrapper.set(wrapper2);

      // Track entities for getWhere query
      const storedEntities = [wrapper1, wrapper2];

      // Extend mockDb to include getWhere
      const mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          ALM_LP_Wrapper: {
            ...mockDb.entities.ALM_LP_Wrapper,
            getWhere: {
              pool: {
                eq: async (poolAddr: string) => {
                  return storedEntities.filter(
                    (entity) => entity.pool === toChecksumAddress(poolAddr),
                  );
                },
              },
            },
          },
        },
      };

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
  });
});
