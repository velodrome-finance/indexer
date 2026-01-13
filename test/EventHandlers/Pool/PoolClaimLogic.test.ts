import type { Pool_Claim_event, Token } from "generated";
import { processPoolClaim } from "../../../src/EventHandlers/Pool/PoolClaimLogic";
import { setupCommon } from "./common";

describe("PoolClaimLogic", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();

  const mockEvent: Pool_Claim_event = {
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
      sender: "0x1234567890123456789012345678901234567890",
      recipient: "0x9876543210987654321098765432109876543210",
      amount0: 1000n,
      amount1: 2000n,
    },
  };

  const gaugeAddress = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  describe("processPoolClaim", () => {
    describe("staked fees collection", () => {
      it("should track fees as staked and calculate USD correctly when sender is the gauge address", () => {
        const result = processPoolClaim(
          mockEvent,
          gaugeAddress, // sender matches gauge address
          gaugeAddress,
          mockToken0Data,
          mockToken1Data,
        );

        // Calculate expected USD values
        // token0: 1000n (18 decimals) * 1 USD = 1000n USD (normalized to 1e18)
        // token1: 2000n (6 decimals) * 1 USD = 2000n * 10^12 = 2000000000000000n USD (normalized to 1e18)
        // totalFeesUSD = 1000n + 2000000000000000n = 2000000000001000n
        const expectedToken0FeesUSD = 1000n;
        const expectedToken1FeesUSD = 2000000000000000n;
        const expectedTotalFeesUSD =
          expectedToken0FeesUSD + expectedToken1FeesUSD; // 2000000000001000n

        expect(result).toBeDefined();
        expect(result.incrementalTotalStakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(result.incrementalTotalStakedFeesCollected1).toBe(
          mockEvent.params.amount1,
        );
        expect(result.incrementalTotalStakedFeesCollectedUSD).toBe(
          expectedTotalFeesUSD,
        );
        expect(result.incrementalTotalUnstakedFeesCollected0).toBeUndefined();
        expect(result.incrementalTotalUnstakedFeesCollected1).toBeUndefined();
        expect(result.lastUpdatedTimestamp).toEqual(
          new Date(mockEvent.block.timestamp * 1000),
        );
      });
    });

    describe("unstaked fees collection", () => {
      it("should track fees as unstaked and calculate USD correctly when sender is not the gauge address", () => {
        const regularUserAddress = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

        const result = processPoolClaim(
          mockEvent,
          regularUserAddress, // sender does not match gauge address
          gaugeAddress,
          mockToken0Data,
          mockToken1Data,
        );

        // Calculate expected USD values
        const expectedToken0FeesUSD = 1000n;
        const expectedToken1FeesUSD = 2000000000000000n;
        const expectedTotalFeesUSD =
          expectedToken0FeesUSD + expectedToken1FeesUSD; // 2000000000001000n

        expect(result).toBeDefined();
        expect(result.incrementalTotalUnstakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(result.incrementalTotalUnstakedFeesCollected1).toBe(
          mockEvent.params.amount1,
        );
        expect(result.incrementalTotalUnstakedFeesCollectedUSD).toBe(
          expectedTotalFeesUSD,
        );
        expect(result.incrementalTotalStakedFeesCollected0).toBeUndefined();
        expect(result.incrementalTotalStakedFeesCollected1).toBeUndefined();
        expect(result.lastUpdatedTimestamp).toEqual(
          new Date(mockEvent.block.timestamp * 1000),
        );
      });
    });

    describe("edge cases", () => {
      it("should handle case when gauge address is empty string", () => {
        const result = processPoolClaim(
          mockEvent,
          "0x1234567890123456789012345678901234567890",
          "", // empty gauge address
          mockToken0Data,
          mockToken1Data,
        );

        // Should be treated as unstaked since sender !== gaugeAddress
        expect(result.incrementalTotalUnstakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(result.incrementalTotalStakedFeesCollected0).toBeUndefined();
      });

      it("should handle undefined tokens", () => {
        const result = processPoolClaim(
          mockEvent,
          gaugeAddress,
          gaugeAddress,
          undefined,
          undefined,
        );

        expect(result).toBeDefined();
        expect(result.incrementalTotalStakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(result.incrementalTotalStakedFeesCollected1).toBe(
          mockEvent.params.amount1,
        );
        // USD should be 0n when tokens are undefined
        expect(result.incrementalTotalStakedFeesCollectedUSD).toBe(0n);
      });

      it("should handle zero amounts", () => {
        const zeroAmountEvent: Pool_Claim_event = {
          ...mockEvent,
          params: {
            ...mockEvent.params,
            amount0: 0n,
            amount1: 0n,
          },
        };

        const result = processPoolClaim(
          zeroAmountEvent,
          gaugeAddress,
          gaugeAddress,
          mockToken0Data,
          mockToken1Data,
        );

        expect(result.incrementalTotalStakedFeesCollected0).toBe(0n);
        expect(result.incrementalTotalStakedFeesCollected1).toBe(0n);
        expect(result.incrementalTotalStakedFeesCollectedUSD).toBe(0n);
      });
    });

    describe("different token configurations", () => {
      it("should handle tokens with different decimals", () => {
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

        const result = processPoolClaim(
          mockEvent,
          gaugeAddress,
          gaugeAddress,
          tokenWith6Decimals,
          tokenWith18Decimals,
        );

        expect(result).toBeDefined();
        expect(result.incrementalTotalStakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(result.incrementalTotalStakedFeesCollected1).toBe(
          mockEvent.params.amount1,
        );
        // Calculate expected USD values
        // token0: 1000n (6 decimals) * 1 USD = 1000n * 10^12 = 1000000000000000n USD (normalized to 1e18)
        // token1: 2000n (18 decimals) * 2 USD = 2000n * 2 = 4000n USD (normalized to 1e18)
        // totalFeesUSD = 1000000000000000n + 4000n = 1000000000004000n
        const expectedToken0FeesUSD = 1000000000000000n; // 1000n * 10^18 / 10^6 * 1e18 / 1e18 = 1000000000000000n
        const expectedToken1FeesUSD = 4000n; // 2000n * 10^18 / 10^18 * 2e18 / 1e18 = 4000n
        const expectedTotalFeesUSD =
          expectedToken0FeesUSD + expectedToken1FeesUSD; // 1000000000004000n
        expect(result.incrementalTotalStakedFeesCollectedUSD).toBe(
          expectedTotalFeesUSD,
        );
      });

      it("should handle one token undefined", () => {
        const result = processPoolClaim(
          mockEvent,
          gaugeAddress,
          gaugeAddress,
          mockToken0Data,
          undefined,
        );

        expect(result).toBeDefined();
        expect(result.incrementalTotalStakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(result.incrementalTotalStakedFeesCollected1).toBe(
          mockEvent.params.amount1,
        );
        // USD should only include token0 value
        expect(result.incrementalTotalStakedFeesCollectedUSD).toBe(1000n);
      });
    });
  });
});
