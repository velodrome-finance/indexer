import { expect } from "chai";
import type { ALM_LP_Wrapper, handlerContext } from "generated";
import sinon from "sinon";
import * as TokenEffects from "../../../src/Effects/Token";
import {
  calculateLiquidityFromAmounts,
  deriveUserAmounts,
} from "../../../src/EventHandlers/ALM/LPWrapperLogic";
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

  beforeEach(() => {
    // Stub roundBlockToInterval
    roundBlockToIntervalStub = sinon
      .stub(TokenEffects, "roundBlockToInterval")
      .returns(roundedBlockNumber);

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

  describe("deriveUserAmounts", () => {
    it("should calculate user amounts from LP share", () => {
      const userLp = 1000n * 10n ** 18n;
      const totalLp = 5000n * 10n ** 18n;
      const wrapperAmount0 = 1000n * 10n ** 18n;
      const wrapperAmount1 = 500n * 10n ** 6n;

      const result = deriveUserAmounts(
        userLp,
        totalLp,
        wrapperAmount0,
        wrapperAmount1,
      );

      // User has 1000/5000 = 20% of LP, so gets 20% of amounts
      expect(result.amount0).to.equal(200n * 10n ** 18n); // 1000 * 1000 / 5000 = 200
      expect(result.amount1).to.equal(100n * 10n ** 6n); // 500 * 1000 / 5000 = 100
    });

    it("should return zero amounts when user LP is zero", () => {
      const result = deriveUserAmounts(
        0n,
        5000n * 10n ** 18n,
        1000n * 10n ** 18n,
        500n * 10n ** 6n,
      );

      expect(result.amount0).to.equal(0n);
      expect(result.amount1).to.equal(0n);
    });

    it("should return zero amounts when total LP is zero", () => {
      const result = deriveUserAmounts(
        1000n * 10n ** 18n,
        0n,
        1000n * 10n ** 18n,
        500n * 10n ** 6n,
      );

      expect(result.amount0).to.equal(0n);
      expect(result.amount1).to.equal(0n);
    });

    it("should handle fractional results correctly", () => {
      const userLp = 1n;
      const totalLp = 3n;
      const wrapperAmount0 = 10n;
      const wrapperAmount1 = 10n;

      const result = deriveUserAmounts(
        userLp,
        totalLp,
        wrapperAmount0,
        wrapperAmount1,
      );

      // 10 * 1 / 3 = 3 (integer division)
      expect(result.amount0).to.equal(3n);
      expect(result.amount1).to.equal(3n);
    });

    it("should handle user with partial LP share correctly", () => {
      // Realistic scenario: user has 30% of total LP
      const userLp = 300n * 10n ** 18n;
      const totalLp = 1000n * 10n ** 18n;
      const wrapperAmount0 = 1000n * 10n ** 18n;
      const wrapperAmount1 = 500n * 10n ** 6n;

      const result = deriveUserAmounts(
        userLp,
        totalLp,
        wrapperAmount0,
        wrapperAmount1,
      );

      // User has 30% share, so gets 30% of amounts
      // amount0: (1000 * 300) / 1000 = 300
      // amount1: (500 * 300) / 1000 = 150
      expect(result.amount0).to.equal(300n * 10n ** 18n);
      expect(result.amount1).to.equal(150n * 10n ** 6n);
    });
  });

  describe("calculateLiquidityFromAmounts", () => {
    it("should successfully calculate liquidity from amounts and price", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // Mock successful sqrtPriceX96 fetch
      getSqrtPriceX96Stub.resolves(mockSqrtPriceX96);

      const result = await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      // Result should be a calculated liquidity value (not the original)
      expect(result).to.not.equal(wrapper.liquidity);
      expect(result).to.be.a("bigint");
      expect(getSqrtPriceX96Stub.callCount).to.equal(1);
      expect(roundBlockToIntervalStub.callCount).to.equal(1);
      expect(roundBlockToIntervalStub.calledWith(blockNumber, chainId)).to.be
        .true;
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

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // First call (rounded block) fails, second call (actual block) succeeds
      getSqrtPriceX96Stub
        .onCall(0)
        .rejects(new Error("Pool does not exist at rounded block"));
      getSqrtPriceX96Stub.onCall(1).resolves(mockSqrtPriceX96);

      const result = await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Withdraw",
      );

      // Verify retry happened (both calls were made)
      expect(getSqrtPriceX96Stub.callCount).to.equal(2);
      // Verify first call was with rounded block
      // args[0] is the effect function (getSqrtPriceX96), args[1] is the input object
      expect(getSqrtPriceX96Stub.getCall(0).args[1].blockNumber).to.equal(
        roundedBlockNumber,
      );
      // Verify second call was with actual block
      expect(getSqrtPriceX96Stub.getCall(1).args[1].blockNumber).to.equal(
        blockNumber,
      );
      // Verify warning was logged
      expect(
        (mockContext.log.warn as sinon.SinonStub).callCount,
      ).to.be.greaterThan(0);
      // Result should be a calculated value (may or may not equal wrapper.liquidity depending on calculation)
      expect(result).to.be.a("bigint");
    });

    it("should return current liquidity if both rounded and actual block fail", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // Both calls fail
      getSqrtPriceX96Stub.rejects(new Error("Failed to fetch"));

      const result = await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      // Should return current liquidity
      expect(result).to.equal(wrapper.liquidity);
      expect(
        (mockContext.log.error as sinon.SinonStub).callCount,
      ).to.be.greaterThan(0);
    });

    it("should return current liquidity if sqrtPriceX96 is undefined", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      getSqrtPriceX96Stub.resolves(undefined);

      const result = await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Withdraw",
      );

      // Should return current liquidity
      expect(result).to.equal(wrapper.liquidity);
      expect((mockContext.log.warn as sinon.SinonStub).callCount).to.equal(1);
      expect(
        (mockContext.log.warn as sinon.SinonStub).getCall(0).args[0],
      ).to.include("sqrtPriceX96 is undefined or 0");
    });

    it("should return current liquidity if sqrtPriceX96 is zero", async () => {
      const wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        liquidity: 1000000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
      };

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      getSqrtPriceX96Stub.resolves(0n);

      const result = await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      // Should return current liquidity
      expect(result).to.equal(wrapper.liquidity);
      expect((mockContext.log.warn as sinon.SinonStub).callCount).to.equal(1);
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

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      // Throw unexpected error
      roundBlockToIntervalStub.throws(new Error("Unexpected error"));

      const result = await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
        poolAddress,
        chainId,
        blockNumber,
        mockContext,
        "Deposit",
      );

      // Should return current liquidity on error
      expect(result).to.equal(wrapper.liquidity);
      expect((mockContext.log.error as sinon.SinonStub).callCount).to.equal(1);
      expect(
        (mockContext.log.error as sinon.SinonStub).getCall(0).args[0],
      ).to.include("Error calculating liquidity from amounts");
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

      const updatedAmount0 = 600n * 10n ** 18n;
      const updatedAmount1 = 300n * 10n ** 6n;

      getSqrtPriceX96Stub.rejects(new Error("Failed"));

      await calculateLiquidityFromAmounts(
        wrapper,
        updatedAmount0,
        updatedAmount1,
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
  });
});
