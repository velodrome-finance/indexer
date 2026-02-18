import type { UserStatsPerPool, handlerContext } from "generated";
import {
  createUserStatsPerPoolEntity,
  updateUserStatsPerPool,
} from "../../src/Aggregators/UserStatsPerPool";
import { UserStatsPerPoolId, toChecksumAddress } from "../../src/Constants";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("UserStatsPerPool Aggregator", () => {
  const mockUserAddress = toChecksumAddress(
    "0x1234567890123456789012345678901234567890",
  );
  const mockPoolAddress = toChecksumAddress(
    "0xabcdef1234567890abcdef1234567890abcdef12",
  );
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

      expect(userStats.id).toBe(
        UserStatsPerPoolId(mockChainId, mockUserAddress, mockPoolAddress),
      );
      expect(userStats.userAddress).toBe(mockUserAddress);
      expect(userStats.poolAddress).toBe(mockPoolAddress);
      expect(userStats.chainId).toBe(mockChainId);
      expect(userStats.currentLiquidityUSD).toBe(0n);
      expect(userStats.totalLiquidityAddedUSD).toBe(0n);
      expect(userStats.totalLiquidityRemovedUSD).toBe(0n);
      expect(userStats.totalFeesContributedUSD).toBe(0n);
      expect(userStats.totalFeesContributed0).toBe(0n);
      expect(userStats.totalFeesContributed1).toBe(0n);
      expect(userStats.numberOfSwaps).toBe(0n);
      expect(userStats.totalSwapVolumeUSD).toBe(0n);
      expect(userStats.numberOfFlashLoans).toBe(0n);
      expect(userStats.totalFlashLoanVolumeUSD).toBe(0n);
      expect(userStats.firstActivityTimestamp).toEqual(mockTimestamp);
      expect(userStats.lastActivityTimestamp).toEqual(mockTimestamp);
      expect(userStats.lastSnapshotTimestamp).toBeUndefined();
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
        UserStatsPerPoolSnapshot: {
          set: jest.fn(),
        } as unknown as handlerContext["UserStatsPerPoolSnapshot"],
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
      const diff = {
        incrementalCurrentLiquidityUSD: netLiquidityAddedUSD,
        incrementalTotalLiquidityAddedUSD: netLiquidityAddedUSD,
        lastActivityTimestamp: mockTimestamp,
      };

      const result = await updateUserStatsPerPool(
        diff,
        mockUserData,
        mockContext,
        mockTimestamp,
      );

      expect(result.currentLiquidityUSD).toBe(netLiquidityAddedUSD);
      expect(result.totalLiquidityAddedUSD).toBe(netLiquidityAddedUSD);
      expect(result.totalLiquidityRemovedUSD).toBe(0n);
      expect(result.lastActivityTimestamp).toEqual(mockTimestamp);
      expect(savedUserStats).toEqual(result);
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
      const diff = {
        incrementalCurrentLiquidityUSD: netLiquidityRemovedUSD,
        incrementalTotalLiquidityRemovedUSD: 500n,
        lastActivityTimestamp: mockTimestamp,
      };

      const result = await updateUserStatsPerPool(
        diff,
        mockUserData,
        mockContext,
        mockTimestamp,
      );

      expect(result.currentLiquidityUSD).toBe(netLiquidityRemovedUSD);
      expect(result.totalLiquidityAddedUSD).toBe(0n);
      expect(result.totalLiquidityRemovedUSD).toBe(500n);
      expect(result.lastActivityTimestamp).toEqual(mockTimestamp);
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
        incrementalTotalFeesContributedUSD: 1000n,
        incrementalTotalFeesContributed0: 500n,
        incrementalTotalFeesContributed1: 300n,
        lastActivityTimestamp: mockTimestamp,
      };

      const result = await updateUserStatsPerPool(
        diff,
        mockUserData,
        mockContext,
        mockTimestamp,
      );

      expect(result.totalFeesContributedUSD).toBe(1000n);
      expect(result.totalFeesContributed0).toBe(500n);
      expect(result.totalFeesContributed1).toBe(300n);
      expect(result.lastActivityTimestamp).toEqual(mockTimestamp);
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
        incrementalNumberOfSwaps: 1n,
        incrementalTotalSwapVolumeUSD: 5000n,
        incrementalTotalSwapVolumeAmount0: 1000n,
        incrementalTotalSwapVolumeAmount1: 2000n,
        lastActivityTimestamp: mockTimestamp,
      };

      const result = await updateUserStatsPerPool(
        diff,
        mockUserData,
        mockContext,
        mockTimestamp,
      );

      expect(result.numberOfSwaps).toBe(1n);
      expect(result.totalSwapVolumeUSD).toBe(5000n);
      expect(result.totalSwapVolumeAmount0).toBe(1000n);
      expect(result.totalSwapVolumeAmount1).toBe(2000n);
      expect(result.lastActivityTimestamp).toEqual(mockTimestamp);
    });

    it("should aggregate multiple swaps correctly", async () => {
      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      let userStats = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );

      // First swap: amount0 = 1000, amount1 = -2000
      userStats = await updateUserStatsPerPool(
        {
          incrementalNumberOfSwaps: 1n,
          incrementalTotalSwapVolumeUSD: 5000n,
          incrementalTotalSwapVolumeAmount0: 1000n, // abs(1000)
          incrementalTotalSwapVolumeAmount1: 2000n, // abs(-2000)
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(userStats.numberOfSwaps).toBe(1n);
      expect(userStats.totalSwapVolumeAmount0).toBe(1000n);
      expect(userStats.totalSwapVolumeAmount1).toBe(2000n);
      expect(userStats.totalSwapVolumeUSD).toBe(5000n);

      // Second swap: amount0 = -500, amount1 = 3000
      userStats = await updateUserStatsPerPool(
        {
          incrementalNumberOfSwaps: 1n,
          incrementalTotalSwapVolumeUSD: 8000n,
          incrementalTotalSwapVolumeAmount0: 500n, // abs(-500)
          incrementalTotalSwapVolumeAmount1: 3000n, // abs(3000)
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(userStats.numberOfSwaps).toBe(2n);
      expect(userStats.totalSwapVolumeAmount0).toBe(1500n); // 1000 + 500
      expect(userStats.totalSwapVolumeAmount1).toBe(5000n); // 2000 + 3000
      expect(userStats.totalSwapVolumeUSD).toBe(13000n); // 5000 + 8000

      // Third swap: amount0 = -2500, amount1 = -1500
      userStats = await updateUserStatsPerPool(
        {
          incrementalNumberOfSwaps: 1n,
          incrementalTotalSwapVolumeUSD: 12000n,
          incrementalTotalSwapVolumeAmount0: 2500n, // abs(-2500)
          incrementalTotalSwapVolumeAmount1: 1500n, // abs(-1500)
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(userStats.numberOfSwaps).toBe(3n);
      expect(userStats.totalSwapVolumeAmount0).toBe(4000n); // 1000 + 500 + 2500
      expect(userStats.totalSwapVolumeAmount1).toBe(6500n); // 2000 + 3000 + 1500
      expect(userStats.totalSwapVolumeUSD).toBe(25000n); // 5000 + 8000 + 12000
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
        incrementalNumberOfFlashLoans: 1n,
        incrementalTotalFlashLoanVolumeUSD: 10000n,
        lastActivityTimestamp: mockTimestamp,
      };

      const result = await updateUserStatsPerPool(
        diff,
        mockUserData,
        mockContext,
        mockTimestamp,
      );

      expect(result.numberOfFlashLoans).toBe(1n);
      expect(result.totalFlashLoanVolumeUSD).toBe(10000n);
      expect(result.lastActivityTimestamp).toEqual(mockTimestamp);
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
        incrementalCurrentLiquidityUSD: 2000n,
        incrementalTotalLiquidityAddedUSD: 2000n,
        incrementalTotalFeesContributedUSD: 500n,
        incrementalNumberOfSwaps: 2n,
        incrementalTotalSwapVolumeUSD: 8000n,
        incrementalNumberOfFlashLoans: 1n,
        incrementalTotalFlashLoanVolumeUSD: 15000n,
        lastActivityTimestamp: mockTimestamp,
      };

      const result = await updateUserStatsPerPool(
        diff,
        mockUserData,
        mockContext,
        mockTimestamp,
      );

      expect(result.currentLiquidityUSD).toBe(2000n);
      expect(result.totalLiquidityAddedUSD).toBe(2000n);
      expect(result.totalLiquidityRemovedUSD).toBe(0n);
      expect(result.totalFeesContributedUSD).toBe(500n);
      expect(result.numberOfSwaps).toBe(2n);
      expect(result.totalSwapVolumeUSD).toBe(8000n);
      expect(result.numberOfFlashLoans).toBe(1n);
      expect(result.totalFlashLoanVolumeUSD).toBe(15000n);
      expect(result.lastActivityTimestamp).toEqual(mockTimestamp);
    });

    it("should update existing user stats correctly", async () => {
      const { createMockUserStatsPerPool } = setupCommon();
      const existingUserStats = createMockUserStatsPerPool({
        userAddress: mockUserAddress,
        poolAddress: mockPoolAddress,
        chainId: mockChainId,
        currentLiquidityUSD: 2000n,
        totalLiquidityAddedUSD: 2000n,
        totalFeesContributedUSD: 1000n,
        totalFeesContributed0: 500n,
        totalFeesContributed1: 300n,
        numberOfSwaps: 5n,
        totalSwapVolumeUSD: 10000n,
        numberOfFlashLoans: 2n,
        totalFlashLoanVolumeUSD: 20000n,
        firstActivityTimestamp: new Date(500000 * 1000),
        lastActivityTimestamp: new Date(800000 * 1000),
      });

      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        get: async (id: string) => existingUserStats,
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const diff = {
        incrementalCurrentLiquidityUSD: 1000n, // Adding more liquidity
        incrementalTotalLiquidityAddedUSD: 1000n,
        incrementalTotalFeesContributedUSD: 500n,
        incrementalNumberOfSwaps: 1n,
        incrementalTotalSwapVolumeUSD: 3000n,
        lastActivityTimestamp: mockTimestamp,
      };

      const result = await updateUserStatsPerPool(
        diff,
        existingUserStats,
        mockContext,
        mockTimestamp,
      );

      expect(result.currentLiquidityUSD).toBe(3000n); // 2000 + 1000
      expect(result.totalLiquidityAddedUSD).toBe(3000n); // 2000 + 1000
      expect(result.totalLiquidityRemovedUSD).toBe(0n); // No removal
      expect(result.totalFeesContributedUSD).toBe(1500n); // 1000 + 500
      expect(result.numberOfSwaps).toBe(6n); // 5 + 1
      expect(result.totalSwapVolumeUSD).toBe(13000n); // 10000 + 3000
      expect(result.numberOfFlashLoans).toBe(2n); // Unchanged
      expect(result.totalFlashLoanVolumeUSD).toBe(20000n); // Unchanged
      expect(result.lastActivityTimestamp).toEqual(mockTimestamp);
    });

    it("should handle liquidity removal from existing stats", async () => {
      const { createMockUserStatsPerPool } = setupCommon();
      const existingUserStats = createMockUserStatsPerPool({
        userAddress: mockUserAddress,
        poolAddress: mockPoolAddress,
        chainId: mockChainId,
        currentLiquidityUSD: 2000n,
        totalLiquidityAddedUSD: 2000n,
        totalFeesContributedUSD: 1000n,
        totalFeesContributed0: 500n,
        totalFeesContributed1: 300n,
        numberOfSwaps: 5n,
        totalSwapVolumeUSD: 10000n,
        numberOfFlashLoans: 2n,
        totalFlashLoanVolumeUSD: 20000n,
        firstActivityTimestamp: new Date(500000 * 1000),
        lastActivityTimestamp: new Date(800000 * 1000),
      });

      let savedUserStats: UserStatsPerPool | undefined;
      Object.assign(mockContext.UserStatsPerPool, {
        get: async (id: string) => existingUserStats,
        set: async (userStats: UserStatsPerPool) => {
          savedUserStats = userStats;
        },
      });

      const diff = {
        incrementalCurrentLiquidityUSD: -500n, // Removing liquidity
        incrementalTotalLiquidityRemovedUSD: 500n,
        lastActivityTimestamp: mockTimestamp,
      };

      const result = await updateUserStatsPerPool(
        diff,
        existingUserStats,
        mockContext,
        mockTimestamp,
      );

      expect(result.currentLiquidityUSD).toBe(1500n); // 2000 - 500
      expect(result.totalLiquidityAddedUSD).toBe(2000n); // Unchanged
      expect(result.totalLiquidityRemovedUSD).toBe(500n); // 0 + 500
      expect(result.lastActivityTimestamp).toEqual(mockTimestamp);
    });
  });
});
