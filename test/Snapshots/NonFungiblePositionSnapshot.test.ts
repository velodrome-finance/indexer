import {
  NonFungiblePositionSnapshotId,
  SNAPSHOT_INTERVAL_IN_MS,
  toChecksumAddress,
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
          entity.nfpmAddress,
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

    it("should copy isStakedInGauge from entity into snapshot", () => {
      const entityStaked = common.createMockNonFungiblePosition({
        isStakedInGauge: true,
      });
      const entityUnstaked = common.createMockNonFungiblePosition({
        isStakedInGauge: false,
      });

      const snapshotStaked = createNonFungiblePositionSnapshot(
        entityStaked,
        baseTimestamp,
      );
      const snapshotUnstaked = createNonFungiblePositionSnapshot(
        entityUnstaked,
        baseTimestamp,
      );

      expect(snapshotStaked.isStakedInGauge).toBe(true);
      expect(snapshotUnstaked.isStakedInGauge).toBe(false);
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
          entity.nfpmAddress,
          entity.tokenId,
          expectedEpochMs,
        ),
        timestamp: new Date(expectedEpochMs),
      }),
    );
  });

  // #620 regression: two NFPMs on the same chain can mint positions that share (chainId, tokenId).
  // Before this fix, their snapshots collided in the same epoch and overwrote each other.
  it("should produce distinct snapshot rows for two positions sharing (chainId, tokenId) under different NFPMs", () => {
    const NFPM_A = toChecksumAddress(
      "0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4",
    );
    const NFPM_B = toChecksumAddress(
      "0x416b433906b1B72FA758e166e239c43d68dC6F29",
    );
    const sharedTokenId = 42n;

    const entityA = common.createMockNonFungiblePosition({
      nfpmAddress: NFPM_A,
      tokenId: sharedTokenId,
      pool: toChecksumAddress("0xAaAa000000000000000000000000000000000001"),
    });
    const entityB = common.createMockNonFungiblePosition({
      nfpmAddress: NFPM_B,
      tokenId: sharedTokenId,
      pool: toChecksumAddress("0xBbBb000000000000000000000000000000000002"),
    });

    const snapshotA = createNonFungiblePositionSnapshot(entityA, baseTimestamp);
    const snapshotB = createNonFungiblePositionSnapshot(entityB, baseTimestamp);

    expect(snapshotA.chainId).toBe(snapshotB.chainId);
    expect(snapshotA.tokenId).toBe(snapshotB.tokenId);
    expect(snapshotA.timestamp.getTime()).toBe(snapshotB.timestamp.getTime());
    expect(snapshotA.id).not.toBe(snapshotB.id);
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
          entity.nfpmAddress,
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
