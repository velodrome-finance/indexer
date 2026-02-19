import {
  LiquidityPoolAggregatorSnapshotId,
  SNAPSHOT_INTERVAL_IN_MS,
} from "../../src/Constants";
import { setLiquidityPoolAggregatorSnapshot } from "../../src/Snapshots/LiquidityPoolAggregatorSnapshot";
import { getSnapshotEpoch } from "../../src/Snapshots/Shared";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("LiquidityPoolAggregatorSnapshot", () => {
  let common: ReturnType<typeof setupCommon>;
  const baseTimestamp = new Date(SNAPSHOT_INTERVAL_IN_MS * 5); // epoch boundary

  beforeEach(() => {
    common = setupCommon();
    jest.clearAllMocks();
  });

  it("should set snapshot with epoch-aligned timestamp and correct id", () => {
    const context = common.createMockContext({
      LiquidityPoolAggregatorSnapshot: { set: jest.fn() },
    });
    const pool = common.createMockLiquidityPoolAggregator();
    const timestamp = new Date(baseTimestamp.getTime() + 30 * 60 * 1000); // 30 min into epoch

    setLiquidityPoolAggregatorSnapshot(pool, timestamp, context);

    expect(context.LiquidityPoolAggregatorSnapshot.set).toHaveBeenCalledTimes(
      1,
    );
    const setArg = (context.LiquidityPoolAggregatorSnapshot.set as jest.Mock)
      .mock.calls[0][0];
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 5;
    expect(setArg.id).toBe(
      LiquidityPoolAggregatorSnapshotId(
        pool.chainId,
        pool.poolAddress,
        expectedEpochMs,
      ),
    );
    expect(setArg.poolAddress).toBe(pool.poolAddress);
    expect(setArg.timestamp.getTime()).toBe(expectedEpochMs);
    expect(setArg.chainId).toBe(pool.chainId);
  });

  it("should set all snapshot fields from pool (with id and timestamp from epoch)", () => {
    const context = common.createMockContext({
      LiquidityPoolAggregatorSnapshot: { set: jest.fn() },
    });
    const pool = common.createMockLiquidityPoolAggregator();

    setLiquidityPoolAggregatorSnapshot(pool, baseTimestamp, context);

    const setArg = (context.LiquidityPoolAggregatorSnapshot.set as jest.Mock)
      .mock.calls[0][0];
    const expectedEpoch = getSnapshotEpoch(baseTimestamp);

    expect(setArg.id).toBe(
      LiquidityPoolAggregatorSnapshotId(
        pool.chainId,
        pool.poolAddress,
        expectedEpoch.getTime(),
      ),
    );
    expect(setArg.timestamp.getTime()).toBe(expectedEpoch.getTime());

    // Snapshot only includes fields defined on LiquidityPoolAggregatorSnapshot (no lastUpdatedTimestamp, lastSnapshotTimestamp, tickSpacing, etc.)
    const snapshotKeysFromPool = (
      Object.keys(pool) as (keyof typeof pool)[]
    ).filter(
      (k) =>
        k !== "id" &&
        k !== "lastUpdatedTimestamp" &&
        k !== "lastSnapshotTimestamp" &&
        k !== "tickSpacing" &&
        (setArg as Record<string, unknown>)[k] !== undefined,
    );
    for (const key of snapshotKeysFromPool) {
      const poolVal = pool[key];
      const snapshotVal = (setArg as Record<string, unknown>)[key];
      if (poolVal instanceof Date && snapshotVal instanceof Date) {
        expect(snapshotVal.getTime()).toBe(poolVal.getTime());
      } else {
        expect(snapshotVal).toEqual(poolVal);
      }
    }
  });
});
