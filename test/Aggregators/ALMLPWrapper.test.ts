import type { ALM_LP_Wrapper, handlerContext } from "generated";
import { updateALMLPWrapper } from "../../src/Aggregators/ALMLPWrapper";
import { TEN_TO_THE_18_BI } from "../../src/Constants";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("ALMLPWrapper Aggregator", () => {
  const { mockALMLPWrapperData } = setupCommon();
  const timestamp = new Date(1000000 * 1000);

  let mockContext: Partial<handlerContext>;

  beforeEach(() => {
    mockContext = {
      ALM_LP_Wrapper: {
        set: jest.fn(),
        get: jest.fn(),
        getOrThrow: jest.fn(),
        getWhere: {
          pool: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
          strategyTransactionHash: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
          tokenId: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
        },
        getOrCreate: jest.fn(),
        deleteUnsafe: jest.fn(),
      },
      ALM_LP_WrapperSnapshot: {
        set: jest.fn(),
      } as unknown as handlerContext["ALM_LP_WrapperSnapshot"],
      log: {
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      },
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("updateALMLPWrapper", () => {
    describe("when updating with deposit diff (incrementalLpAmount)", () => {
      let result: ALM_LP_Wrapper;

      beforeEach(async () => {
        const depositDiff = {
          incrementalLpAmount: 500n * TEN_TO_THE_18_BI,
          liquidity: 1500000n,
        };

        await updateALMLPWrapper(
          depositDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;
      });

      it("should set liquidity directly and increment lpAmount", () => {
        expect(result.liquidity).toBe(1500000n);
        expect(result.lpAmount).toBe(2500n * TEN_TO_THE_18_BI); // 2000 + 500 (incremented)
      });

      it("should preserve other fields", () => {
        expect(result.id).toBe(mockALMLPWrapperData.id);
        expect(result.chainId).toBe(mockALMLPWrapperData.chainId);
        expect(result.pool).toBe(mockALMLPWrapperData.pool);
      });

      it("should update timestamp", () => {
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
      });
    });

    describe("when updating with withdraw diff (negative incrementalLpAmount)", () => {
      let result: ALM_LP_Wrapper;

      beforeEach(async () => {
        const withdrawDiff = {
          incrementalLpAmount: -500n * TEN_TO_THE_18_BI,
          liquidity: 500000n,
        };

        await updateALMLPWrapper(
          withdrawDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;
      });

      it("should set liquidity and decrement lpAmount", () => {
        expect(result.liquidity).toBe(500000n);
        expect(result.lpAmount).toBe(1500n * TEN_TO_THE_18_BI); // 2000 - 500 (decremented)
      });

      it("should update timestamp", () => {
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
      });
    });

    describe("when updating with partial diff", () => {
      it("should only update provided fields", async () => {
        const partialDiff = {
          liquidity: 2000000n,
        };

        await updateALMLPWrapper(
          partialDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.liquidity).toBe(2000000n);
        expect(result.lpAmount).toBe(2000n * TEN_TO_THE_18_BI); // unchanged
      });

      it("should handle zero incrementalLpAmount correctly", async () => {
        const zeroDiff = {
          incrementalLpAmount: 0n,
        };

        await updateALMLPWrapper(
          zeroDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.lpAmount).toBe(2000n * TEN_TO_THE_18_BI); // 2000 + 0 (unchanged)
      });
    });

    describe("when updating from zero state", () => {
      it("should handle deposit correctly", async () => {
        const emptyWrapper: ALM_LP_Wrapper = {
          ...mockALMLPWrapperData,
          lpAmount: 0n,
          liquidity: 0n,
        };

        const depositDiff = {
          incrementalLpAmount: 1000n * TEN_TO_THE_18_BI,
          liquidity: 500000n,
        };

        await updateALMLPWrapper(
          depositDiff,
          emptyWrapper,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.liquidity).toBe(500000n);
        expect(result.lpAmount).toBe(1000n * TEN_TO_THE_18_BI);
      });

      it("should handle withdraw correctly (negative lpAmount)", async () => {
        const emptyWrapper: ALM_LP_Wrapper = {
          ...mockALMLPWrapperData,
          lpAmount: 0n,
          liquidity: 0n,
        };

        const withdrawDiff = {
          incrementalLpAmount: -500n * TEN_TO_THE_18_BI,
          liquidity: 0n,
        };

        await updateALMLPWrapper(
          withdrawDiff,
          emptyWrapper,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.lpAmount).toBe(-500n * TEN_TO_THE_18_BI); // 0 - 500
      });
    });

    describe("when updating with undefined values", () => {
      it("should keep current liquidity and lpAmount when undefined", async () => {
        const diffWithUndefined = {
          liquidity: 2000000n,
          incrementalLpAmount: undefined,
        };

        await updateALMLPWrapper(
          diffWithUndefined,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.liquidity).toBe(2000000n);
        expect(result.lpAmount).toBe(2000n * TEN_TO_THE_18_BI); // unchanged (undefined means keep current)
      });

      it("should keep current liquidity when liquidity is undefined", async () => {
        const diffWithUndefinedLiquidity = {
          liquidity: undefined,
          incrementalLpAmount: 300n * TEN_TO_THE_18_BI,
        };

        await updateALMLPWrapper(
          diffWithUndefinedLiquidity,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.liquidity).toBe(mockALMLPWrapperData.liquidity); // unchanged
        expect(result.lpAmount).toBe(2300n * TEN_TO_THE_18_BI); // 2000 + 300 (incremented)
      });
    });

    describe("when updating with very large amounts", () => {
      it("should handle large BigInt values correctly", async () => {
        const largeDiff = {
          liquidity: BigInt("1000000000000000000000000"),
          incrementalLpAmount: BigInt("2000000000000000000000000"),
        };

        await updateALMLPWrapper(
          largeDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.liquidity).toBe(BigInt("1000000000000000000000000"));
        expect(result.lpAmount).toBe(
          2000n * TEN_TO_THE_18_BI + BigInt("2000000000000000000000000"),
        );
      });
    });

    describe("edge cases", () => {
      it("should call context.set exactly once", async () => {
        const depositDiff = {
          incrementalLpAmount: 100n * TEN_TO_THE_18_BI,
        };

        await updateALMLPWrapper(
          depositDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        expect(
          jest.mocked(mockContext.ALM_LP_Wrapper?.set),
        ).toHaveBeenCalledTimes(1);
      });

      it("should preserve immutability (use spread operator)", async () => {
        const depositDiff = {
          liquidity: 999999n,
        };

        await updateALMLPWrapper(
          depositDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.id).toBe(mockALMLPWrapperData.id);
        expect(result.chainId).toBe(mockALMLPWrapperData.chainId);
        expect(result.pool).toBe(mockALMLPWrapperData.pool);
        expect(result.liquidity).not.toBe(mockALMLPWrapperData.liquidity);
        expect(result.lastUpdatedTimestamp).not.toBe(
          mockALMLPWrapperData.lastUpdatedTimestamp,
        );
      });
    });

    describe("when updating with rebalance diff (position fields)", () => {
      let result: ALM_LP_Wrapper;

      beforeEach(async () => {
        const rebalanceDiff = {
          tokenId: 2n,
          liquidity: 1500000n,
          tickLower: -1200n,
          tickUpper: 1200n,
          property: 3000n,
        };

        await updateALMLPWrapper(
          rebalanceDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;
      });

      it("should set position fields directly", () => {
        expect(result.liquidity).toBe(1500000n);
        expect(result.tokenId).toBe(2n);
        expect(result.tickLower).toBe(-1200n);
        expect(result.tickUpper).toBe(1200n);
        expect(result.property).toBe(3000n);
      });

      it("should preserve lpAmount when not in diff", () => {
        expect(result.lpAmount).toBe(mockALMLPWrapperData.lpAmount);
      });

      it("should preserve other position fields", () => {
        expect(result.strategyType).toBe(mockALMLPWrapperData.strategyType);
        expect(result.tickNeighborhood).toBe(
          mockALMLPWrapperData.tickNeighborhood,
        );
        expect(result.tickSpacing).toBe(mockALMLPWrapperData.tickSpacing);
        expect(result.positionWidth).toBe(mockALMLPWrapperData.positionWidth);
      });

      it("should update timestamp", () => {
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
      });
    });

    describe("when updating with partial rebalance diff", () => {
      it("should only update provided position fields", async () => {
        const partialRebalanceDiff = {
          liquidity: 2000000n,
        };

        await updateALMLPWrapper(
          partialRebalanceDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.liquidity).toBe(2000000n);
        expect(result.tokenId).toBe(mockALMLPWrapperData.tokenId);
        expect(result.tickLower).toBe(mockALMLPWrapperData.tickLower);
      });
    });
  });
});
