import { expect } from "chai";
import type { Pool_Fees_event, Token, handlerContext } from "generated";
import { processPoolFees } from "../../../src/EventHandlers/Pool/PoolFeesLogic";
import { setupCommon } from "./common";

describe("PoolFeesLogic", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();

  const mockEvent: Pool_Fees_event = {
    chainId: 10,
    block: {
      number: 123456,
      timestamp: 1000000,
      hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
    },
    logIndex: 1,
    srcAddress: "0x3333333333333333333333333333333333333333",
    transaction: {
      hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
    },
    params: {
      amount0: 1000n,
      amount1: 2000n,
      sender: "0x1234567890123456789012345678901234567890",
    },
  };

  let mockContext: handlerContext;

  beforeEach(() => {
    mockContext = {
      log: {
        error: () => {},
        warn: () => {},
        info: () => {},
      },
    } as unknown as handlerContext;
  });

  describe("processPoolFees", () => {
    describe("successful processing", () => {
      it("should process fees and return both pool and user update data", async () => {
        const result = await processPoolFees(
          mockEvent,
          mockToken0Data,
          mockToken1Data,
          mockContext,
        );

        // Check liquidity pool diff
        expect(result.liquidityPoolDiff).to.not.be.undefined;
        expect(result.liquidityPoolDiff?.totalFees0).to.equal(
          mockEvent.params.amount0,
        );
        expect(result.liquidityPoolDiff?.totalFees1).to.equal(
          mockEvent.params.amount1,
        );
        expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).to.deep.equal(
          new Date(mockEvent.block.timestamp * 1000),
        );

        // Check user diff data
        expect(result.userDiff).to.not.be.undefined;
        expect(result.userDiff?.totalFeesContributed0).to.equal(
          mockEvent.params.amount0,
        );
        expect(result.userDiff?.totalFeesContributed1).to.equal(
          mockEvent.params.amount1,
        );
        expect(result.userDiff?.lastActivityTimestamp).to.deep.equal(
          new Date(mockEvent.block.timestamp * 1000),
        );
      });

      it("should prepare user update data correctly", async () => {
        const result = await processPoolFees(
          mockEvent,
          mockToken0Data,
          mockToken1Data,
          mockContext,
        );

        // Check that user diff data is prepared correctly
        expect(result.userDiff).to.not.be.undefined;
        expect(result.userDiff?.totalFeesContributed0).to.equal(
          mockEvent.params.amount0,
        );
        expect(result.userDiff?.totalFeesContributed1).to.equal(
          mockEvent.params.amount1,
        );
        expect(result.userDiff?.lastActivityTimestamp).to.deep.equal(
          new Date(mockEvent.block.timestamp * 1000),
        );
      });
    });

    describe("fee calculation", () => {
      it("should calculate USD fees correctly using updateFeeTokenData", async () => {
        const result = await processPoolFees(
          mockEvent,
          mockToken0Data,
          mockToken1Data,
          mockContext,
        );

        // The USD calculation is handled by updateFeeTokenData
        // We just verify that the result contains the expected structure
        expect(result.liquidityPoolDiff).to.not.be.undefined;
        expect(result.liquidityPoolDiff?.totalFeesUSD).to.be.a("bigint");
        expect(result.liquidityPoolDiff?.totalFeesUSDWhitelisted).to.be.a(
          "bigint",
        );
      });

      it("should handle different token decimals correctly", async () => {
        // Create tokens with different decimals
        const tokenWith6Decimals: Token = {
          ...mockToken0Data,
          decimals: 6n,
          pricePerUSDNew: 1000000000000000000n, // 1 USD
        };

        const tokenWith18Decimals: Token = {
          ...mockToken1Data,
          decimals: 18n,
          pricePerUSDNew: 2000000000000000000n, // 2 USD
        };

        const result = await processPoolFees(
          mockEvent,
          tokenWith6Decimals,
          tokenWith18Decimals,
          mockContext,
        );

        expect(result.liquidityPoolDiff).to.not.be.undefined;
        expect(result.userDiff).to.not.be.undefined;
      });

      it("should handle undefined tokens", async () => {
        const result = await processPoolFees(
          mockEvent,
          undefined,
          undefined,
          mockContext,
        );

        expect(result.liquidityPoolDiff).to.not.be.undefined;
        expect(result.userDiff).to.not.be.undefined;
      });
    });
  });
});
