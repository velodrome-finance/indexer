import {
  SNAPSHOT_INTERVAL_IN_MS,
  VeNFTStateSnapshotId,
} from "../../src/Constants";
import {
  createVeNFTStateSnapshot,
  setVeNFTStateSnapshot,
} from "../../src/Snapshots/VeNFTStateSnapshot";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("VeNFTStateSnapshot", () => {
  let common: ReturnType<typeof setupCommon>;
  const baseTimestamp = new Date(SNAPSHOT_INTERVAL_IN_MS * 2);

  beforeEach(() => {
    common = setupCommon();
    jest.clearAllMocks();
  });

  describe("createVeNFTStateSnapshot", () => {
    it("should return epoch-aligned snapshot with correct id and timestamp", () => {
      const entity = common.createMockVeNFTState({
        totalValueLocked: 1000n,
        locktime: 1n,
      });
      const timestamp = new Date(baseTimestamp.getTime() + 10 * 60 * 1000);
      const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 2;

      const snapshot = createVeNFTStateSnapshot(entity, timestamp);

      expect(snapshot.id).toBe(
        VeNFTStateSnapshotId(entity.chainId, entity.tokenId, expectedEpochMs),
      );
      expect(snapshot.timestamp.getTime()).toBe(expectedEpochMs);
    });

    it("should copy entity fields into snapshot without persisting", () => {
      const entity = common.createMockVeNFTState({
        totalValueLocked: 1000n,
        locktime: 1n,
        isAlive: false,
      });
      const snapshot = createVeNFTStateSnapshot(entity, baseTimestamp);

      expect(snapshot.chainId).toBe(entity.chainId);
      expect(snapshot.tokenId).toBe(entity.tokenId);
      expect(snapshot.owner).toBe(entity.owner);
      expect(snapshot.totalValueLocked).toBe(entity.totalValueLocked);
      expect(snapshot.locktime).toBe(entity.locktime);
      expect(snapshot.isAlive).toBe(false);
    });
  });

  it("should compute snapshot epoch correctly (floor timestamp to interval boundary)", () => {
    const context = common.createMockContext({
      VeNFTStateSnapshot: { set: jest.fn() },
    });
    const entity = common.createMockVeNFTState();
    // 25 min into the 3rd hour → epoch should be start of 3rd hour
    const midEpochTimestamp = new Date(
      SNAPSHOT_INTERVAL_IN_MS * 3 + 25 * 60 * 1000,
    );
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 3;

    setVeNFTStateSnapshot(entity, midEpochTimestamp, context);

    const setArg = (context.VeNFTStateSnapshot.set as jest.Mock).mock
      .calls[0][0];
    expect(setArg.timestamp.getTime()).toBe(expectedEpochMs);
    expect(setArg.id).toBe(
      VeNFTStateSnapshotId(entity.chainId, entity.tokenId, expectedEpochMs),
    );
  });

  it("should set snapshot with epoch-aligned timestamp and correct id", () => {
    const context = common.createMockContext({
      VeNFTStateSnapshot: { set: jest.fn() },
    });
    const entity = common.createMockVeNFTState({
      totalValueLocked: 1000n,
      locktime: 1n,
    });
    const timestamp = new Date(baseTimestamp.getTime() + 10 * 60 * 1000);

    setVeNFTStateSnapshot(entity, timestamp, context);

    expect(context.VeNFTStateSnapshot.set).toHaveBeenCalledTimes(1);
    const setArg = (context.VeNFTStateSnapshot.set as jest.Mock).mock
      .calls[0][0];
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 2;
    expect(setArg.id).toBe(
      VeNFTStateSnapshotId(entity.chainId, entity.tokenId, expectedEpochMs),
    );
    expect(setArg.timestamp.getTime()).toBe(expectedEpochMs);
  });

  it("should spread entity fields into the snapshot", () => {
    const context = common.createMockContext({
      VeNFTStateSnapshot: { set: jest.fn() },
    });
    const entity = common.createMockVeNFTState({
      totalValueLocked: 1000n,
      locktime: 1n,
      isAlive: false,
    });

    setVeNFTStateSnapshot(entity, baseTimestamp, context);

    const setArg = (context.VeNFTStateSnapshot.set as jest.Mock).mock
      .calls[0][0];
    expect(setArg.chainId).toBe(entity.chainId);
    expect(setArg.tokenId).toBe(entity.tokenId);
    expect(setArg.owner).toBe(entity.owner);
    expect(setArg.totalValueLocked).toBe(entity.totalValueLocked);
    expect(setArg.locktime).toBe(entity.locktime);
    expect(setArg.lastUpdatedTimestamp).toEqual(entity.lastUpdatedTimestamp);
    expect(setArg.isAlive).toBe(entity.isAlive);
  });
});
