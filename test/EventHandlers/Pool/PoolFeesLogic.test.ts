import type { Token } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import type { Pool_Fees_event, handlerContext } from "../../../src/EntityTypes";
import { processPoolFees } from "../../../src/EventHandlers/Pool/PoolFeesLogic";
import { setupCommon } from "./common";

describe("PoolFeesLogic", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();

  const mockEvent = {
    chainId: 10,
    block: {
      number: 123456,
      timestamp: 1000000,
      hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
    },
    logIndex: 1,
    srcAddress: toChecksumAddress("0x3333333333333333333333333333333333333333"),
    transaction: {
      hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
    },
    params: {
      amount0: 1000n,
      amount1: 2000n,
      sender: toChecksumAddress("0x1234567890123456789012345678901234567890"),
    },
  } as Pool_Fees_event;

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
        expect(result.liquidityPoolDiff?.incrementalTotalFeesGenerated0).toBe(
          mockEvent.params.amount0,
        );
        expect(result.liquidityPoolDiff?.incrementalTotalFeesGenerated1).toBe(
          mockEvent.params.amount1,
        );
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
      it("should calculate USD fees correctly", () => {
        const result = processPoolFees(
          mockEvent,
          mockToken0Data,
          mockToken1Data,
        );

        // Calculate expected USD values
        // token0: 1000n (18 decimals) * 1 USD = 1000n USD (normalized to 1e18)
        // token1: 2000n (6 decimals) * 1 USD = 2000n * 10^12 = 2000000000000000n USD (normalized to 1e18)
        // totalFeesUSD = 1000n + 2000000000000000n = 2000000000001000n
        // totalFeesUSDWhitelisted = same (both tokens are whitelisted)
        const expectedToken0FeesUSD = 1000n; // 1000n * 10^18 / 10^18 * 1e18 / 1e18 = 1000n
        const expectedToken1FeesUSD = 2000000000000000n; // 2000n * 10^18 / 10^6 * 1e18 / 1e18 = 2000000000000000n
        const expectedTotalFeesUSD =
          expectedToken0FeesUSD + expectedToken1FeesUSD; // 2000000000001000n
        const expectedTotalFeesUSDWhitelisted = expectedTotalFeesUSD; // Both tokens are whitelisted

        expect(result.liquidityPoolDiff).toBeDefined();
        expect(result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD).toBe(
          expectedTotalFeesUSD,
        );
        expect(
          result.liquidityPoolDiff?.incrementalTotalFeesUSDWhitelisted,
        ).toBe(expectedTotalFeesUSDWhitelisted);
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

    // Regression test for issue #670: for a known token0-input swap at a
    // realistic V2 fee tier (0.05%), fee USD must be at most 1% of volume USD.
    describe("fee ≤ 1% of volume invariant (issue #670)", () => {
      it("keeps fee USD within 1% of volume USD for token0-input swap at 0.05% fee", () => {
        const usdt: Token = {
          ...mockToken0Data,
          decimals: 6n,
          pricePerUSDNew: 1n * 10n ** 18n,
        };
        const sygx: Token = {
          ...mockToken1Data,
          decimals: 18n,
          pricePerUSDNew: 1n * 10n ** 18n,
        };

        const swapAmount0 = 1000n * 10n ** 6n;
        const feeBps = 5n;
        const feeAmount0 = (swapAmount0 * feeBps) / 10000n;

        const feesEvent = {
          ...mockEvent,
          params: {
            ...mockEvent.params,
            amount0: feeAmount0,
            amount1: 0n,
          },
        } as Pool_Fees_event;

        const result = processPoolFees(feesEvent, usdt, sygx);

        const volumeUSD = (swapAmount0 * 10n ** 18n) / 10n ** 6n;
        const feesUSD =
          result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD ?? 0n;

        expect(feesUSD * 10000n).toBe(volumeUSD * feeBps);
        expect(feesUSD * 100n).toBeLessThanOrEqual(volumeUSD);
      });
    });
  });
});
