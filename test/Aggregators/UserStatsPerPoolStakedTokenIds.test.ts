import type { UserStatsPerPool, handlerContext } from "generated";
import {
  createUserStatsPerPoolEntity,
  updateUserStatsPerPool,
} from "../../src/Aggregators/UserStatsPerPool";
import { toChecksumAddress } from "../../src/Constants";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("UserStatsPerPool stakedCLPositionTokenIds", () => {
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

  const createMockUserStats = (
    overrides: Partial<UserStatsPerPool> = {},
  ): UserStatsPerPool =>
    common.createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      firstActivityTimestamp: mockTimestamp,
      lastActivityTimestamp: mockTimestamp,
      ...overrides,
    });

  beforeEach(() => {
    common = setupCommon();
    mockContext = common.createMockContext({
      UserStatsPerPool: { set: async () => {} },
      UserStatsPerPoolSnapshot: { set: vi.fn() },
      log: { error: () => {}, warn: () => {}, info: () => {} },
    });
  });

  describe("createUserStatsPerPoolEntity", () => {
    it("should initialize stakedCLPositionTokenIds to empty array", () => {
      const entity = createUserStatsPerPoolEntity(
        mockUserAddress,
        mockPoolAddress,
        mockChainId,
        mockTimestamp,
      );
      expect(entity.stakedCLPositionTokenIds).toEqual([]);
    });
  });

  describe("updateUserStatsPerPool - stakedCLPositionTokenIds wiring", () => {
    it("should overwrite stakedCLPositionTokenIds when present in diff", async () => {
      const userStats = createMockUserStats({
        stakedCLPositionTokenIds: [1n, 2n],
      });
      const result = await updateUserStatsPerPool(
        {
          stakedCLPositionTokenIds: [1n, 2n, 3n],
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );
      expect(result.stakedCLPositionTokenIds).toEqual([1n, 2n, 3n]);
    });

    it("should preserve stakedCLPositionTokenIds when undefined in diff", async () => {
      const userStats = createMockUserStats({
        stakedCLPositionTokenIds: [10n, 20n],
      });
      const result = await updateUserStatsPerPool(
        { lastActivityTimestamp: mockTimestamp },
        userStats,
        mockContext,
        mockTimestamp,
      );
      expect(result.stakedCLPositionTokenIds).toEqual([10n, 20n]);
    });

    it("should allow setting stakedCLPositionTokenIds to empty array", async () => {
      const userStats = createMockUserStats({
        stakedCLPositionTokenIds: [5n],
      });
      const result = await updateUserStatsPerPool(
        {
          stakedCLPositionTokenIds: [],
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );
      expect(result.stakedCLPositionTokenIds).toEqual([]);
    });
  });

  describe("gauge deposit - appends tokenId for CL pools", () => {
    it("should append tokenId on first deposit", async () => {
      const userStats = createMockUserStats({
        stakedCLPositionTokenIds: [],
        lastSnapshotTimestamp: mockTimestamp, // avoid triggering snapshot path
      });
      const result = await updateUserStatsPerPool(
        {
          incrementalNumberOfGaugeDeposits: 1n,
          incrementalCurrentLiquidityStaked: 5000n,
          stakedCLPositionTokenIds: [42n],
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );
      expect(result.stakedCLPositionTokenIds).toEqual([42n]);
    });

    it("should accumulate tokenIds on multiple deposits", async () => {
      let userStats = createMockUserStats({
        stakedCLPositionTokenIds: [],
        lastSnapshotTimestamp: mockTimestamp, // avoid triggering snapshot path
      });

      // First deposit
      userStats = await updateUserStatsPerPool(
        {
          incrementalNumberOfGaugeDeposits: 1n,
          incrementalCurrentLiquidityStaked: 5000n,
          stakedCLPositionTokenIds: [42n],
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );
      expect(userStats.stakedCLPositionTokenIds).toEqual([42n]);

      // Second deposit
      userStats = await updateUserStatsPerPool(
        {
          incrementalNumberOfGaugeDeposits: 1n,
          incrementalCurrentLiquidityStaked: 3000n,
          stakedCLPositionTokenIds: [42n, 99n],
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );
      expect(userStats.stakedCLPositionTokenIds).toEqual([42n, 99n]);
    });
  });

  describe("gauge withdraw - removes tokenId for CL pools", () => {
    it("should remove tokenId on withdraw", async () => {
      const userStats = createMockUserStats({
        stakedCLPositionTokenIds: [42n, 99n],
        currentLiquidityStaked: 8000n,
        lastSnapshotTimestamp: mockTimestamp, // avoid triggering snapshot path
      });
      const result = await updateUserStatsPerPool(
        {
          incrementalNumberOfGaugeWithdrawals: 1n,
          incrementalCurrentLiquidityStaked: -5000n,
          stakedCLPositionTokenIds: [99n],
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );
      expect(result.stakedCLPositionTokenIds).toEqual([99n]);
    });

    it("should handle withdrawing last position", async () => {
      const userStats = createMockUserStats({
        stakedCLPositionTokenIds: [42n],
        currentLiquidityStaked: 5000n,
        lastSnapshotTimestamp: mockTimestamp, // avoid triggering snapshot path
      });
      const result = await updateUserStatsPerPool(
        {
          incrementalNumberOfGaugeWithdrawals: 1n,
          incrementalCurrentLiquidityStaked: -5000n,
          stakedCLPositionTokenIds: [],
          lastActivityTimestamp: mockTimestamp,
        },
        userStats,
        mockContext,
        mockTimestamp,
      );
      expect(result.stakedCLPositionTokenIds).toEqual([]);
    });
  });

  describe("snapshot propagation", () => {
    it("should propagate stakedCLPositionTokenIds to snapshot", async () => {
      const userStats = createMockUserStats({
        stakedCLPositionTokenIds: [42n, 99n],
      });

      // Use a timestamp in a new epoch to trigger snapshot
      const snapshotTimestamp = new Date(2000000 * 1000);

      const result = await updateUserStatsPerPool(
        { lastActivityTimestamp: snapshotTimestamp },
        userStats,
        mockContext,
        snapshotTimestamp,
      );

      expect(mockContext.UserStatsPerPoolSnapshot.set).toHaveBeenCalledWith(
        expect.objectContaining({
          stakedCLPositionTokenIds: [42n, 99n],
        }),
      );
    });
  });
});
