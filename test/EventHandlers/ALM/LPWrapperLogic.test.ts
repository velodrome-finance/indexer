import { expect } from "chai";
import type { ALM_LP_Wrapper, handlerContext } from "generated";
import sinon from "sinon";
import * as TokenEffects from "../../../src/Effects/Token";
import { recalculateLPWrapperAmountsFromLiquidity } from "../../../src/EventHandlers/ALM/LPWrapperLogic";
import * as Helpers from "../../../src/Helpers";
import { setupCommon } from "../Pool/common";

describe("LPWrapperLogic", () => {
  const { mockALMLPWrapperData } = setupCommon();
  const chainId = 10;
  const poolAddress = "0x3333333333333333333333333333333333333333";
  const blockNumber = 123456;
  const roundedBlockNumber = 123000; // Example rounded block

  // Mock sqrtPriceX96 value (Q64.96 format)
  const mockSqrtPriceX96 = 79228162514264337593543950336n; // sqrt(1) * 2^96

  let mockContext: handlerContext;
  let getSqrtPriceX96Stub: sinon.SinonStub;
  let roundBlockToIntervalStub: sinon.SinonStub;
  let calculatePositionAmountsFromLiquidityStub: sinon.SinonStub;

  beforeEach(() => {
    // Stub roundBlockToInterval
    roundBlockToIntervalStub = sinon
      .stub(TokenEffects, "roundBlockToInterval")
      .returns(roundedBlockNumber);

    // Stub calculatePositionAmountsFromLiquidity
    calculatePositionAmountsFromLiquidityStub = sinon.stub(
      Helpers,
      "calculatePositionAmountsFromLiquidity",
    );

    // Create mock context with effect stub
    getSqrtPriceX96Stub = sinon.stub();
    mockContext = {
      effect: getSqrtPriceX96Stub,
      log: {
        warn: sinon.stub(),
        error: sinon.stub(),
      },
    } as unknown as handlerContext;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("recalculateLPWrapperAmountsFromLiquidity", () => {
    it("should successfully recalculate amounts from liquidity and price", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const expectedAmounts = {
        amount0: 600n * 10n ** 18n,
        amount1: 300n * 10n ** 6n,
      };

      // Mock successful sqrtPriceX96 fetch
      // The effect is called as: context.effect(getSqrtPriceX96, { poolAddress, chainId, blockNumber })
      getSqrtPriceX96Stub.resolves(mockSqrtPriceX96);

      // Mock calculation result
      calculatePositionAmountsFromLiquidityStub.returns(expectedAmounts);

      const result = await recalculateLPWrapperAmountsFromLiquidity(
        wrapper,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      expect(result.amount0).to.equal(expectedAmounts.amount0);
      expect(result.amount1).to.equal(expectedAmounts.amount1);
      expect(getSqrtPriceX96Stub.callCount).to.equal(1);
      expect(calculatePositionAmountsFromLiquidityStub.callCount).to.equal(1);
      expect(
        calculatePositionAmountsFromLiquidityStub.calledWith(
          wrapper.liquidity,
          mockSqrtPriceX96,
          wrapper.tickLower,
          wrapper.tickUpper,
        ),
      ).to.be.true;
    });

    it("should retry with actual block number if rounded block fails", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const expectedAmounts = {
        amount0: 600n * 10n ** 18n,
        amount1: 300n * 10n ** 6n,
      };

      // First call (rounded block) fails, second call (actual block) succeeds
      getSqrtPriceX96Stub
        .onCall(0)
        .rejects(new Error("Pool does not exist at rounded block"));
      getSqrtPriceX96Stub.onCall(1).resolves(mockSqrtPriceX96);

      calculatePositionAmountsFromLiquidityStub.returns(expectedAmounts);

      const result = await recalculateLPWrapperAmountsFromLiquidity(
        wrapper,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Withdraw",
      );

      expect(result.amount0).to.equal(expectedAmounts.amount0);
      expect(result.amount1).to.equal(expectedAmounts.amount1);
      expect(getSqrtPriceX96Stub.callCount).to.equal(2);
      expect((mockContext.log.warn as sinon.SinonStub).callCount).to.equal(1);
      expect(
        (mockContext.log.warn as sinon.SinonStub).getCall(0).args[0],
      ).to.include("does not exist at rounded block");
    });

    it("should return current amounts if both rounded and actual block fail", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      // Both calls fail
      getSqrtPriceX96Stub.rejects(new Error("Failed to fetch"));

      const result = await recalculateLPWrapperAmountsFromLiquidity(
        wrapper,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      // Should return current amounts
      expect(result.amount0).to.equal(wrapper.amount0);
      expect(result.amount1).to.equal(wrapper.amount1);
      expect(getSqrtPriceX96Stub.callCount).to.equal(2);
      expect((mockContext.log.error as sinon.SinonStub).callCount).to.equal(1);
      expect(calculatePositionAmountsFromLiquidityStub.called).to.be.false;
    });

    it("should return current amounts if liquidity is zero", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 0n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      getSqrtPriceX96Stub.resolves(mockSqrtPriceX96);

      const result = await recalculateLPWrapperAmountsFromLiquidity(
        wrapper,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      // Should return current amounts (not recalculated)
      expect(result.amount0).to.equal(wrapper.amount0);
      expect(result.amount1).to.equal(wrapper.amount1);
      expect(calculatePositionAmountsFromLiquidityStub.called).to.be.false;
    });

    it("should return current amounts if sqrtPriceX96 is undefined", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      // Both calls fail, resulting in undefined
      getSqrtPriceX96Stub.rejects(new Error("Failed to fetch"));

      const result = await recalculateLPWrapperAmountsFromLiquidity(
        wrapper,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Withdraw",
      );

      // Should return current amounts
      expect(result.amount0).to.equal(wrapper.amount0);
      expect(result.amount1).to.equal(wrapper.amount1);
      expect(calculatePositionAmountsFromLiquidityStub.called).to.be.false;
    });

    it("should return current amounts if sqrtPriceX96 is undefined and liquidity is zero", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 0n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      // Both calls fail, resulting in undefined
      getSqrtPriceX96Stub.rejects(new Error("Failed to fetch"));

      const result = await recalculateLPWrapperAmountsFromLiquidity(
        wrapper,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      // Should return current amounts (both conditions false: sqrtPriceX96 undefined && liquidity === 0n)
      expect(result.amount0).to.equal(wrapper.amount0);
      expect(result.amount1).to.equal(wrapper.amount1);
      expect(calculatePositionAmountsFromLiquidityStub.called).to.be.false;
    });

    it("should handle unexpected errors gracefully", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      // Throw unexpected error (Error instance)
      roundBlockToIntervalStub.throws(new Error("Unexpected error"));

      const result = await recalculateLPWrapperAmountsFromLiquidity(
        wrapper,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      // Should return current amounts on error
      expect(result.amount0).to.equal(wrapper.amount0);
      expect(result.amount1).to.equal(wrapper.amount1);
      expect((mockContext.log.error as sinon.SinonStub).callCount).to.equal(1);
      expect(
        (mockContext.log.error as sinon.SinonStub).getCall(0).args[0],
      ).to.include("Error recalculating amounts from liquidity");
      // Verify error is passed as-is when it's an Error instance
      expect(
        (mockContext.log.error as sinon.SinonStub).getCall(0).args[1],
      ).to.be.instanceOf(Error);
    });

    it("should handle non-Error exceptions (covers error instanceof Error false branch)", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      // Throw a non-Error exception (string) to cover the else branch on line 74
      // Use callsFake to throw directly, bypassing Sinon's wrapping
      roundBlockToIntervalStub.callsFake(() => {
        throw "String error";
      });

      const result = await recalculateLPWrapperAmountsFromLiquidity(
        wrapper,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Withdraw",
      );

      // Should return current amounts on error
      expect(result.amount0).to.equal(wrapper.amount0);
      expect(result.amount1).to.equal(wrapper.amount1);
      expect((mockContext.log.error as sinon.SinonStub).callCount).to.equal(1);
      // Verify that the error was converted to Error instance (covers line 74 else branch)
      const errorCall = (mockContext.log.error as sinon.SinonStub).getCall(0);
      expect(errorCall.args[1]).to.be.instanceOf(Error);
      expect(errorCall.args[1].message).to.equal("String error");
    });

    it("should handle non-Error exceptions (string, number, etc.)", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      // Throw a non-Error exception (string)
      // Use callsFake to throw directly, bypassing Sinon's wrapping
      roundBlockToIntervalStub.callsFake(() => {
        throw "String error";
      });

      const result = await recalculateLPWrapperAmountsFromLiquidity(
        wrapper,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Withdraw",
      );

      // Should return current amounts on error
      expect(result.amount0).to.equal(wrapper.amount0);
      expect(result.amount1).to.equal(wrapper.amount1);
      expect((mockContext.log.error as sinon.SinonStub).callCount).to.equal(1);
      // Verify that the error was converted to Error instance
      const errorCall = (mockContext.log.error as sinon.SinonStub).getCall(0);
      expect(errorCall.args[1]).to.be.instanceOf(Error);
      expect(errorCall.args[1].message).to.equal("String error");
    });

    it("should use correct event type in log messages", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      getSqrtPriceX96Stub.rejects(new Error("Failed"));

      await recalculateLPWrapperAmountsFromLiquidity(
        wrapper,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "CustomEvent",
      );

      expect(
        (mockContext.log.error as sinon.SinonStub).getCall(0).args[0],
      ).to.include("ALMLPWrapper.CustomEvent");
    });

    it("should call roundBlockToInterval with correct parameters", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      getSqrtPriceX96Stub.resolves(mockSqrtPriceX96);
      calculatePositionAmountsFromLiquidityStub.returns({
        amount0: 600n * 10n ** 18n,
        amount1: 300n * 10n ** 6n,
      });

      await recalculateLPWrapperAmountsFromLiquidity(
        wrapper,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      expect(roundBlockToIntervalStub.callCount).to.equal(1);
      expect(roundBlockToIntervalStub.calledWith(blockNumber, chainId)).to.be
        .true;
    });
  });
});
