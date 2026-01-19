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
      it("should process fees and return both pool and user update data", () => {
        const result = processPoolFees(
          mockEvent,
          mockToken0Data,
          mockToken1Data,
        );

        // Check liquidity pool diff
        expect(result.liquidityPoolDiff).toBeDefined();
        // For regular pools, fees are tracked as unstaked fees
        expect(
          result.liquidityPoolDiff?.incrementalTotalUnstakedFeesCollected0,
        ).toBe(mockEvent.params.amount0);
        expect(
          result.liquidityPoolDiff?.incrementalTotalUnstakedFeesCollected1,
        ).toBe(mockEvent.params.amount1);
        expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).toEqual(
          new Date(mockEvent.block.timestamp * 1000),
        );

        // Check user diff data
        expect(result.userDiff).toBeDefined();
        expect(result.userDiff?.incrementalTotalFeesContributed0).toBe(
          mockEvent.params.amount0,
        );
        expect(result.userDiff?.incrementalTotalFeesContributed1).toBe(
          mockEvent.params.amount1,
        );
        expect(result.userDiff?.lastActivityTimestamp).toEqual(
          new Date(mockEvent.block.timestamp * 1000),
        );
      });

      it("should prepare user update data correctly", () => {
        const result = processPoolFees(
          mockEvent,
          mockToken0Data,
          mockToken1Data,
        );

        // Check that user diff data is prepared correctly
        expect(result.userDiff).toBeDefined();
        expect(result.userDiff?.incrementalTotalFeesContributed0).toBe(
          mockEvent.params.amount0,
        );
        expect(result.userDiff?.incrementalTotalFeesContributed1).toBe(
          mockEvent.params.amount1,
        );
        expect(result.userDiff?.lastActivityTimestamp).toEqual(
          new Date(mockEvent.block.timestamp * 1000),
        );
      });
    });

    describe("fee calculation", () => {
      it("should calculate USD fees correctly using updateFeeTokenData", () => {
        const result = processPoolFees(
          mockEvent,
          mockToken0Data,
          mockToken1Data,
        );

        // The USD calculation is handled by updateFeeTokenData
        // We just verify that the result contains the expected structure
        expect(result.liquidityPoolDiff).toBeDefined();
        expect(
          typeof result.liquidityPoolDiff
            ?.incrementalTotalUnstakedFeesCollectedUSD,
        ).toBe("bigint");
        expect(
          typeof result.liquidityPoolDiff?.incrementalTotalFeesUSDWhitelisted,
        ).toBe("bigint");
      });

      it("should handle different token decimals correctly", () => {
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

        const result = processPoolFees(
          mockEvent,
          tokenWith6Decimals,
          tokenWith18Decimals,
        );

        expect(result.liquidityPoolDiff).toBeDefined();
        expect(result.userDiff).toBeDefined();
      });

      it("should handle undefined tokens", () => {
        const result = processPoolFees(mockEvent, undefined, undefined);

        expect(result.liquidityPoolDiff).toBeDefined();
        expect(result.userDiff).toBeDefined();
      });
    });
  });
});
