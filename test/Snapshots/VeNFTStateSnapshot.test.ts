import {
  SNAPSHOT_INTERVAL_IN_MS,
  VeNFTPoolVoteSnapshotId,
  VeNFTStateSnapshotId,
  toChecksumAddress,
} from "../../src/Constants";
import {
  createVeNFTStateSnapshot,
  setVeNFTStateSnapshot,
} from "../../src/Snapshots/VeNFTStateSnapshot";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("VeNFTStateSnapshot", () => {
  let common: ReturnType<typeof setupCommon>;
  const baseTimestamp = new Date(SNAPSHOT_INTERVAL_IN_MS * 2);
  const createVeNFTSnapshotContext = (
    poolVotes: ReturnType<typeof common.createMockVeNFTPoolVote>[] = [],
  ) =>
    common.createMockContext({
      VeNFTStateSnapshot: { set: vi.fn() },
      VeNFTPoolVote: { getWhere: vi.fn().mockResolvedValue(poolVotes) },
      VeNFTPoolVoteSnapshot: { set: vi.fn() },
    });

  beforeEach(() => {
    common = setupCommon();
    vi.restoreAllMocks();
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

  it("should compute snapshot epoch correctly (floor timestamp to interval boundary)", async () => {
    const context = createVeNFTSnapshotContext();
    const entity = common.createMockVeNFTState();
    // 25 min into the 3rd hour → epoch should be start of 3rd hour
    const midEpochTimestamp = new Date(
      SNAPSHOT_INTERVAL_IN_MS * 3 + 25 * 60 * 1000,
    );
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 3;

    await setVeNFTStateSnapshot(entity, midEpochTimestamp, context);

    expect(context.VeNFTStateSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: VeNFTStateSnapshotId(
          entity.chainId,
          entity.tokenId,
          expectedEpochMs,
        ),
        timestamp: new Date(expectedEpochMs),
      }),
    );
  });

  it("should set snapshot with epoch-aligned timestamp and correct id", async () => {
    const context = createVeNFTSnapshotContext();
    const entity = common.createMockVeNFTState({
      totalValueLocked: 1000n,
      locktime: 1n,
    });
    const timestamp = new Date(baseTimestamp.getTime() + 10 * 60 * 1000);
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 2;

    await setVeNFTStateSnapshot(entity, timestamp, context);

    expect(context.VeNFTStateSnapshot.set).toHaveBeenCalledTimes(1);
    expect(context.VeNFTStateSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: VeNFTStateSnapshotId(
          entity.chainId,
          entity.tokenId,
          expectedEpochMs,
        ),
        timestamp: new Date(expectedEpochMs),
      }),
    );
  });

  it("should spread entity fields into the snapshot", async () => {
    const context = createVeNFTSnapshotContext();
    const entity = common.createMockVeNFTState({
      totalValueLocked: 1000n,
      locktime: 1n,
      isAlive: false,
    });
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 2;

    await setVeNFTStateSnapshot(entity, baseTimestamp, context);

    expect(context.VeNFTStateSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: VeNFTStateSnapshotId(
          entity.chainId,
          entity.tokenId,
          expectedEpochMs,
        ),
        timestamp: new Date(expectedEpochMs),
        chainId: entity.chainId,
        tokenId: entity.tokenId,
        owner: entity.owner,
        totalValueLocked: entity.totalValueLocked,
        locktime: entity.locktime,
        lastUpdatedTimestamp: entity.lastUpdatedTimestamp,
        isAlive: entity.isAlive,
      }),
    );
  });

  it("should persist no vote snapshots when the veNFT has no pool votes", async () => {
    const context = createVeNFTSnapshotContext();
    const entity = common.createMockVeNFTState();

    await setVeNFTStateSnapshot(entity, baseTimestamp, context);

    expect(context.VeNFTPoolVote.getWhere).toHaveBeenCalledWith({
      veNFTState_id: { _eq: entity.id },
    });
    expect(context.VeNFTPoolVoteSnapshot.set).not.toHaveBeenCalled();
  });

  it("should persist vote snapshots for each live pool vote using the same epoch", async () => {
    const secondaryPoolAddress = toChecksumAddress(
      "0x4444444444444444444444444444444444444444",
    );
    const context = createVeNFTSnapshotContext([
      common.createMockVeNFTPoolVote({
        poolAddress: common.mockLiquidityPoolData.poolAddress,
        veNFTamountStaked: 100n,
      }),
      common.createMockVeNFTPoolVote({
        poolAddress: secondaryPoolAddress,
        veNFTamountStaked: 250n,
      }),
    ]);
    const entity = common.createMockVeNFTState();
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 2;

    await setVeNFTStateSnapshot(entity, baseTimestamp, context);

    expect(context.VeNFTPoolVoteSnapshot.set).toHaveBeenCalledTimes(2);
    expect(context.VeNFTPoolVoteSnapshot.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: VeNFTPoolVoteSnapshotId(
          entity.chainId,
          entity.tokenId,
          common.mockLiquidityPoolData.poolAddress,
          expectedEpochMs,
        ),
        chainId: entity.chainId,
        tokenId: entity.tokenId,
        poolAddress: common.mockLiquidityPoolData.poolAddress,
        veNFTamountStaked: 100n,
        veNFTStateSnapshot_id: VeNFTStateSnapshotId(
          entity.chainId,
          entity.tokenId,
          expectedEpochMs,
        ),
        timestamp: new Date(expectedEpochMs),
      }),
    );
    expect(context.VeNFTPoolVoteSnapshot.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: VeNFTPoolVoteSnapshotId(
          entity.chainId,
          entity.tokenId,
          secondaryPoolAddress,
          expectedEpochMs,
        ),
        chainId: entity.chainId,
        tokenId: entity.tokenId,
        poolAddress: secondaryPoolAddress,
        veNFTamountStaked: 250n,
        veNFTStateSnapshot_id: VeNFTStateSnapshotId(
          entity.chainId,
          entity.tokenId,
          expectedEpochMs,
        ),
        timestamp: new Date(expectedEpochMs),
      }),
    );
  });
});
