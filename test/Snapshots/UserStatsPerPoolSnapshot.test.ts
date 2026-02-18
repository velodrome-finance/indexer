import {
  SNAPSHOT_INTERVAL,
  UserStatsPerPoolSnapshotId,
} from "../../src/Constants";
import { setUserStatsPerPoolSnapshot } from "../../src/Snapshots/UserStatsPerPoolSnapshot";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("UserStatsPerPoolSnapshot", () => {
  let common: ReturnType<typeof setupCommon>;
  const baseTimestamp = new Date(SNAPSHOT_INTERVAL * 4);
  const blockNumber = 200000;

  beforeEach(() => {
    common = setupCommon();
    jest.clearAllMocks();
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

    setUserStatsPerPoolSnapshot(entity, timestamp, blockNumber, context);

    expect(context.UserStatsPerPoolSnapshot.set).toHaveBeenCalledTimes(1);
    const setArg = (context.UserStatsPerPoolSnapshot.set as jest.Mock).mock
      .calls[0][0];
    const expectedEpochMs = SNAPSHOT_INTERVAL * 4;
    expect(setArg.id).toBe(
      UserStatsPerPoolSnapshotId(
        entity.chainId,
        entity.userAddress,
        entity.poolAddress,
        expectedEpochMs,
      ),
    );
    expect(setArg.timestamp.getTime()).toBe(expectedEpochMs);
    expect(setArg.blockNumber).toBe(blockNumber);
  });

  it("should spread entity fields into the snapshot", () => {
    const context = common.createMockContext({
      UserStatsPerPoolSnapshot: { set: jest.fn() },
    });
    const entity = common.createMockUserStatsPerPool({
      almLpAmount: 1000n,
      totalFeesContributedUSD: 100n,
    });

    setUserStatsPerPoolSnapshot(entity, baseTimestamp, blockNumber, context);

    const setArg = (context.UserStatsPerPoolSnapshot.set as jest.Mock).mock
      .calls[0][0];
    expect(setArg.userAddress).toBe(entity.userAddress);
    expect(setArg.poolAddress).toBe(entity.poolAddress);
    expect(setArg.chainId).toBe(entity.chainId);
    expect(setArg.almLpAmount).toBe(1000n);
    expect(setArg.totalFeesContributedUSD).toBe(entity.totalFeesContributedUSD);
  });
});
