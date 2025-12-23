import type { ALM_LP_Wrapper, handlerContext } from "generated";
import { updateALMLPWrapper } from "../../src/Aggregators/ALMLPWrapper";
import {
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  toChecksumAddress,
} from "../../src/Constants";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("ALMLPWrapper Aggregator", () => {
  const { mockALMLPWrapperData, mockLiquidityPoolData } = setupCommon();
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
    describe("when updating with deposit diff (positive amounts)", () => {
      let result: ALM_LP_Wrapper;

      beforeEach(async () => {
        const depositDiff = {
          amount0: 250n * TEN_TO_THE_18_BI,
          amount1: 125n * TEN_TO_THE_6_BI,
          lpAmount: 500n * TEN_TO_THE_18_BI,
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

      it("should set amount0 and amount1 directly (recalculated from liquidity), and increment lpAmount", () => {
        expect(result.amount0).toBe(250n * TEN_TO_THE_18_BI); // Set directly, not incremented
        expect(result.amount1).toBe(125n * TEN_TO_THE_6_BI); // Set directly, not incremented
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

    describe("when updating with withdraw diff (negative amounts)", () => {
      let result: ALM_LP_Wrapper;

      beforeEach(async () => {
        const withdrawDiff = {
          amount0: -250n * TEN_TO_THE_18_BI,
          amount1: -125n * TEN_TO_THE_6_BI,
          lpAmount: -500n * TEN_TO_THE_18_BI,
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

      it("should set amount0 and amount1 directly (recalculated from liquidity), and decrement lpAmount", () => {
        expect(result.amount0).toBe(-250n * TEN_TO_THE_18_BI); // Set directly (negative value), not decremented
        expect(result.amount1).toBe(-125n * TEN_TO_THE_6_BI); // Set directly (negative value), not decremented
        expect(result.lpAmount).toBe(1500n * TEN_TO_THE_18_BI); // 2000 - 500 (decremented)
      });

      it("should update timestamp", () => {
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
      });
    });

    describe("when updating with partial diff", () => {
      it("should only update provided fields", async () => {
        const partialDiff = {
          amount0: 100n * TEN_TO_THE_18_BI,
          // amount1 and lpAmount not provided
        };

        await updateALMLPWrapper(
          partialDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.amount0).toBe(100n * TEN_TO_THE_18_BI); // Set directly, not incremented
        expect(result.amount1).toBe(500n * TEN_TO_THE_6_BI); // unchanged
        expect(result.lpAmount).toBe(2000n * TEN_TO_THE_18_BI); // unchanged
      });

      it("should handle zero values correctly", async () => {
        const zeroDiff = {
          amount0: 0n,
          amount1: 0n,
          lpAmount: 0n,
        };

        await updateALMLPWrapper(
          zeroDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.amount0).toBe(0n); // Set to 0 directly
        expect(result.amount1).toBe(0n); // Set to 0 directly
        expect(result.lpAmount).toBe(2000n * TEN_TO_THE_18_BI); // 2000 + 0 (unchanged)
      });
    });

    describe("when updating from zero state", () => {
      it("should handle deposit correctly", async () => {
        const emptyWrapper: ALM_LP_Wrapper = {
          ...mockALMLPWrapperData,
          amount0: 0n,
          amount1: 0n,
          lpAmount: 0n,
        };

        const depositDiff = {
          amount0: 500n * TEN_TO_THE_18_BI,
          amount1: 250n * TEN_TO_THE_6_BI,
          lpAmount: 1000n * TEN_TO_THE_18_BI,
        };

        await updateALMLPWrapper(
          depositDiff,
          emptyWrapper,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.amount0).toBe(500n * TEN_TO_THE_18_BI);
        expect(result.amount1).toBe(250n * TEN_TO_THE_6_BI);
        expect(result.lpAmount).toBe(1000n * TEN_TO_THE_18_BI);
      });

      it("should handle withdraw correctly (result in negative values)", async () => {
        const emptyWrapper: ALM_LP_Wrapper = {
          ...mockALMLPWrapperData,
          amount0: 0n,
          amount1: 0n,
          lpAmount: 0n,
        };

        const withdrawDiff = {
          amount0: -250n * TEN_TO_THE_18_BI,
          amount1: -125n * TEN_TO_THE_6_BI,
          lpAmount: -500n * TEN_TO_THE_18_BI,
        };

        await updateALMLPWrapper(
          withdrawDiff,
          emptyWrapper,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.amount0).toBe(-250n * TEN_TO_THE_18_BI); // 0 - 250
        expect(result.amount1).toBe(-125n * TEN_TO_THE_6_BI); // 0 - 125
        expect(result.lpAmount).toBe(-500n * TEN_TO_THE_18_BI); // 0 - 500
      });
    });

    describe("when updating with undefined values", () => {
      it("should treat undefined as zero (no change)", async () => {
        const diffWithUndefined = {
          amount0: 100n * TEN_TO_THE_18_BI,
          amount1: undefined,
          lpAmount: undefined,
        };

        await updateALMLPWrapper(
          diffWithUndefined,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.amount0).toBe(100n * TEN_TO_THE_18_BI); // Set directly, not incremented
        expect(result.amount1).toBe(500n * TEN_TO_THE_6_BI); // unchanged (undefined means keep current)
        expect(result.lpAmount).toBe(2000n * TEN_TO_THE_18_BI); // unchanged (undefined means keep current)
      });

      it("should keep current amount0 when amount0 is undefined (covers false branch on line 19)", async () => {
        const diffWithUndefinedAmount0 = {
          amount0: undefined,
          amount1: 200n * TEN_TO_THE_6_BI,
          lpAmount: 300n * TEN_TO_THE_18_BI,
        };

        await updateALMLPWrapper(
          diffWithUndefinedAmount0,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.amount0).toBe(mockALMLPWrapperData.amount0); // unchanged (undefined means keep current)
        expect(result.amount1).toBe(200n * TEN_TO_THE_6_BI); // Set directly
        expect(result.lpAmount).toBe(2300n * TEN_TO_THE_18_BI); // 2000 + 300 (incremented)
      });
    });

    describe("when updating with very large amounts", () => {
      it("should handle large BigInt values correctly", async () => {
        const largeDiff = {
          amount0: BigInt("1000000000000000000000000"), // 1M tokens with 18 decimals
          amount1: BigInt("500000000000"), // 500k tokens with 6 decimals
          lpAmount: BigInt("2000000000000000000000000"), // 2M tokens with 18 decimals
        };

        await updateALMLPWrapper(
          largeDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.amount0).toBe(
          BigInt("1000000000000000000000000"), // Set directly, not incremented
        );
        expect(result.amount1).toBe(
          BigInt("500000000000"), // Set directly, not incremented
        );
        expect(result.lpAmount).toBe(
          2000n * TEN_TO_THE_18_BI + BigInt("2000000000000000000000000"), // Incremented
        );
      });
    });

    describe("edge cases", () => {
      it("should call context.set exactly once", async () => {
        const depositDiff = {
          amount0: 100n * TEN_TO_THE_18_BI,
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
          amount0: 100n * TEN_TO_THE_18_BI,
        };

        await updateALMLPWrapper(
          depositDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        // Verify all original fields are preserved
        expect(result.id).toBe(mockALMLPWrapperData.id);
        expect(result.chainId).toBe(mockALMLPWrapperData.chainId);
        expect(result.pool).toBe(mockALMLPWrapperData.pool);
        // Only amounts and timestamp should change
        expect(result.amount0).not.toBe(mockALMLPWrapperData.amount0);
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
          amount0: 600n * TEN_TO_THE_18_BI,
          amount1: 300n * TEN_TO_THE_6_BI,
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

      it("should set position fields directly (not increment)", () => {
        expect(result.amount0).toBe(600n * TEN_TO_THE_18_BI); // Set directly, not 500 + 600
        expect(result.amount1).toBe(300n * TEN_TO_THE_6_BI); // Set directly, not 250 + 300
        expect(result.liquidity).toBe(1500000n); // Set directly, not 1000000 + 1500000
        expect(result.tokenId).toBe(2n); // Set directly
        expect(result.tickLower).toBe(-1200n); // Set directly
        expect(result.tickUpper).toBe(1200n); // Set directly
        expect(result.property).toBe(3000n); // Set directly
      });

      it("should preserve lpAmount aggregation", () => {
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
          amount0: 700n * TEN_TO_THE_18_BI,
          liquidity: 2000000n,
          // Other position fields not provided
        };

        await updateALMLPWrapper(
          partialRebalanceDiff,
          mockALMLPWrapperData,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = jest.mocked(mockContext.ALM_LP_Wrapper?.set);
        const result = mockSet?.mock.calls[0]?.[0] as ALM_LP_Wrapper;

        expect(result.amount0).toBe(700n * TEN_TO_THE_18_BI); // Updated
        expect(result.liquidity).toBe(2000000n); // Updated
        expect(result.amount1).toBe(mockALMLPWrapperData.amount1); // Unchanged
        expect(result.tokenId).toBe(mockALMLPWrapperData.tokenId); // Unchanged
        expect(result.tickLower).toBe(mockALMLPWrapperData.tickLower); // Unchanged
      });
    });
  });
});
