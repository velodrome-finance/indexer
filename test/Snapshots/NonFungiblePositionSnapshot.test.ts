import {
  NonFungiblePositionSnapshotId,
  SNAPSHOT_INTERVAL_IN_MS,
} from "../../src/Constants";
import { setNonFungiblePositionSnapshot } from "../../src/Snapshots/NonFungiblePositionSnapshot";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("NonFungiblePositionSnapshot", () => {
  let common: ReturnType<typeof setupCommon>;
  const baseTimestamp = new Date(SNAPSHOT_INTERVAL_IN_MS * 6);
  const blockNumber = 300000;

  beforeEach(() => {
    common = setupCommon();
    jest.clearAllMocks();
  });

  it("should set snapshot with epoch-aligned timestamp and correct id", () => {
    const context = common.createMockContext({
      NonFungiblePositionSnapshot: { set: jest.fn() },
    });
    const entity = common.createMockNonFungiblePosition();
    const timestamp = new Date(baseTimestamp.getTime() + 20 * 60 * 1000);

    setNonFungiblePositionSnapshot(entity, timestamp, blockNumber, context);

    expect(context.NonFungiblePositionSnapshot.set).toHaveBeenCalledTimes(1);
    const setArg = (context.NonFungiblePositionSnapshot.set as jest.Mock).mock
      .calls[0][0];
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 6;
    expect(setArg.id).toBe(
      NonFungiblePositionSnapshotId(
        entity.chainId,
        entity.tokenId,
        expectedEpochMs,
      ),
    );
    expect(setArg.timestamp.getTime()).toBe(expectedEpochMs);
    expect(setArg.blockNumber).toBe(blockNumber);
  });

  it("should spread entity fields into the snapshot", () => {
    const context = common.createMockContext({
      NonFungiblePositionSnapshot: { set: jest.fn() },
    });
    const entity = common.createMockNonFungiblePosition({ liquidity: 5000n });

    setNonFungiblePositionSnapshot(entity, baseTimestamp, blockNumber, context);

    const setArg = (context.NonFungiblePositionSnapshot.set as jest.Mock).mock
      .calls[0][0];
    expect(setArg.chainId).toBe(entity.chainId);
    expect(setArg.tokenId).toBe(entity.tokenId);
    expect(setArg.pool).toBe(entity.pool);
    expect(setArg.liquidity).toBe(5000n);
  });
});
