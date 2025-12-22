import { expect } from "chai";
import sinon from "sinon";
import type { Token, handlerContext } from "../../generated/src/Types.gen";
import { createOUSDTSwapEntity } from "../../src/Aggregators/OUSDTSwaps";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("OUSDTSwaps", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  const chainId = 10;
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";

  let mockContext: Partial<handlerContext>;
  let oUSDTSwapsSetStub: sinon.SinonStub;

  beforeEach(() => {
    oUSDTSwapsSetStub = sinon.stub();
    mockContext = {
      OUSDTSwaps: {
        set: oUSDTSwapsSetStub,
        get: sinon.stub(),
        getOrThrow: sinon.stub(),
        getOrCreate: sinon.stub(),
        deleteUnsafe: sinon.stub(),
        getWhere: {
          transactionHash: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
        },
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("createOUSDTSwapEntity", () => {
    describe("when token0 is going in (amount0In > 0)", () => {
      it("should create entity with token0 as tokenIn and token1 as tokenOut", () => {
        const amount0In = 1000n * 10n ** 18n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2000n * 10n ** 6n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          mockToken0Data as Token,
          mockToken1Data as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(oUSDTSwapsSetStub.calledOnce).to.be.true;
        const entity = oUSDTSwapsSetStub.firstCall.args[0];
        expect(entity.id).to.equal(
          `${transactionHash}_${chainId}_${mockToken0Data.address}_${amount0In}_${mockToken1Data.address}_${amount1Out}`,
        );
        expect(entity.transactionHash).to.equal(transactionHash);
        expect(entity.tokenInPool).to.equal(mockToken0Data.address);
        expect(entity.tokenOutPool).to.equal(mockToken1Data.address);
        expect(entity.amountIn).to.equal(amount0In);
        expect(entity.amountOut).to.equal(amount1Out);
      });
    });

    describe("when token1 is going in (amount1In > 0)", () => {
      it("should create entity with token1 as tokenIn and token0 as tokenOut", () => {
        const amount0In = 0n;
        const amount0Out = 2000n * 10n ** 18n;
        const amount1In = 1000n * 10n ** 6n;
        const amount1Out = 0n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          mockToken0Data as Token,
          mockToken1Data as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(oUSDTSwapsSetStub.calledOnce).to.be.true;
        const entity = oUSDTSwapsSetStub.firstCall.args[0];
        expect(entity.id).to.equal(
          `${transactionHash}_${chainId}_${mockToken1Data.address}_${amount1In}_${mockToken0Data.address}_${amount0Out}`,
        );
        expect(entity.transactionHash).to.equal(transactionHash);
        expect(entity.tokenInPool).to.equal(mockToken1Data.address);
        expect(entity.tokenOutPool).to.equal(mockToken0Data.address);
        expect(entity.amountIn).to.equal(amount1In);
        expect(entity.amountOut).to.equal(amount0Out);
      });
    });

    describe("when both amounts are 0 (no swap)", () => {
      it("should not create an entity", () => {
        const amount0In = 0n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 0n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          mockToken0Data as Token,
          mockToken1Data as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(oUSDTSwapsSetStub.called).to.be.false;
      });
    });

    describe("when token0Instance is missing", () => {
      it("should not create an entity", () => {
        const amount0In = 1000n * 10n ** 18n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2000n * 10n ** 6n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          undefined as unknown as Token,
          mockToken1Data as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(oUSDTSwapsSetStub.called).to.be.false;
      });
    });

    describe("when token1Instance is missing", () => {
      it("should not create an entity", () => {
        const amount0In = 1000n * 10n ** 18n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2000n * 10n ** 6n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          mockToken0Data as Token,
          undefined as unknown as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(oUSDTSwapsSetStub.called).to.be.false;
      });
    });

    describe("when both token instances are missing", () => {
      it("should not create an entity", () => {
        const amount0In = 1000n * 10n ** 18n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2000n * 10n ** 6n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          undefined as unknown as Token,
          undefined as unknown as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(oUSDTSwapsSetStub.called).to.be.false;
      });
    });

    describe("edge cases", () => {
      it("should handle very large amounts", () => {
        const amount0In = 999999999999999999999999999n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 888888888888888888888888888n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          mockToken0Data as Token,
          mockToken1Data as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(oUSDTSwapsSetStub.calledOnce).to.be.true;
        const entity = oUSDTSwapsSetStub.firstCall.args[0];
        expect(entity.amountIn).to.equal(amount0In);
        expect(entity.amountOut).to.equal(amount1Out);
      });

      it("should handle amount0In = 1 (minimum positive value)", () => {
        const amount0In = 1n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          mockToken0Data as Token,
          mockToken1Data as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(oUSDTSwapsSetStub.calledOnce).to.be.true;
        const entity = oUSDTSwapsSetStub.firstCall.args[0];
        expect(entity.amountIn).to.equal(amount0In);
        expect(entity.amountOut).to.equal(amount1Out);
      });
    });
  });
});
