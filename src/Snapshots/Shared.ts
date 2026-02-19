import type {
  ALM_LP_WrapperSnapshot,
  LiquidityPoolAggregatorSnapshot,
  NonFungiblePositionSnapshot,
  TokenPriceSnapshot,
  UserStatsPerPoolSnapshot,
  VeNFTStateSnapshot,
  handlerContext,
} from "generated";

import { SNAPSHOT_INTERVAL_IN_MS } from "../Constants";

export enum SnapshotType {
  LiquidityPoolAggregator = "LiquidityPoolAggregator",
  UserStatsPerPool = "UserStatsPerPool",
  NonFungiblePosition = "NonFungiblePosition",
  ALMLPWrapper = "ALMLPWrapper",
  VeNFTState = "VeNFTState",
  TokenPrice = "TokenPrice",
}

/**
 * Tagged union of all snapshot types for centralized persistence.
 * All context.<Store>.set for snapshots go through persistSnapshot so debugging
 * and instrumentation have a single place to hook.
 */
export type SnapshotForPersist =
  | {
      type: SnapshotType.LiquidityPoolAggregator;
      snapshot: LiquidityPoolAggregatorSnapshot;
    }
  | { type: SnapshotType.UserStatsPerPool; snapshot: UserStatsPerPoolSnapshot }
  | {
      type: SnapshotType.NonFungiblePosition;
      snapshot: NonFungiblePositionSnapshot;
    }
  | { type: SnapshotType.ALMLPWrapper; snapshot: ALM_LP_WrapperSnapshot }
  | { type: SnapshotType.VeNFTState; snapshot: VeNFTStateSnapshot }
  | { type: SnapshotType.TokenPrice; snapshot: TokenPriceSnapshot };

/**
 * Rounds a timestamp down to the nearest SNAPSHOT_INTERVAL_IN_MS boundary.
 * @param timestamp - Timestamp to round down
 * @returns Rounded down timestamp
 */
export function getSnapshotEpoch(timestamp: Date): Date {
  return new Date(
    Math.floor(timestamp.getTime() / SNAPSHOT_INTERVAL_IN_MS) *
      SNAPSHOT_INTERVAL_IN_MS,
  );
}

/**
 * Returns true if a new snapshot should be created (entity never snapshotted,
 * or current timestamp is in a newer epoch than last snapshot).
 * @param lastSnapshotTimestamp - Last snapshot timestamp
 * @param currentTimestamp - Current timestamp
 * @returns True if a new snapshot should be created
 */
export function shouldSnapshot(
  lastSnapshotTimestamp: Date | undefined,
  currentTimestamp: Date,
): boolean {
  if (!lastSnapshotTimestamp) return true;
  return (
    getSnapshotEpoch(currentTimestamp).getTime() >
    getSnapshotEpoch(lastSnapshotTimestamp).getTime()
  );
}

/**
 * Persists a snapshot to the handler context. All snapshot context.*.set calls
 * go through this function for easier debugging and a single place to
 * instrument writes.
 * @param item - Tagged snapshot (type + snapshot payload) to persist
 * @param context - Handler context
 * @returns void
 */
export function persistSnapshot(
  item: SnapshotForPersist,
  context: handlerContext,
): void {
  switch (item.type) {
    case SnapshotType.LiquidityPoolAggregator:
      context.LiquidityPoolAggregatorSnapshot.set(item.snapshot);
      break;
    case SnapshotType.UserStatsPerPool:
      context.UserStatsPerPoolSnapshot.set(item.snapshot);
      break;
    case SnapshotType.NonFungiblePosition:
      context.NonFungiblePositionSnapshot.set(item.snapshot);
      break;
    case SnapshotType.ALMLPWrapper:
      context.ALM_LP_WrapperSnapshot.set(item.snapshot);
      break;
    case SnapshotType.VeNFTState:
      context.VeNFTStateSnapshot.set(item.snapshot);
      break;
    case SnapshotType.TokenPrice:
      context.TokenPriceSnapshot.set(item.snapshot);
      break;
    default: {
      const _: never = item;
      return;
    }
  }
}
