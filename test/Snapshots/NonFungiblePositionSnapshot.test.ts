import {
  NonFungiblePositionSnapshotId,
  SNAPSHOT_INTERVAL_IN_MS,
} from "../../src/Constants";
import {
  createNonFungiblePositionSnapshot,
  setNonFungiblePositionSnapshot,
} from "../../src/Snapshots/NonFungiblePositionSnapshot";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("NonFungiblePositionSnapshot", () => {
  let common: ReturnType<typeof setupCommon>;
  const baseTimestamp = new Date(SNAPSHOT_INTERVAL_IN_MS * 6);

  beforeEach(() => {
    common = setupCommon();
    vi.restoreAllMocks();
  });

  describe("createNonFungiblePositionSnapshot", () => {
    it("should return epoch-aligned snapshot with correct id and timestamp", () => {
      const entity = common.createMockNonFungiblePosition();
      const timestamp = new Date(baseTimestamp.getTime() + 20 * 60 * 1000);
      const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 6;

      const snapshot = createNonFungiblePositionSnapshot(entity, timestamp);

      expect(snapshot.id).toBe(
        NonFungiblePositionSnapshotId(
          entity.chainId,
          entity.tokenId,
          expectedEpochMs,
        ),
      );
      expect(snapshot.timestamp.getTime()).toBe(expectedEpochMs);
    });

    it("should copy entity fields into snapshot without persisting", () => {
      const entity = common.createMockNonFungiblePosition({
        liquidity: 5000n,
        tickLower: -200n,
      });
      const snapshot = createNonFungiblePositionSnapshot(entity, baseTimestamp);

      expect(snapshot.chainId).toBe(entity.chainId);
      expect(snapshot.tokenId).toBe(entity.tokenId);
      expect(snapshot.pool).toBe(entity.pool);
      expect(snapshot.liquidity).toBe(5000n);
      expect(snapshot.tickLower).toBe(-200n);
    });
  });

  it("should set snapshot with epoch-aligned timestamp and correct id", () => {
    const context = common.createMockContext({
      NonFungiblePositionSnapshot: { set: vi.fn() },
    });
    const entity = common.createMockNonFungiblePosition();
    const timestamp = new Date(baseTimestamp.getTime() + 20 * 60 * 1000);
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 6;

    setNonFungiblePositionSnapshot(entity, timestamp, context);

    expect(context.NonFungiblePositionSnapshot.set).toHaveBeenCalledTimes(1);
    expect(context.NonFungiblePositionSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: NonFungiblePositionSnapshotId(
          entity.chainId,
          entity.tokenId,
          expectedEpochMs,
        ),
        timestamp: new Date(expectedEpochMs),
      }),
    );
  });

  it("should spread entity fields into the snapshot", () => {
    const context = common.createMockContext({
      NonFungiblePositionSnapshot: { set: vi.fn() },
    });
    const entity = common.createMockNonFungiblePosition({ liquidity: 5000n });
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 6;

    setNonFungiblePositionSnapshot(entity, baseTimestamp, context);

    expect(context.NonFungiblePositionSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: NonFungiblePositionSnapshotId(
          entity.chainId,
          entity.tokenId,
          expectedEpochMs,
        ),
        timestamp: new Date(expectedEpochMs),
        chainId: entity.chainId,
        tokenId: entity.tokenId,
        pool: entity.pool,
        liquidity: 5000n,
      }),
    );
  });
});
