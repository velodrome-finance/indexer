import {
  SNAPSHOT_INTERVAL_IN_MS,
  UserStatsPerPoolSnapshotId,
} from "../../src/Constants";
import {
  createUserStatsPerPoolSnapshot,
  setUserStatsPerPoolSnapshot,
} from "../../src/Snapshots/UserStatsPerPoolSnapshot";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("UserStatsPerPoolSnapshot", () => {
  let common: ReturnType<typeof setupCommon>;
  const baseTimestamp = new Date(SNAPSHOT_INTERVAL_IN_MS * 4);

  beforeEach(() => {
    common = setupCommon();
    jest.clearAllMocks();
  });

  describe("createUserStatsPerPoolSnapshot", () => {
    it("should return epoch-aligned snapshot with correct id and timestamp", () => {
      const entity = common.createMockUserStatsPerPool({
        almLpAmount: 1000n,
        totalFeesContributedUSD: 100n,
      });
      const timestamp = new Date(baseTimestamp.getTime() + 45 * 60 * 1000);
      const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 4;

      const snapshot = createUserStatsPerPoolSnapshot(entity, timestamp);

      expect(snapshot.id).toBe(
        UserStatsPerPoolSnapshotId(
          entity.chainId,
          entity.userAddress,
          entity.poolAddress,
          expectedEpochMs,
        ),
      );
      expect(snapshot.timestamp.getTime()).toBe(expectedEpochMs);
    });

    it("should copy entity fields into snapshot without persisting", () => {
      const entity = common.createMockUserStatsPerPool({
        almLpAmount: 1000n,
        totalFeesContributedUSD: 100n,
      });
      const snapshot = createUserStatsPerPoolSnapshot(entity, baseTimestamp);

      expect(snapshot.userAddress).toBe(entity.userAddress);
      expect(snapshot.poolAddress).toBe(entity.poolAddress);
      expect(snapshot.chainId).toBe(entity.chainId);
      expect(snapshot.almLpAmount).toBe(1000n);
      expect(snapshot.totalFeesContributedUSD).toBe(
        entity.totalFeesContributedUSD,
      );
    });
  });

  it("should set snapshot with epoch-aligned timestamp and correct id", () => {
    const context = common.createMockContext({
      UserStatsPerPoolSnapshot: { set: jest.fn() },
    });
    const entity = common.createMockUserStatsPerPool({
      almLpAmount: 1000n,
      totalFeesContributedUSD: 100n,
    });
    const timestamp = new Date(baseTimestamp.getTime() + 45 * 60 * 1000);

    setUserStatsPerPoolSnapshot(entity, timestamp, context);

    expect(context.UserStatsPerPoolSnapshot.set).toHaveBeenCalledTimes(1);
    const setArg = (context.UserStatsPerPoolSnapshot.set as jest.Mock).mock
      .calls[0][0];
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 4;
    expect(setArg.id).toBe(
      UserStatsPerPoolSnapshotId(
        entity.chainId,
        entity.userAddress,
        entity.poolAddress,
        expectedEpochMs,
      ),
    );
    expect(setArg.timestamp.getTime()).toBe(expectedEpochMs);
  });

  it("should spread entity fields into the snapshot", () => {
    const context = common.createMockContext({
      UserStatsPerPoolSnapshot: { set: jest.fn() },
    });
    const entity = common.createMockUserStatsPerPool({
      almLpAmount: 1000n,
      totalFeesContributedUSD: 100n,
    });

    setUserStatsPerPoolSnapshot(entity, baseTimestamp, context);

    const setArg = (context.UserStatsPerPoolSnapshot.set as jest.Mock).mock
      .calls[0][0];
    expect(setArg.userAddress).toBe(entity.userAddress);
    expect(setArg.poolAddress).toBe(entity.poolAddress);
    expect(setArg.chainId).toBe(entity.chainId);
    expect(setArg.almLpAmount).toBe(1000n);
    expect(setArg.totalFeesContributedUSD).toBe(entity.totalFeesContributedUSD);
  });
});
