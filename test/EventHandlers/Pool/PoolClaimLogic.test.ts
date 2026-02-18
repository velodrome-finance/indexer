import type { Pool_Claim_event } from "generated";
import { toChecksumAddress } from "../../../src/Constants";
import { processPoolClaim } from "../../../src/EventHandlers/Pool/PoolClaimLogic";
import { calculateTotalUSD } from "../../../src/Helpers";
import { setupCommon } from "./common";

describe("PoolClaimLogic", () => {
  let common: ReturnType<typeof setupCommon>;

  beforeEach(() => {
    common = setupCommon();
  });

  const mockEvent: Pool_Claim_event = {
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
      sender: toChecksumAddress("0x1234567890123456789012345678901234567890"),
      recipient: toChecksumAddress(
        "0x9876543210987654321098765432109876543210",
      ),
      amount0: 1000n,
      amount1: 2000n,
    },
  };

  const gaugeAddress = toChecksumAddress(
    "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );

  describe("processPoolClaim", () => {
    describe("staked fees collection", () => {
      it("should track fees as staked and calculate USD correctly when sender is the gauge address", () => {
        // Arrange
        const expectedTotalFeesUSD = calculateTotalUSD(
          mockEvent.params.amount0,
          mockEvent.params.amount1,
          common.mockToken0Data,
          common.mockToken1Data,
        );

        // Act
        const result = processPoolClaim(
          mockEvent,
          gaugeAddress,
          gaugeAddress,
          common.mockToken0Data,
          common.mockToken1Data,
        );

        // Assert
        expect(result).toBeDefined();
        const pool = result.poolDiff;
        expect(pool.incrementalTotalStakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(pool.incrementalTotalStakedFeesCollected1).toBe(
          mockEvent.params.amount1,
        );
        expect(pool.incrementalTotalStakedFeesCollectedUSD).toBe(
          expectedTotalFeesUSD,
        );
        expect(pool.incrementalTotalUnstakedFeesCollected0).toBeUndefined();
        expect(pool.incrementalTotalUnstakedFeesCollected1).toBeUndefined();
        expect(pool.lastUpdatedTimestamp).toEqual(
          new Date(mockEvent.block.timestamp * 1000),
        );
        const user = result.userDiff;
        expect(user).toBeDefined();
        expect(user?.incrementalTotalStakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(user?.incrementalTotalStakedFeesCollected1).toBe(
          mockEvent.params.amount1,
        );
        expect(user?.incrementalTotalStakedFeesCollectedUSD).toBe(
          expectedTotalFeesUSD,
        );
      });
    });

    describe("unstaked fees collection", () => {
      it("should track fees as unstaked and calculate USD correctly when sender is not the gauge address", () => {
        // Arrange
        const regularUserAddress = toChecksumAddress(
          "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        );
        const expectedTotalFeesUSD = calculateTotalUSD(
          mockEvent.params.amount0,
          mockEvent.params.amount1,
          common.mockToken0Data,
          common.mockToken1Data,
        );

        // Act
        const result = processPoolClaim(
          mockEvent,
          regularUserAddress,
          gaugeAddress,
          common.mockToken0Data,
          common.mockToken1Data,
        );

        // Assert
        expect(result).toBeDefined();
        const pool = result.poolDiff;
        expect(pool.incrementalTotalUnstakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(pool.incrementalTotalUnstakedFeesCollected1).toBe(
          mockEvent.params.amount1,
        );
        expect(pool.incrementalTotalUnstakedFeesCollectedUSD).toBe(
          expectedTotalFeesUSD,
        );
        expect(pool.incrementalTotalStakedFeesCollected0).toBeUndefined();
        expect(pool.incrementalTotalStakedFeesCollected1).toBeUndefined();
        expect(pool.lastUpdatedTimestamp).toEqual(
          new Date(mockEvent.block.timestamp * 1000),
        );
        const user = result.userDiff;
        expect(user).toBeDefined();
        expect(user?.incrementalTotalUnstakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(user?.incrementalTotalUnstakedFeesCollected1).toBe(
          mockEvent.params.amount1,
        );
        expect(user?.incrementalTotalUnstakedFeesCollectedUSD).toBe(
          expectedTotalFeesUSD,
        );
      });
    });

    describe("edge cases", () => {
      it("should handle case when gauge address is empty string", () => {
        // Act
        const result = processPoolClaim(
          mockEvent,
          toChecksumAddress("0x1234567890123456789012345678901234567890"),
          "",
          common.mockToken0Data,
          common.mockToken1Data,
        );

        // Assert: treated as unstaked since sender !== gaugeAddress
        expect(result.poolDiff.incrementalTotalUnstakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(
          result.poolDiff.incrementalTotalStakedFeesCollected0,
        ).toBeUndefined();
      });

      it("should handle undefined tokens", () => {
        // Act
        const result = processPoolClaim(
          mockEvent,
          gaugeAddress,
          gaugeAddress,
          undefined,
          undefined,
        );

        // Assert
        expect(result).toBeDefined();
        const pool = result.poolDiff;
        expect(pool.incrementalTotalStakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(pool.incrementalTotalStakedFeesCollected1).toBe(
          mockEvent.params.amount1,
        );
        expect(pool.incrementalTotalStakedFeesCollectedUSD).toBe(0n);
      });

      it("should handle zero amounts", () => {
        // Arrange
        const zeroAmountEvent: Pool_Claim_event = {
          ...mockEvent,
          params: {
            ...mockEvent.params,
            amount0: 0n,
            amount1: 0n,
          },
        };

        // Act
        const result = processPoolClaim(
          zeroAmountEvent,
          gaugeAddress,
          gaugeAddress,
          common.mockToken0Data,
          common.mockToken1Data,
        );

        // Assert
        expect(result.poolDiff.incrementalTotalStakedFeesCollected0).toBe(0n);
        expect(result.poolDiff.incrementalTotalStakedFeesCollected1).toBe(0n);
        expect(result.poolDiff.incrementalTotalStakedFeesCollectedUSD).toBe(0n);
      });
    });

    describe("different token configurations", () => {
      it("should handle tokens with different decimals", () => {
        // Arrange
        const tokenWith6Decimals = common.createMockToken({
          decimals: 6n,
          pricePerUSDNew: 1000000000000000000n,
        });
        const tokenWith18Decimals = common.createMockToken(
          {
            decimals: 18n,
            pricePerUSDNew: 2000000000000000000n,
          },
          common.mockToken1Data,
        );
        const expectedTotalFeesUSD = calculateTotalUSD(
          mockEvent.params.amount0,
          mockEvent.params.amount1,
          tokenWith6Decimals,
          tokenWith18Decimals,
        );

        // Act
        const result = processPoolClaim(
          mockEvent,
          gaugeAddress,
          gaugeAddress,
          tokenWith6Decimals,
          tokenWith18Decimals,
        );

        // Assert
        expect(result).toBeDefined();
        const pool = result.poolDiff;
        expect(pool.incrementalTotalStakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(pool.incrementalTotalStakedFeesCollected1).toBe(
          mockEvent.params.amount1,
        );
        expect(pool.incrementalTotalStakedFeesCollectedUSD).toBe(
          expectedTotalFeesUSD,
        );
      });

      it("should handle one token undefined", () => {
        const expectedUSD = calculateTotalUSD(
          mockEvent.params.amount0,
          mockEvent.params.amount1,
          common.mockToken0Data,
          undefined,
        );

        // Act
        const result = processPoolClaim(
          mockEvent,
          gaugeAddress,
          gaugeAddress,
          common.mockToken0Data,
          undefined,
        );

        // Assert: USD includes only token0 value
        expect(result).toBeDefined();
        const pool = result.poolDiff;
        expect(pool.incrementalTotalStakedFeesCollected0).toBe(
          mockEvent.params.amount0,
        );
        expect(pool.incrementalTotalStakedFeesCollected1).toBe(
          mockEvent.params.amount1,
        );
        expect(pool.incrementalTotalStakedFeesCollectedUSD).toBe(expectedUSD);
      });
    });
  });
});
