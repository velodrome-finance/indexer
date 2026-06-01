import type { UserStatsPerPool } from "envio";
import { updateUserStatsPerPool } from "../../src/Aggregators/UserStatsPerPool";
import { toChecksumAddress } from "../../src/Constants";
import type { handlerContext } from "../../src/EntityTypes";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("UserStatsPerPool Liquidity Logic", () => {
  let common: ReturnType<typeof setupCommon>;
  let mockContext: handlerContext;

  const mockUserAddress = toChecksumAddress(
    "0x1234567890123456789012345678901234567890",
  );
  const mockPoolAddress = toChecksumAddress(
    "0xabcdef1234567890abcdef1234567890abcdef12",
  );
  const mockChainId = 10;
  const mockTimestamp = new Date(1000000 * 1000);

  const createMockUserStats = (): UserStatsPerPool =>
    common.createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      firstActivityTimestamp: mockTimestamp,
      lastActivityTimestamp: mockTimestamp,
    });

  beforeEach(() => {
    common = setupCommon();
    mockContext = common.createMockContext({
      UserStatsPerPool: { set: async () => {} },
      UserStatsPerPoolSnapshot: { set: vi.fn() },
      log: { error: () => {}, warn: () => {}, info: () => {} },
    });
  });

  describe("Liquidity Addition Logic", () => {
    it("should accumulate totalLiquidityAddedUSD on a single addition", async () => {
      const userStats = createMockUserStats();

      const result = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityAddedUSD: 1000n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(result.totalLiquidityAddedUSD).toBe(1000n);
      expect(result.totalLiquidityRemovedUSD).toBe(0n);
      expect(mockContext.UserStatsPerPoolSnapshot.set).toHaveBeenCalledWith(
        expect.objectContaining({
          userAddress: mockUserAddress,
          poolAddress: mockPoolAddress,
          chainId: mockChainId,
          totalLiquidityAddedUSD: 1000n,
          totalLiquidityRemovedUSD: 0n,
        }),
      );
    });

    it("should accumulate totalLiquidityAddedUSD across multiple additions", async () => {
      let userStats = createMockUserStats();

      userStats = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityAddedUSD: 1000n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(userStats.totalLiquidityAddedUSD).toBe(1000n);

      userStats = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityAddedUSD: 500n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(userStats.totalLiquidityAddedUSD).toBe(1500n);
      expect(userStats.totalLiquidityRemovedUSD).toBe(0n);
    });
  });

  describe("Liquidity Removal Logic", () => {
    it("should accumulate totalLiquidityRemovedUSD on a single removal", async () => {
      const userStats = createMockUserStats();

      const result = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityRemovedUSD: 500n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(result.totalLiquidityAddedUSD).toBe(0n);
      expect(result.totalLiquidityRemovedUSD).toBe(500n);
    });

    it("should accumulate totalLiquidityRemovedUSD across multiple removals", async () => {
      let userStats = createMockUserStats();

      userStats = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityRemovedUSD: 300n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(userStats.totalLiquidityRemovedUSD).toBe(300n);

      userStats = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityRemovedUSD: 200n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(userStats.totalLiquidityRemovedUSD).toBe(500n);
      expect(userStats.totalLiquidityAddedUSD).toBe(0n);
    });
  });

  describe("Mixed Liquidity Operations", () => {
    it("should track adds and removes independently", async () => {
      let userStats = createMockUserStats();

      userStats = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityAddedUSD: 1000n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      userStats = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityRemovedUSD: 300n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(userStats.totalLiquidityAddedUSD).toBe(1000n);
      expect(userStats.totalLiquidityRemovedUSD).toBe(300n);
    });

    it("should handle interleaved add/remove operations", async () => {
      let userStats = createMockUserStats();

      userStats = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityAddedUSD: 1000n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      userStats = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityRemovedUSD: 200n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      userStats = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityAddedUSD: 500n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      userStats = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityRemovedUSD: 100n,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(userStats.totalLiquidityAddedUSD).toBe(1500n); // 1000 + 500
      expect(userStats.totalLiquidityRemovedUSD).toBe(300n); // 200 + 100
    });
  });

  describe("Edge Cases", () => {
    it("should leave totals unchanged when no liquidity diffs are passed", async () => {
      const userStats = createMockUserStats();
      const result = await updateUserStatsPerPool(
        {
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(result.totalLiquidityAddedUSD).toBe(0n);
      expect(result.totalLiquidityRemovedUSD).toBe(0n);
    });

    it("should handle very large liquidity amounts", async () => {
      const userStats = createMockUserStats();
      const largeAmount = BigInt("1000000000000000000000000"); // 1M tokens with 18 decimals

      const result = await updateUserStatsPerPool(
        {
          incrementalTotalLiquidityAddedUSD: largeAmount,
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );

      expect(result.totalLiquidityAddedUSD).toBe(largeAmount);
      expect(result.totalLiquidityRemovedUSD).toBe(0n);
    });
  });
});
