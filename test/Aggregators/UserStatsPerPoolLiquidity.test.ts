import type { UserStatsPerPool, handlerContext } from "generated";
import { updateUserStatsPerPool } from "../../src/Aggregators/UserStatsPerPool";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("UserStatsPerPool Liquidity Logic", () => {
  const mockUserAddress = "0x1234567890123456789012345678901234567890";
  const mockPoolAddress = "0xabcdef1234567890abcdef1234567890abcdef12";
  const mockChainId = 10;
  const mockTimestamp = new Date(1000000 * 1000);

  const { createMockUserStatsPerPool } = setupCommon();

  const createMockUserStats = (): UserStatsPerPool =>
    createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
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
        {
          currentLiquidityUSD: netLiquidityAddedUSD,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(result.currentLiquidityUSD).toBe(1000n);
      expect(result.totalLiquidityAddedUSD).toBe(1000n);
      expect(result.totalLiquidityRemovedUSD).toBe(0n);
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
        {
          currentLiquidityUSD: 1000n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).toBe(1000n);
      expect(userStats.totalLiquidityAddedUSD).toBe(1000n);
      expect(userStats.totalLiquidityRemovedUSD).toBe(0n);

      // Second addition
      userStats = await updateUserStatsPerPool(
        {
          currentLiquidityUSD: 500n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).toBe(1500n);
      expect(userStats.totalLiquidityAddedUSD).toBe(1500n);
      expect(userStats.totalLiquidityRemovedUSD).toBe(0n);
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
        {
          currentLiquidityUSD: netLiquidityRemovedUSD,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(result.currentLiquidityUSD).toBe(-500n);
      expect(result.totalLiquidityAddedUSD).toBe(0n);
      expect(result.totalLiquidityRemovedUSD).toBe(500n);
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
        {
          currentLiquidityUSD: -300n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).toBe(-300n);
      expect(userStats.totalLiquidityAddedUSD).toBe(0n);
      expect(userStats.totalLiquidityRemovedUSD).toBe(300n);

      // Second removal
      userStats = await updateUserStatsPerPool(
        {
          currentLiquidityUSD: -200n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).toBe(-500n);
      expect(userStats.totalLiquidityAddedUSD).toBe(0n);
      expect(userStats.totalLiquidityRemovedUSD).toBe(500n);
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
        {
          currentLiquidityUSD: 1000n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).toBe(1000n);
      expect(userStats.totalLiquidityAddedUSD).toBe(1000n);
      expect(userStats.totalLiquidityRemovedUSD).toBe(0n);

      // Remove some liquidity
      userStats = await updateUserStatsPerPool(
        {
          currentLiquidityUSD: -300n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).toBe(700n);
      expect(userStats.totalLiquidityAddedUSD).toBe(1000n);
      expect(userStats.totalLiquidityRemovedUSD).toBe(300n);
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
        {
          currentLiquidityUSD: -500n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).toBe(-500n);
      expect(userStats.totalLiquidityAddedUSD).toBe(0n);
      expect(userStats.totalLiquidityRemovedUSD).toBe(500n);

      // Add liquidity
      userStats = await updateUserStatsPerPool(
        {
          currentLiquidityUSD: 800n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).toBe(300n);
      expect(userStats.totalLiquidityAddedUSD).toBe(800n);
      expect(userStats.totalLiquidityRemovedUSD).toBe(500n);
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
        {
          currentLiquidityUSD: 1000n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      // Remove 200
      userStats = await updateUserStatsPerPool(
        {
          currentLiquidityUSD: -200n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      // Add 500
      userStats = await updateUserStatsPerPool(
        {
          currentLiquidityUSD: 500n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      // Remove 100
      userStats = await updateUserStatsPerPool(
        {
          currentLiquidityUSD: -100n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(userStats.currentLiquidityUSD).toBe(1200n); // 1000 - 200 + 500 - 100
      expect(userStats.totalLiquidityAddedUSD).toBe(1500n); // 1000 + 500
      expect(userStats.totalLiquidityRemovedUSD).toBe(300n); // 200 + 100
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
        {
          currentLiquidityUSD: 0n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(result.currentLiquidityUSD).toBe(0n);
      expect(result.totalLiquidityAddedUSD).toBe(0n);
      expect(result.totalLiquidityRemovedUSD).toBe(0n);
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
        {
          currentLiquidityUSD: largeAmount,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
      );

      expect(result.currentLiquidityUSD).toBe(largeAmount);
      expect(result.totalLiquidityAddedUSD).toBe(largeAmount);
      expect(result.totalLiquidityRemovedUSD).toBe(0n);
    });
  });
});
