import { SNAPSHOT_INTERVAL } from "../Constants";

/**
 * Rounds a timestamp down to the nearest SNAPSHOT_INTERVAL boundary.
 * @param timestamp - Timestamp to round down
 * @returns Rounded down timestamp
 */
export function getSnapshotEpoch(timestamp: Date): Date {
  return new Date(
    Math.floor(timestamp.getTime() / SNAPSHOT_INTERVAL) * SNAPSHOT_INTERVAL,
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
