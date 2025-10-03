import { expect } from "chai";
import type { UserStatsPerPool, handlerContext } from "generated";
import {
  createUserStatsPerPoolEntity,
  updateUserPoolFeeContribution,
  updateUserPoolLiquidityActivity,
  updateUserPoolSwapActivity,
} from "../../src/Aggregators/UserStatsPerPool";

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
        `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
      );
      expect(userStats.userAddress).to.equal(mockUserAddress.toLowerCase());
      expect(userStats.poolAddress).to.equal(mockPoolAddress.toLowerCase());
      expect(userStats.chainId).to.equal(mockChainId);
      expect(userStats.currentLiquidityUSD).to.equal(0n);
      expect(userStats.totalLiquidityAddedUSD).to.equal(0n);
      expect(userStats.totalLiquidityRemovedUSD).to.equal(0n);
      expect(userStats.totalFeesContributedUSD).to.equal(0n);
      expect(userStats.totalFeesContributed0).to.equal(0n);
      expect(userStats.totalFeesContributed1).to.equal(0n);
      expect(userStats.numberOfSwaps).to.equal(0n);
      expect(userStats.totalSwapVolumeUSD).to.equal(0n);
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
        upperCaseUserAddress.toLowerCase(),
      );
      expect(userStats.poolAddress).to.equal(
        upperCasePoolAddress.toLowerCase(),
      );
    });
  });

  describe("updateUserPoolLiquidityActivity", () => {
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

    it("should create new user stats when user does not exist", async () => {
      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const netLiquidityAddedUSD = 1000n;

      const mockUserData = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );

      const result = await updateUserPoolLiquidityActivity(
        mockUserData,
        netLiquidityAddedUSD,
        mockTimestamp,
        mockContext,
      );

      expect(result).to.not.be.undefined;
      expect(result.userAddress).to.equal(mockUserAddress.toLowerCase());
      expect(result.poolAddress).to.equal(mockPoolAddress.toLowerCase());
      expect(result.chainId).to.equal(mockChainId);
      expect(result.currentLiquidityUSD).to.equal(netLiquidityAddedUSD);
      expect(result.totalLiquidityAddedUSD).to.equal(netLiquidityAddedUSD);
      expect(result.totalLiquidityRemovedUSD).to.equal(0n);
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
      expect(savedUserStats).to.deep.equal(result);
    });

    it("should handle liquidity removal (negative netLiquidityAddedUSD)", async () => {
      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const netLiquidityRemovedUSD = -500n;

      const mockUserData = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );

      const result = await updateUserPoolLiquidityActivity(
        mockUserData,
        netLiquidityRemovedUSD,
        mockTimestamp,
        mockContext,
      );

      expect(result.currentLiquidityUSD).to.equal(netLiquidityRemovedUSD);
      expect(result.totalLiquidityAddedUSD).to.equal(0n);
      expect(result.totalLiquidityRemovedUSD).to.equal(500n);
    });

    it("should update existing user stats with additional liquidity activity", async () => {
      const existingUserStats: UserStatsPerPool = {
        id: `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
        userAddress: mockUserAddress.toLowerCase(),
        poolAddress: mockPoolAddress.toLowerCase(),
        chainId: mockChainId,
        currentLiquidityUSD: 2000n,
        totalLiquidityAddedUSD: 2000n,
        totalLiquidityRemovedUSD: 0n,
        totalFeesContributedUSD: 1000n,
        totalFeesContributed0: 500n,
        totalFeesContributed1: 300n,
        numberOfSwaps: 5n,
        totalSwapVolumeUSD: 10000n,
        firstActivityTimestamp: new Date(500000 * 1000),
        lastActivityTimestamp: new Date(800000 * 1000),
      };

      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        get: async (id: string) => existingUserStats,
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const additionalLiquidityUSD = 1000n;

      const result = await updateUserPoolLiquidityActivity(
        existingUserStats,
        additionalLiquidityUSD,
        mockTimestamp,
        mockContext,
      );

      expect(result.currentLiquidityUSD).to.equal(
        existingUserStats.currentLiquidityUSD + additionalLiquidityUSD,
      );
      expect(result.totalLiquidityAddedUSD).to.equal(
        existingUserStats.totalLiquidityAddedUSD + additionalLiquidityUSD,
      );
      expect(result.totalLiquidityRemovedUSD).to.equal(
        existingUserStats.totalLiquidityRemovedUSD,
      );
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
    });
  });

  describe("updateUserPoolFeeContribution", () => {
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

    it("should create new user stats when user does not exist", async () => {
      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const feesContributedUSD = 1000n;
      const feesContributed0 = 500n;
      const feesContributed1 = 300n;

      const mockUserData = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );

      const result = await updateUserPoolFeeContribution(
        mockUserData,
        feesContributedUSD,
        feesContributed0,
        feesContributed1,
        mockTimestamp,
        mockContext,
      );

      expect(result).to.not.be.undefined;
      expect(result.userAddress).to.equal(mockUserAddress.toLowerCase());
      expect(result.poolAddress).to.equal(mockPoolAddress.toLowerCase());
      expect(result.chainId).to.equal(mockChainId);
      expect(result.totalFeesContributedUSD).to.equal(feesContributedUSD);
      expect(result.totalFeesContributed0).to.equal(feesContributed0);
      expect(result.totalFeesContributed1).to.equal(feesContributed1);
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
      expect(savedUserStats).to.deep.equal(result);
    });

    it("should update existing user stats with additional fee contributions", async () => {
      const existingUserStats: UserStatsPerPool = {
        id: `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
        userAddress: mockUserAddress.toLowerCase(),
        poolAddress: mockPoolAddress.toLowerCase(),
        chainId: mockChainId,
        currentLiquidityUSD: 2000n,
        totalLiquidityAddedUSD: 2000n,
        totalLiquidityRemovedUSD: 0n,
        totalFeesContributedUSD: 2000n,
        totalFeesContributed0: 1000n,
        totalFeesContributed1: 800n,
        numberOfSwaps: 5n,
        totalSwapVolumeUSD: 10000n,
        firstActivityTimestamp: new Date(500000 * 1000),
        lastActivityTimestamp: new Date(800000 * 1000),
      };

      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        get: async (id: string) => existingUserStats,
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const additionalFeesUSD = 500n;
      const additionalFees0 = 200n;
      const additionalFees1 = 150n;

      const result = await updateUserPoolFeeContribution(
        existingUserStats,
        additionalFeesUSD,
        additionalFees0,
        additionalFees1,
        mockTimestamp,
        mockContext,
      );

      expect(result.totalFeesContributedUSD).to.equal(
        existingUserStats.totalFeesContributedUSD + additionalFeesUSD,
      );
      expect(result.totalFeesContributed0).to.equal(
        existingUserStats.totalFeesContributed0 + additionalFees0,
      );
      expect(result.totalFeesContributed1).to.equal(
        existingUserStats.totalFeesContributed1 + additionalFees1,
      );
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
    });
  });

  describe("updateUserPoolSwapActivity", () => {
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

    it("should create new user stats when user does not exist", async () => {
      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const swapVolumeUSD = 5000n;

      const mockUserData = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );

      const result = await updateUserPoolSwapActivity(
        mockUserData,
        swapVolumeUSD,
        mockTimestamp,
        mockContext,
      );

      expect(result).to.not.be.undefined;
      expect(result.userAddress).to.equal(mockUserAddress.toLowerCase());
      expect(result.poolAddress).to.equal(mockPoolAddress.toLowerCase());
      expect(result.chainId).to.equal(mockChainId);
      expect(result.numberOfSwaps).to.equal(1n);
      expect(result.totalSwapVolumeUSD).to.equal(swapVolumeUSD);
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
      expect(savedUserStats).to.deep.equal(result);
    });

    it("should update existing user stats with additional swap activity", async () => {
      const existingUserStats: UserStatsPerPool = {
        id: `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
        userAddress: mockUserAddress.toLowerCase(),
        poolAddress: mockPoolAddress.toLowerCase(),
        chainId: mockChainId,
        currentLiquidityUSD: 2000n,
        totalLiquidityAddedUSD: 2000n,
        totalLiquidityRemovedUSD: 0n,
        totalFeesContributedUSD: 1000n,
        totalFeesContributed0: 500n,
        totalFeesContributed1: 300n,
        numberOfSwaps: 5n,
        totalSwapVolumeUSD: 10000n,
        firstActivityTimestamp: new Date(500000 * 1000),
        lastActivityTimestamp: new Date(800000 * 1000),
      };

      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        get: async (id: string) => existingUserStats,
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const additionalSwapVolumeUSD = 3000n;

      const result = await updateUserPoolSwapActivity(
        existingUserStats,
        additionalSwapVolumeUSD,
        mockTimestamp,
        mockContext,
      );

      expect(result.numberOfSwaps).to.equal(
        existingUserStats.numberOfSwaps + 1n,
      );
      expect(result.totalSwapVolumeUSD).to.equal(
        existingUserStats.totalSwapVolumeUSD + additionalSwapVolumeUSD,
      );
      expect(result.lastActivityTimestamp).to.deep.equal(mockTimestamp);
    });
  });
});
