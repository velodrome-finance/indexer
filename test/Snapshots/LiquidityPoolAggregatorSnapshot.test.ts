import {
  LiquidityPoolAggregatorSnapshotId,
  SNAPSHOT_INTERVAL_IN_MS,
} from "../../src/Constants";
import {
  createLiquidityPoolAggregatorSnapshot,
  setLiquidityPoolAggregatorSnapshot,
} from "../../src/Snapshots/LiquidityPoolAggregatorSnapshot";
import { getSnapshotEpoch } from "../../src/Snapshots/Shared";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("LiquidityPoolAggregatorSnapshot", () => {
  let common: ReturnType<typeof setupCommon>;
  const baseTimestamp = new Date(SNAPSHOT_INTERVAL_IN_MS * 5); // epoch boundary

  beforeEach(() => {
    common = setupCommon();
    vi.restoreAllMocks();
  });

  describe("createLiquidityPoolAggregatorSnapshot", () => {
    it("should return epoch-aligned snapshot with correct id and timestamp", () => {
      const pool = common.createMockLiquidityPoolAggregator();
      const timestamp = new Date(baseTimestamp.getTime() + 30 * 60 * 1000);
      const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 5;

      const snapshot = createLiquidityPoolAggregatorSnapshot(pool, timestamp);

      expect(snapshot.id).toBe(
        LiquidityPoolAggregatorSnapshotId(
          pool.chainId,
          pool.poolAddress,
          expectedEpochMs,
        ),
      );
      expect(snapshot.timestamp.getTime()).toBe(expectedEpochMs);
    });

    it("should copy pool fields into snapshot without persisting", () => {
      const pool = common.createMockLiquidityPoolAggregator();
      const snapshot = createLiquidityPoolAggregatorSnapshot(
        pool,
        baseTimestamp,
      );

      expect(snapshot.poolAddress).toBe(pool.poolAddress);
      expect(snapshot.chainId).toBe(pool.chainId);
      expect(snapshot.reserve0).toBe(pool.reserve0);
      expect(snapshot.reserve1).toBe(pool.reserve1);
      expect(snapshot.totalLiquidityUSD).toBe(pool.totalLiquidityUSD);
    });
  });

  it("should set snapshot with epoch-aligned timestamp and correct id", () => {
    const context = common.createMockContext({
      LiquidityPoolAggregatorSnapshot: { set: vi.fn() },
    });
    const pool = common.createMockLiquidityPoolAggregator();
    const timestamp = new Date(baseTimestamp.getTime() + 30 * 60 * 1000); // 30 min into epoch
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 5;

    setLiquidityPoolAggregatorSnapshot(pool, timestamp, context);

    expect(context.LiquidityPoolAggregatorSnapshot.set).toHaveBeenCalledTimes(
      1,
    );
    expect(context.LiquidityPoolAggregatorSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: LiquidityPoolAggregatorSnapshotId(
          pool.chainId,
          pool.poolAddress,
          expectedEpochMs,
        ),
        timestamp: new Date(expectedEpochMs),
        poolAddress: pool.poolAddress,
        chainId: pool.chainId,
      }),
    );
  });

  it("should set all snapshot fields from pool (with id and timestamp from epoch)", () => {
    const context = common.createMockContext({
      LiquidityPoolAggregatorSnapshot: { set: vi.fn() },
    });
    const pool = common.createMockLiquidityPoolAggregator();
    const expectedEpoch = getSnapshotEpoch(baseTimestamp);

    setLiquidityPoolAggregatorSnapshot(pool, baseTimestamp, context);

    expect(context.LiquidityPoolAggregatorSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: LiquidityPoolAggregatorSnapshotId(
          pool.chainId,
          pool.poolAddress,
          expectedEpoch.getTime(),
        ),
        timestamp: new Date(expectedEpoch.getTime()),
      }),
    );

    // Snapshot only includes fields defined on LiquidityPoolAggregatorSnapshot (no lastUpdatedTimestamp, lastSnapshotTimestamp, tickSpacing, etc.)
    const setArg = vi.mocked(context.LiquidityPoolAggregatorSnapshot.set).mock
      .calls[0][0];
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
