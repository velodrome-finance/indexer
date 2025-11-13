import { expect } from "chai";
import type { ALM_LP_Wrapper, handlerContext } from "generated";
import sinon from "sinon";
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

  // Extract addresses from common entities
  const lpWrapperAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const poolAddress = mockLiquidityPoolData.id;
  const chainId = mockLiquidityPoolData.chainId;

  let contextStub: Partial<handlerContext>;

  beforeEach(() => {
    contextStub = {
      ALM_LP_Wrapper: {
        set: sinon.stub(),
        get: sinon.stub(),
        getOrThrow: sinon.stub(),
        getWhere: {
          pool: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          strategyTransactionHash: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          tokenId: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
        },
        getOrCreate: sinon.stub(),
        deleteUnsafe: sinon.stub(),
      },
      log: {
        error: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        debug: sinon.stub(),
      },
    };
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
          contextStub as handlerContext,
        );

        result = (contextStub.ALM_LP_Wrapper?.set as sinon.SinonStub).firstCall
          .args[0];
      });

      it("should add amounts to existing values", () => {
        expect(result.amount0).to.equal(1250n * TEN_TO_THE_18_BI); // 1000 + 250
        expect(result.amount1).to.equal(625n * TEN_TO_THE_6_BI); // 500 + 125
        expect(result.lpAmount).to.equal(2500n * TEN_TO_THE_18_BI); // 2000 + 500
      });

      it("should preserve other fields", () => {
        expect(result.id).to.equal(mockALMLPWrapperData.id);
        expect(result.chainId).to.equal(mockALMLPWrapperData.chainId);
        expect(result.pool).to.equal(mockALMLPWrapperData.pool);
      });

      it("should update timestamp", () => {
        expect(result.lastUpdatedTimestamp).to.equal(timestamp);
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
          contextStub as handlerContext,
        );

        result = (contextStub.ALM_LP_Wrapper?.set as sinon.SinonStub).firstCall
          .args[0];
      });

      it("should subtract amounts from existing values", () => {
        expect(result.amount0).to.equal(750n * TEN_TO_THE_18_BI); // 1000 - 250
        expect(result.amount1).to.equal(375n * TEN_TO_THE_6_BI); // 500 - 125
        expect(result.lpAmount).to.equal(1500n * TEN_TO_THE_18_BI); // 2000 - 500
      });

      it("should update timestamp", () => {
        expect(result.lastUpdatedTimestamp).to.equal(timestamp);
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
          contextStub as handlerContext,
        );

        const result = (contextStub.ALM_LP_Wrapper?.set as sinon.SinonStub)
          .firstCall.args[0];

        expect(result.amount0).to.equal(1100n * TEN_TO_THE_18_BI); // 1000 + 100
        expect(result.amount1).to.equal(500n * TEN_TO_THE_6_BI); // unchanged
        expect(result.lpAmount).to.equal(2000n * TEN_TO_THE_18_BI); // unchanged
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
          contextStub as handlerContext,
        );

        const result = (contextStub.ALM_LP_Wrapper?.set as sinon.SinonStub)
          .firstCall.args[0];

        expect(result.amount0).to.equal(1000n * TEN_TO_THE_18_BI); // 1000 + 0
        expect(result.amount1).to.equal(500n * TEN_TO_THE_6_BI); // 500 + 0
        expect(result.lpAmount).to.equal(2000n * TEN_TO_THE_18_BI); // 2000 + 0
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
          contextStub as handlerContext,
        );

        const result = (contextStub.ALM_LP_Wrapper?.set as sinon.SinonStub)
          .firstCall.args[0];

        expect(result.amount0).to.equal(500n * TEN_TO_THE_18_BI);
        expect(result.amount1).to.equal(250n * TEN_TO_THE_6_BI);
        expect(result.lpAmount).to.equal(1000n * TEN_TO_THE_18_BI);
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
          contextStub as handlerContext,
        );

        const result = (contextStub.ALM_LP_Wrapper?.set as sinon.SinonStub)
          .firstCall.args[0];

        expect(result.amount0).to.equal(-250n * TEN_TO_THE_18_BI); // 0 - 250
        expect(result.amount1).to.equal(-125n * TEN_TO_THE_6_BI); // 0 - 125
        expect(result.lpAmount).to.equal(-500n * TEN_TO_THE_18_BI); // 0 - 500
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
          contextStub as handlerContext,
        );

        const result = (contextStub.ALM_LP_Wrapper?.set as sinon.SinonStub)
          .firstCall.args[0];

        expect(result.amount0).to.equal(1100n * TEN_TO_THE_18_BI); // 1000 + 100
        expect(result.amount1).to.equal(500n * TEN_TO_THE_6_BI); // unchanged (0n added)
        expect(result.lpAmount).to.equal(2000n * TEN_TO_THE_18_BI); // unchanged (0n added)
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
          contextStub as handlerContext,
        );

        const result = (contextStub.ALM_LP_Wrapper?.set as sinon.SinonStub)
          .firstCall.args[0];

        expect(result.amount0).to.equal(
          1000n * TEN_TO_THE_18_BI + BigInt("1000000000000000000000000"),
        );
        expect(result.amount1).to.equal(
          500n * TEN_TO_THE_6_BI + BigInt("500000000000"),
        );
        expect(result.lpAmount).to.equal(
          2000n * TEN_TO_THE_18_BI + BigInt("2000000000000000000000000"),
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
          contextStub as handlerContext,
        );

        expect((contextStub.ALM_LP_Wrapper?.set as sinon.SinonStub).calledOnce)
          .to.be.true;
      });

      it("should preserve immutability (use spread operator)", async () => {
        const depositDiff = {
          amount0: 100n * TEN_TO_THE_18_BI,
        };

        await updateALMLPWrapper(
          depositDiff,
          mockALMLPWrapperData,
          timestamp,
          contextStub as handlerContext,
        );

        const result = (contextStub.ALM_LP_Wrapper?.set as sinon.SinonStub)
          .firstCall.args[0];

        // Verify all original fields are preserved
        expect(result.id).to.equal(mockALMLPWrapperData.id);
        expect(result.chainId).to.equal(mockALMLPWrapperData.chainId);
        expect(result.pool).to.equal(mockALMLPWrapperData.pool);
        // Only amounts and timestamp should change
        expect(result.amount0).to.not.equal(mockALMLPWrapperData.amount0);
        expect(result.lastUpdatedTimestamp).to.not.equal(
          mockALMLPWrapperData.lastUpdatedTimestamp,
        );
      });
    });

    describe("when updating with rebalance diff (position fields)", () => {
      let result: ALM_LP_Wrapper;

      beforeEach(async () => {
        const rebalanceDiff = {
          tokenId: 2n,
          positionAmount0: 600n * TEN_TO_THE_18_BI,
          positionAmount1: 300n * TEN_TO_THE_6_BI,
          liquidity: 1500000n,
          tickLower: -1200n,
          tickUpper: 1200n,
          property: 3000n,
        };

        await updateALMLPWrapper(
          rebalanceDiff,
          mockALMLPWrapperData,
          timestamp,
          contextStub as handlerContext,
        );

        result = (contextStub.ALM_LP_Wrapper?.set as sinon.SinonStub).firstCall
          .args[0];
      });

      it("should set position fields directly (not increment)", () => {
        expect(result.positionAmount0).to.equal(600n * TEN_TO_THE_18_BI); // Set directly, not 500 + 600
        expect(result.positionAmount1).to.equal(300n * TEN_TO_THE_6_BI); // Set directly, not 250 + 300
        expect(result.liquidity).to.equal(1500000n); // Set directly, not 1000000 + 1500000
        expect(result.tokenId).to.equal(2n); // Set directly
        expect(result.tickLower).to.equal(-1200n); // Set directly
        expect(result.tickUpper).to.equal(1200n); // Set directly
        expect(result.property).to.equal(3000n); // Set directly
      });

      it("should preserve wrapper-level aggregations", () => {
        expect(result.amount0).to.equal(mockALMLPWrapperData.amount0);
        expect(result.amount1).to.equal(mockALMLPWrapperData.amount1);
        expect(result.lpAmount).to.equal(mockALMLPWrapperData.lpAmount);
      });

      it("should preserve other position fields", () => {
        expect(result.strategyType).to.equal(mockALMLPWrapperData.strategyType);
        expect(result.tickNeighborhood).to.equal(
          mockALMLPWrapperData.tickNeighborhood,
        );
        expect(result.tickSpacing).to.equal(mockALMLPWrapperData.tickSpacing);
        expect(result.positionWidth).to.equal(
          mockALMLPWrapperData.positionWidth,
        );
      });

      it("should update timestamp", () => {
        expect(result.lastUpdatedTimestamp).to.equal(timestamp);
      });
    });

    describe("when updating with partial rebalance diff", () => {
      it("should only update provided position fields", async () => {
        const partialRebalanceDiff = {
          positionAmount0: 700n * TEN_TO_THE_18_BI,
          liquidity: 2000000n,
          // Other position fields not provided
        };

        await updateALMLPWrapper(
          partialRebalanceDiff,
          mockALMLPWrapperData,
          timestamp,
          contextStub as handlerContext,
        );

        const result = (contextStub.ALM_LP_Wrapper?.set as sinon.SinonStub)
          .firstCall.args[0];

        expect(result.positionAmount0).to.equal(700n * TEN_TO_THE_18_BI); // Updated
        expect(result.liquidity).to.equal(2000000n); // Updated
        expect(result.positionAmount1).to.equal(
          mockALMLPWrapperData.positionAmount1,
        ); // Unchanged
        expect(result.tokenId).to.equal(mockALMLPWrapperData.tokenId); // Unchanged
        expect(result.tickLower).to.equal(mockALMLPWrapperData.tickLower); // Unchanged
      });
    });
  });
});
