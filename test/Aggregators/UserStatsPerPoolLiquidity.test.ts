import { expect } from "chai";
import type { UserStatsPerPool, handlerContext } from "generated";
import { updateUserStatsPerPool } from "../../src/Aggregators/UserStatsPerPool";

describe("UserStatsPerPool Liquidity Logic", () => {
  const mockUserAddress = "0x1234567890123456789012345678901234567890";
  const mockPoolAddress = "0xabcdef1234567890abcdef1234567890abcdef12";
  const mockChainId = 10;
  const mockTimestamp = new Date(1000000 * 1000);

  const createMockUserStats = (): UserStatsPerPool => ({
    id: `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
    userAddress: mockUserAddress.toLowerCase(),
    poolAddress: mockPoolAddress.toLowerCase(),
    chainId: mockChainId,
    currentLiquidityUSD: 0n,
    currentLiquidityToken0: 0n,
    currentLiquidityToken1: 0n,
    totalLiquidityAddedUSD: 0n,
    totalLiquidityRemovedUSD: 0n,
    totalFeesContributedUSD: 0n,
    totalFeesContributed0: 0n,
    totalFeesContributed1: 0n,
    numberOfSwaps: 0n,
    totalSwapVolumeUSD: 0n,
    numberOfFlashLoans: 0n,
    totalFlashLoanVolumeUSD: 0n,
    numberOfGaugeDeposits: 0n,
    numberOfGaugeWithdrawals: 0n,
    numberOfGaugeRewardClaims: 0n,
    totalGaugeRewardsClaimedUSD: 0n,
    totalGaugeRewardsClaimed: 0n,
    currentLiquidityStakedUSD: 0n,
    numberOfVotes: 0n,
    currentVotingPower: 0n,

    // Voting Reward Claims
    totalBribeClaimed: 0n,
    totalBribeClaimedUSD: 0n,
    totalFeeRewardClaimed: 0n,
    totalFeeRewardClaimedUSD: 0n,
    veNFTamountStaked: 0n,

    firstActivityTimestamp: mockTimestamp,
    lastActivityTimestamp: mockTimestamp,
  });

  describe("Liquidity Addition Logic", () => {
    it("should handle positive liquidity addition correctly", async () => {
      const mockContext = {
        UserStatsPerPool: {
          set: async () => {},
        },
        log: {
          error: () => {},
          warn: () => {},
          info: () => {},
        },
      } as unknown as handlerContext;

      const userStats = createMockUserStats();
      const netLiquidityAddedUSD = 1000n;

      const result = await updateUserStatsPerPool(
        { currentLiquidityUSD: netLiquidityAddedUSD },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(result.currentLiquidityUSD).to.equal(1000n);
      expect(result.totalLiquidityAddedUSD).to.equal(1000n);
      expect(result.totalLiquidityRemovedUSD).to.equal(0n);
    });

    it("should handle multiple liquidity additions correctly", async () => {
      const mockContext = {
        UserStatsPerPool: {
          set: async () => {},
        },
        log: {
          error: () => {},
          warn: () => {},
          info: () => {},
        },
      } as unknown as handlerContext;

      let userStats = createMockUserStats();

      // First addition
      userStats = await updateUserStatsPerPool(
        { currentLiquidityUSD: 1000n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).to.equal(1000n);
      expect(userStats.totalLiquidityAddedUSD).to.equal(1000n);
      expect(userStats.totalLiquidityRemovedUSD).to.equal(0n);

      // Second addition
      userStats = await updateUserStatsPerPool(
        { currentLiquidityUSD: 500n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).to.equal(1500n);
      expect(userStats.totalLiquidityAddedUSD).to.equal(1500n);
      expect(userStats.totalLiquidityRemovedUSD).to.equal(0n);
    });
  });

  describe("Liquidity Removal Logic", () => {
    it("should handle negative liquidity removal correctly", async () => {
      const mockContext = {
        UserStatsPerPool: {
          set: async () => {},
        },
        log: {
          error: () => {},
          warn: () => {},
          info: () => {},
        },
      } as unknown as handlerContext;

      const userStats = createMockUserStats();
      const netLiquidityRemovedUSD = -500n;

      const result = await updateUserStatsPerPool(
        { currentLiquidityUSD: netLiquidityRemovedUSD },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(result.currentLiquidityUSD).to.equal(-500n);
      expect(result.totalLiquidityAddedUSD).to.equal(0n);
      expect(result.totalLiquidityRemovedUSD).to.equal(500n);
    });

    it("should handle multiple liquidity removals correctly", async () => {
      const mockContext = {
        UserStatsPerPool: {
          set: async () => {},
        },
        log: {
          error: () => {},
          warn: () => {},
          info: () => {},
        },
      } as unknown as handlerContext;

      let userStats = createMockUserStats();

      // First removal
      userStats = await updateUserStatsPerPool(
        { currentLiquidityUSD: -300n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).to.equal(-300n);
      expect(userStats.totalLiquidityAddedUSD).to.equal(0n);
      expect(userStats.totalLiquidityRemovedUSD).to.equal(300n);

      // Second removal
      userStats = await updateUserStatsPerPool(
        { currentLiquidityUSD: -200n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).to.equal(-500n);
      expect(userStats.totalLiquidityAddedUSD).to.equal(0n);
      expect(userStats.totalLiquidityRemovedUSD).to.equal(500n);
    });
  });

  describe("Mixed Liquidity Operations", () => {
    it("should handle adding then removing liquidity correctly", async () => {
      const mockContext = {
        UserStatsPerPool: {
          set: async () => {},
        },
        log: {
          error: () => {},
          warn: () => {},
          info: () => {},
        },
      } as unknown as handlerContext;

      let userStats = createMockUserStats();

      // Add liquidity
      userStats = await updateUserStatsPerPool(
        { currentLiquidityUSD: 1000n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).to.equal(1000n);
      expect(userStats.totalLiquidityAddedUSD).to.equal(1000n);
      expect(userStats.totalLiquidityRemovedUSD).to.equal(0n);

      // Remove some liquidity
      userStats = await updateUserStatsPerPool(
        { currentLiquidityUSD: -300n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).to.equal(700n);
      expect(userStats.totalLiquidityAddedUSD).to.equal(1000n);
      expect(userStats.totalLiquidityRemovedUSD).to.equal(300n);
    });

    it("should handle removing then adding liquidity correctly", async () => {
      const mockContext = {
        UserStatsPerPool: {
          set: async () => {},
        },
        log: {
          error: () => {},
          warn: () => {},
          info: () => {},
        },
      } as unknown as handlerContext;

      let userStats = createMockUserStats();

      // Remove liquidity (should be 0 since we start with 0)
      userStats = await updateUserStatsPerPool(
        { currentLiquidityUSD: -500n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).to.equal(-500n);
      expect(userStats.totalLiquidityAddedUSD).to.equal(0n);
      expect(userStats.totalLiquidityRemovedUSD).to.equal(500n);

      // Add liquidity
      userStats = await updateUserStatsPerPool(
        { currentLiquidityUSD: 800n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).to.equal(300n);
      expect(userStats.totalLiquidityAddedUSD).to.equal(800n);
      expect(userStats.totalLiquidityRemovedUSD).to.equal(500n);
    });

    it("should handle complex liquidity operations correctly", async () => {
      const mockContext = {
        UserStatsPerPool: {
          set: async () => {},
        },
        log: {
          error: () => {},
          warn: () => {},
          info: () => {},
        },
      } as unknown as handlerContext;

      let userStats = createMockUserStats();

      // Add 1000
      userStats = await updateUserStatsPerPool(
        { currentLiquidityUSD: 1000n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      // Remove 200
      userStats = await updateUserStatsPerPool(
        { currentLiquidityUSD: -200n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      // Add 500
      userStats = await updateUserStatsPerPool(
        { currentLiquidityUSD: 500n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      // Remove 100
      userStats = await updateUserStatsPerPool(
        { currentLiquidityUSD: -100n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).to.equal(1200n); // 1000 - 200 + 500 - 100
      expect(userStats.totalLiquidityAddedUSD).to.equal(1500n); // 1000 + 500
      expect(userStats.totalLiquidityRemovedUSD).to.equal(300n); // 200 + 100
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero liquidity change", async () => {
      const mockContext = {
        UserStatsPerPool: {
          set: async () => {},
        },
        log: {
          error: () => {},
          warn: () => {},
          info: () => {},
        },
      } as unknown as handlerContext;

      const userStats = createMockUserStats();
      const result = await updateUserStatsPerPool(
        { currentLiquidityUSD: 0n },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(result.currentLiquidityUSD).to.equal(0n);
      expect(result.totalLiquidityAddedUSD).to.equal(0n);
      expect(result.totalLiquidityRemovedUSD).to.equal(0n);
    });

    it("should handle very large liquidity amounts", async () => {
      const mockContext = {
        UserStatsPerPool: {
          set: async () => {},
        },
        log: {
          error: () => {},
          warn: () => {},
          info: () => {},
        },
      } as unknown as handlerContext;

      const userStats = createMockUserStats();
      const largeAmount = BigInt("1000000000000000000000000"); // 1M tokens with 18 decimals

      const result = await updateUserStatsPerPool(
        { currentLiquidityUSD: largeAmount },
        userStats,
        mockTimestamp,
        mockContext,
      );

      expect(result.currentLiquidityUSD).to.equal(largeAmount);
      expect(result.totalLiquidityAddedUSD).to.equal(largeAmount);
      expect(result.totalLiquidityRemovedUSD).to.equal(0n);
    });
  });
});
