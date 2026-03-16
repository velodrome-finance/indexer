import {
  SNAPSHOT_INTERVAL_IN_MS,
  toChecksumAddress,
} from "../../src/Constants";
import { createLiquidityPoolAggregatorSnapshot } from "../../src/Snapshots/LiquidityPoolAggregatorSnapshot";
import {
  type SnapshotForPersist,
  SnapshotType,
  getSnapshotEpoch,
  persistSnapshot,
  shouldSnapshot,
} from "../../src/Snapshots/Shared";
import { createTokenPriceSnapshot } from "../../src/Snapshots/TokenPriceSnapshot";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("Snapshots Shared", () => {
  describe("getSnapshotEpoch", () => {
    it("should round timestamp down to the nearest hourly boundary", () => {
      // 1 hour = SNAPSHOT_INTERVAL_IN_MS ms
      const oneHourMs = SNAPSHOT_INTERVAL_IN_MS;
      const exactBoundary = new Date(oneHourMs * 3); // 03:00:00.000
      expect(getSnapshotEpoch(exactBoundary).getTime()).toBe(oneHourMs * 3);
    });

    it("should floor timestamps within an hour to the start of that hour", () => {
      const oneHourMs = SNAPSHOT_INTERVAL_IN_MS;
      const midHour = new Date(oneHourMs * 2 + 30 * 60 * 1000); // 02:30:00.000
      expect(getSnapshotEpoch(midHour).getTime()).toBe(oneHourMs * 2);
    });

    it("should floor timestamps with milliseconds to the hour start", () => {
      const oneHourMs = SNAPSHOT_INTERVAL_IN_MS;
      const withMs = new Date(oneHourMs * 5 + 59 * 60 * 1000 + 999); // 05:59:59.999
      expect(getSnapshotEpoch(withMs).getTime()).toBe(oneHourMs * 5);
    });

    it("should return epoch 0 for timestamps before first hour", () => {
      const early = new Date(SNAPSHOT_INTERVAL_IN_MS - 1);
      expect(getSnapshotEpoch(early).getTime()).toBe(0);
    });
  });

  describe("shouldSnapshot", () => {
    const oneHourMs = SNAPSHOT_INTERVAL_IN_MS;

    it("should return true when lastSnapshotTimestamp is undefined", () => {
      expect(shouldSnapshot(undefined, new Date(oneHourMs * 10))).toBe(true);
    });

    it("should return true when current timestamp is in a newer epoch", () => {
      const last = new Date(oneHourMs * 2);
      const current = new Date(oneHourMs * 3 + 1);
      expect(shouldSnapshot(last, current)).toBe(true);
    });

    it("should return false when current timestamp is in the same epoch", () => {
      const last = new Date(oneHourMs * 2);
      const current = new Date(oneHourMs * 2 + 30 * 60 * 1000);
      expect(shouldSnapshot(last, current)).toBe(false);
    });

    it("should return false when current timestamp is in an older epoch", () => {
      const last = new Date(oneHourMs * 5);
      const current = new Date(oneHourMs * 3);
      expect(shouldSnapshot(last, current)).toBe(false);
    });

    it("should return false when both are at the same epoch boundary", () => {
      const t = new Date(oneHourMs * 4);
      expect(shouldSnapshot(t, t)).toBe(false);
    });
  });

  describe("persistSnapshot", () => {
    const oneHourMs = SNAPSHOT_INTERVAL_IN_MS;

    it("should call LiquidityPoolAggregatorSnapshot.set when type is LiquidityPoolAggregator", () => {
      const common = setupCommon();
      const context = common.createMockContext({
        LiquidityPoolAggregatorSnapshot: { set: vi.fn() },
      });
      const pool = common.createMockLiquidityPoolAggregator();
      const timestamp = new Date(oneHourMs * 5);
      const snapshot = createLiquidityPoolAggregatorSnapshot(pool, timestamp);

      persistSnapshot(
        { type: SnapshotType.LiquidityPoolAggregator, snapshot },
        context,
      );

      expect(context.LiquidityPoolAggregatorSnapshot.set).toHaveBeenCalledTimes(
        1,
      );
      expect(context.LiquidityPoolAggregatorSnapshot.set).toHaveBeenCalledWith(
        snapshot,
      );
    });

    it("should call TokenPriceSnapshot.set when type is TokenPrice", () => {
      const common = setupCommon();
      const context = common.createMockContext({
        TokenPriceSnapshot: { set: vi.fn() },
      });
      const address = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const chainId = 10;
      const blockNumber = 500000;
      const lastUpdatedTimestamp = new Date(1000000 * 1000);
      const pricePerUSDNew = 1000000000000000000n;
      const isWhitelisted = true;
      const snapshot = createTokenPriceSnapshot(
        address,
        chainId,
        blockNumber,
        lastUpdatedTimestamp,
        pricePerUSDNew,
        isWhitelisted,
      );

      persistSnapshot({ type: SnapshotType.TokenPrice, snapshot }, context);

      expect(context.TokenPriceSnapshot.set).toHaveBeenCalledTimes(1);
      expect(context.TokenPriceSnapshot.set).toHaveBeenCalledWith(snapshot);
    });

    it("should hit default branch and not call any set when type is unknown (exhaustiveness)", () => {
      const common = setupCommon();
      const context = common.createMockContext({
        LiquidityPoolAggregatorSnapshot: { set: vi.fn() },
        TokenPriceSnapshot: { set: vi.fn() },
      });
      const invalidItem = {
        type: "NonExistent",
        snapshot: {},
      } as unknown as SnapshotForPersist;

      persistSnapshot(invalidItem, context);

      expect(
        context.LiquidityPoolAggregatorSnapshot.set,
      ).not.toHaveBeenCalled();
      expect(context.TokenPriceSnapshot.set).not.toHaveBeenCalled();
    });
  });
});
