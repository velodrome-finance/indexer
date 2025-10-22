import { expect } from "chai";
import type { UserStatsPerPool, handlerContext } from "generated";
import {
  createUserStatsPerPoolEntity,
  updateUserStatsPerPool,
} from "../../src/Aggregators/UserStatsPerPool";
import { toChecksumAddress } from "../../src/Constants";

describe("UserStatsPerPool Aggregator", () => {
  const mockUserAddress = "0x1234567890123456789012345678901234567890";
  const mockPoolAddress = "0xabcdef1234567890abcdef1234567890abcdef12";
  const mockChainId = 10;
  const mockTimestamp = new Date(1000000 * 1000);

  describe("createUserStatsPerPoolEntity", () => {
    it("should create a new user stats entity with correct initial values", () => {
      const userStats = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );

      expect(userStats.id).to.equal(
        `${toChecksumAddress(mockUserAddress)}_${toChecksumAddress(mockPoolAddress)}_${mockChainId}`,
      );
      expect(userStats.userAddress).to.equal(
        toChecksumAddress(mockUserAddress),
      );
      expect(userStats.poolAddress).to.equal(
        toChecksumAddress(mockPoolAddress),
      );
      expect(userStats.chainId).to.equal(mockChainId);
      expect(userStats.currentLiquidityUSD).to.equal(0n);
      expect(userStats.currentLiquidityToken0).to.equal(0n);
      expect(userStats.currentLiquidityToken1).to.equal(0n);
      expect(userStats.totalLiquidityAddedUSD).to.equal(0n);
      expect(userStats.totalLiquidityRemovedUSD).to.equal(0n);
      expect(userStats.totalFeesContributedUSD).to.equal(0n);
      expect(userStats.totalFeesContributed0).to.equal(0n);
      expect(userStats.totalFeesContributed1).to.equal(0n);
      expect(userStats.numberOfSwaps).to.equal(0n);
      expect(userStats.totalSwapVolumeUSD).to.equal(0n);
      expect(userStats.numberOfFlashLoans).to.equal(0n);
      expect(userStats.totalFlashLoanVolumeUSD).to.equal(0n);
      expect(userStats.firstActivityTimestamp).to.deep.equal(mockTimestamp);
      expect(userStats.lastActivityTimestamp).to.deep.equal(mockTimestamp);
    });

    it("should normalize addresses to lowercase", () => {
      const upperCaseUserAddress = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";
      const upperCasePoolAddress = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";
      const userStats = createUserStatsPerPoolEntity(
        upperCaseUserAddress,
        upperCasePoolAddress,
        mockChainId,
        mockTimestamp,
      );

      expect(userStats.userAddress).to.equal(
        toChecksumAddress(upperCaseUserAddress),
      );
      expect(userStats.poolAddress).to.equal(
        toChecksumAddress(upperCasePoolAddress),
      );
    });
  });

  describe("updateUserStatsPerPool", () => {
    let mockContext: handlerContext;

    beforeEach(() => {
      mockContext = {
        UserStatsPerPool: {
          get: async (id: string) => undefined,
          set: async (userStats: UserStatsPerPool) => {},
        },
        log: {
          error: () => {},
          warn: () => {},
          info: () => {},
        },
      } as unknown as handlerContext;
    });

    it("should handle liquidity addition correctly", async () => {
      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const mockUserData = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );

      const netLiquidityAddedUSD = 1000n;
      const diff = { currentLiquidityUSD: netLiquidityAddedUSD };

      const result = await updateUserStatsPerPool(
        diff,
        mockUserData,
        mockTimestamp,
        mockContext,
      );

      expect(result.currentLiquidityUSD).to.equal(netLiquidityAddedUSD);
      expect(result.totalLiquidityAddedUSD).to.equal(netLiquidityAddedUSD);
      expect(result.totalLiquidityRemovedUSD).to.equal(0n);
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
      expect(savedUserStats).to.deep.equal(result);
    });

    it("should handle liquidity removal correctly", async () => {
      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const mockUserData = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );

      const netLiquidityRemovedUSD = -500n;
      const diff = { currentLiquidityUSD: netLiquidityRemovedUSD };

      const result = await updateUserStatsPerPool(
        diff,
        mockUserData,
        mockTimestamp,
        mockContext,
      );

      expect(result.currentLiquidityUSD).to.equal(netLiquidityRemovedUSD);
      expect(result.totalLiquidityAddedUSD).to.equal(0n);
      expect(result.totalLiquidityRemovedUSD).to.equal(500n);
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
    });

    it("should handle fee contributions correctly", async () => {
      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const mockUserData = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );

      const diff = {
        totalFeesContributedUSD: 1000n,
        totalFeesContributed0: 500n,
        totalFeesContributed1: 300n,
      };

      const result = await updateUserStatsPerPool(
        diff,
        mockUserData,
        mockTimestamp,
        mockContext,
      );

      expect(result.totalFeesContributedUSD).to.equal(1000n);
      expect(result.totalFeesContributed0).to.equal(500n);
      expect(result.totalFeesContributed1).to.equal(300n);
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
    });

    it("should handle swap activity correctly", async () => {
      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const mockUserData = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );

      const diff = {
        numberOfSwaps: 1n,
        totalSwapVolumeUSD: 5000n,
      };

      const result = await updateUserStatsPerPool(
        diff,
        mockUserData,
        mockTimestamp,
        mockContext,
      );

      expect(result.numberOfSwaps).to.equal(1n);
      expect(result.totalSwapVolumeUSD).to.equal(5000n);
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
    });

    it("should handle flash loan activity correctly", async () => {
      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const mockUserData = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );

      const diff = {
        numberOfFlashLoans: 1n,
        totalFlashLoanVolumeUSD: 10000n,
      };

      const result = await updateUserStatsPerPool(
        diff,
        mockUserData,
        mockTimestamp,
        mockContext,
      );

      expect(result.numberOfFlashLoans).to.equal(1n);
      expect(result.totalFlashLoanVolumeUSD).to.equal(10000n);
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
    });

    it("should handle multiple field updates in a single call", async () => {
      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const mockUserData = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );

      const diff = {
        currentLiquidityUSD: 2000n,
        totalFeesContributedUSD: 500n,
        numberOfSwaps: 2n,
        totalSwapVolumeUSD: 8000n,
        numberOfFlashLoans: 1n,
        totalFlashLoanVolumeUSD: 15000n,
      };

      const result = await updateUserStatsPerPool(
        diff,
        mockUserData,
        mockTimestamp,
        mockContext,
      );

      expect(result.currentLiquidityUSD).to.equal(2000n);
      expect(result.totalLiquidityAddedUSD).to.equal(2000n);
      expect(result.totalLiquidityRemovedUSD).to.equal(0n);
      expect(result.totalFeesContributedUSD).to.equal(500n);
      expect(result.numberOfSwaps).to.equal(2n);
      expect(result.totalSwapVolumeUSD).to.equal(8000n);
      expect(result.numberOfFlashLoans).to.equal(1n);
      expect(result.totalFlashLoanVolumeUSD).to.equal(15000n);
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
    });

    it("should update existing user stats correctly", async () => {
      const existingUserStats: UserStatsPerPool = {
        id: `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
        userAddress: mockUserAddress.toLowerCase(),
        poolAddress: mockPoolAddress.toLowerCase(),
        chainId: mockChainId,
        currentLiquidityUSD: 2000n,
        currentLiquidityToken0: 1000n,
        currentLiquidityToken1: 1000n,
        totalLiquidityAddedUSD: 2000n,
        totalLiquidityRemovedUSD: 0n,
        totalFeesContributedUSD: 1000n,
        totalFeesContributed0: 500n,
        totalFeesContributed1: 300n,
        numberOfSwaps: 5n,
        totalSwapVolumeUSD: 10000n,
        numberOfFlashLoans: 2n,
        totalFlashLoanVolumeUSD: 20000n,
        numberOfGaugeDeposits: 0n,
        numberOfGaugeWithdrawals: 0n,
        numberOfGaugeRewardClaims: 0n,
        totalGaugeRewardsClaimedUSD: 0n,
        totalGaugeRewardsClaimed: 0n,
        currentLiquidityStakedUSD: 0n,
        firstActivityTimestamp: new Date(500000 * 1000),
        lastActivityTimestamp: new Date(800000 * 1000),
        currentVotingPower: 0n,
        numberOfVotes: 0n,
      };

      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        get: async (id: string) => existingUserStats,
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const diff = {
        currentLiquidityUSD: 1000n, // Adding more liquidity
        totalFeesContributedUSD: 500n,
        numberOfSwaps: 1n,
        totalSwapVolumeUSD: 3000n,
      };

      const result = await updateUserStatsPerPool(
        diff,
        existingUserStats,
        mockTimestamp,
        mockContext,
      );

      expect(result.currentLiquidityUSD).to.equal(3000n); // 2000 + 1000
      expect(result.totalLiquidityAddedUSD).to.equal(3000n); // 2000 + 1000
      expect(result.totalLiquidityRemovedUSD).to.equal(0n); // No removal
      expect(result.totalFeesContributedUSD).to.equal(1500n); // 1000 + 500
      expect(result.numberOfSwaps).to.equal(6n); // 5 + 1
      expect(result.totalSwapVolumeUSD).to.equal(13000n); // 10000 + 3000
      expect(result.numberOfFlashLoans).to.equal(2n); // Unchanged
      expect(result.totalFlashLoanVolumeUSD).to.equal(20000n); // Unchanged
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
    });

    it("should handle liquidity removal from existing stats", async () => {
      const existingUserStats: UserStatsPerPool = {
        id: `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
        userAddress: mockUserAddress.toLowerCase(),
        poolAddress: mockPoolAddress.toLowerCase(),
        chainId: mockChainId,
        currentLiquidityUSD: 2000n,
        currentLiquidityToken0: 1000n,
        currentLiquidityToken1: 1000n,
        totalLiquidityAddedUSD: 2000n,
        totalLiquidityRemovedUSD: 0n,
        totalFeesContributedUSD: 1000n,
        totalFeesContributed0: 500n,
        totalFeesContributed1: 300n,
        numberOfSwaps: 5n,
        totalSwapVolumeUSD: 10000n,
        numberOfFlashLoans: 2n,
        totalFlashLoanVolumeUSD: 20000n,
        numberOfGaugeDeposits: 0n,
        numberOfGaugeWithdrawals: 0n,
        numberOfGaugeRewardClaims: 0n,
        totalGaugeRewardsClaimedUSD: 0n,
        totalGaugeRewardsClaimed: 0n,
        currentLiquidityStakedUSD: 0n,
        firstActivityTimestamp: new Date(500000 * 1000),
        lastActivityTimestamp: new Date(800000 * 1000),
        currentVotingPower: 0n,
        numberOfVotes: 0n,
      };

      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        get: async (id: string) => existingUserStats,
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const diff = {
        currentLiquidityUSD: -500n, // Removing liquidity
      };

      const result = await updateUserStatsPerPool(
        diff,
        existingUserStats,
        mockTimestamp,
        mockContext,
      );

      expect(result.currentLiquidityUSD).to.equal(1500n); // 2000 - 500
      expect(result.totalLiquidityAddedUSD).to.equal(2000n); // Unchanged
      expect(result.totalLiquidityRemovedUSD).to.equal(500n); // 0 + 500
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
    });
  });
});
