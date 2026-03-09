import {
  SNAPSHOT_INTERVAL_IN_MS,
  VeNFTPoolVoteSnapshotId,
  VeNFTStateSnapshotId,
  toChecksumAddress,
} from "../../src/Constants";
import {
  createVeNFTPoolVoteSnapshot,
  setVeNFTPoolVoteSnapshot,
} from "../../src/Snapshots/VeNFTPoolVoteSnapshot";
import { createVeNFTStateSnapshot } from "../../src/Snapshots/VeNFTStateSnapshot";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("VeNFTPoolVoteSnapshot", () => {
  let common: ReturnType<typeof setupCommon>;
  const baseTimestamp = new Date(SNAPSHOT_INTERVAL_IN_MS * 2);

  beforeEach(() => {
    common = setupCommon();
    vi.restoreAllMocks();
  });

  it("should create an epoch-aligned vote snapshot linked to the veNFT snapshot", () => {
    const veNFTState = common.createMockVeNFTState();
    const veNFTStateSnapshot = createVeNFTStateSnapshot(
      veNFTState,
      baseTimestamp,
    );
    const poolVote = common.createMockVeNFTPoolVote({
      veNFTamountStaked: 123n,
    });

    const snapshot = createVeNFTPoolVoteSnapshot(
      poolVote,
      veNFTState,
      veNFTStateSnapshot,
      baseTimestamp,
    );

    expect(snapshot).toEqual({
      id: VeNFTPoolVoteSnapshotId(
        veNFTState.chainId,
        veNFTState.tokenId,
        poolVote.poolAddress,
        baseTimestamp.getTime(),
      ),
      chainId: veNFTState.chainId,
      tokenId: veNFTState.tokenId,
      poolAddress: poolVote.poolAddress,
      veNFTamountStaked: 123n,
      lastUpdatedTimestamp: poolVote.lastUpdatedTimestamp,
      timestamp: baseTimestamp,
      veNFTStateSnapshot_id: VeNFTStateSnapshotId(
        veNFTState.chainId,
        veNFTState.tokenId,
        baseTimestamp.getTime(),
      ),
    });
  });

  it("should persist the vote snapshot through shared snapshot persistence", () => {
    const context = common.createMockContext({
      VeNFTPoolVoteSnapshot: { set: vi.fn() },
    });
    const veNFTState = common.createMockVeNFTState();
    const veNFTStateSnapshot = createVeNFTStateSnapshot(
      veNFTState,
      baseTimestamp,
    );
    const poolVote = common.createMockVeNFTPoolVote({
      poolAddress: toChecksumAddress(
        "0x5555555555555555555555555555555555555555",
      ),
      veNFTamountStaked: 456n,
    });

    setVeNFTPoolVoteSnapshot(
      poolVote,
      veNFTState,
      veNFTStateSnapshot,
      baseTimestamp,
      context,
    );

    expect(context.VeNFTPoolVoteSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: VeNFTPoolVoteSnapshotId(
          veNFTState.chainId,
          veNFTState.tokenId,
          poolVote.poolAddress,
          baseTimestamp.getTime(),
        ),
        poolAddress: poolVote.poolAddress,
        veNFTamountStaked: 456n,
        veNFTStateSnapshot_id: veNFTStateSnapshot.id,
      }),
    );
  });
});
