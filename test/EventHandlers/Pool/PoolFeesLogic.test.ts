import type { Pool_Fees_event, Token, handlerContext } from "generated";
import { toChecksumAddress } from "../../../src/Constants";
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
    srcAddress: toChecksumAddress("0x3333333333333333333333333333333333333333"),
    transaction: {
      hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
    },
    params: {
      amount0: 1000n,
      amount1: 2000n,
      sender: toChecksumAddress("0x1234567890123456789012345678901234567890"),
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
      it("should pick the trusted (smaller) leg for totalFeesGeneratedUSD (issue #733)", () => {
        const result = processPoolFees(
          mockEvent,
          mockToken0Data,
          mockToken1Data,
        );

        // Per-leg USD values (each priced independently):
        //   token0: 1000n (18 decimals) * 1 USD → 1000n
        //   token1: 2000n (6 decimals)  * 1 USD → 2_000_000_000_000_000n
        // pickTrustedSwapVolumeUSD returns the smaller leg to defend against
        // scam-token/poisoned-oracle inflation (issue #733).
        const expectedToken0FeesUSD = 1000n;
        const expectedTotalFeesUSD = expectedToken0FeesUSD;
        // Whitelisted total still sums both whitelisted legs (whitelist filter
        // is the existing defense for that field — separate from the #733 path).
        const expectedToken1FeesUSD = 2000000000000000n;
        const expectedTotalFeesUSDWhitelisted =
          expectedToken0FeesUSD + expectedToken1FeesUSD;

        expect(result.liquidityPoolDiff).toBeDefined();
        expect(result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD).toBe(
          expectedTotalFeesUSD,
        );
        expect(
          result.liquidityPoolDiff?.incrementalTotalFeesUSDWhitelisted,
        ).toBe(expectedTotalFeesUSDWhitelisted);
      });

      // Regression for issue #733: a Fees event whose only non-zero leg is on
      // a poisoned-price token must not inflate totalFeesGeneratedUSD through
      // the legitimately-priced counterpart. Both legs are priced independently
      // and the trusted (smaller / non-zero fallback) leg is taken.
      it("should not inherit a poisoned-price leg when the counterpart leg is honest (issue #733)", () => {
        const poisonedPrice = 10n ** 35n;
        const poisonedToken0: Token = {
          ...mockToken0Data,
          pricePerUSDNew: poisonedPrice,
        };
        // Honest fee on token1 only; token0 (poisoned) amount is 0 in this event.
        const event: Pool_Fees_event = {
          ...mockEvent,
          params: { ...mockEvent.params, amount0: 0n, amount1: 2000n },
        };

        const result = processPoolFees(event, poisonedToken0, mockToken1Data);

        // Only the honest leg is non-zero, so the trusted-leg pick returns it
        // and the poisoned price never enters the computation.
        const honestLegUSD = 2000000000000000n;
        expect(result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD).toBe(
          honestLegUSD,
        );
        expect(
          result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD ?? 0n,
        ).toBeLessThan(poisonedPrice);
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

        const feesEvent: Pool_Fees_event = {
          ...mockEvent,
          params: {
            ...mockEvent.params,
            amount0: feeAmount0,
            amount1: 0n,
          },
        };

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
