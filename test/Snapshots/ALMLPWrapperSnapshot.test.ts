import {
  ALMLPWrapperSnapshotId,
  SNAPSHOT_INTERVAL_IN_MS,
  toChecksumAddress,
} from "../../src/Constants";
import {
  createALMLPWrapperSnapshot,
  setALMLPWrapperSnapshot,
} from "../../src/Snapshots/ALMLPWrapperSnapshot";
import { setupCommon } from "../EventHandlers/Pool/common";
import { getWrapperAddressFromId } from "./helpers";

describe("ALMLPWrapperSnapshot", () => {
  let common: ReturnType<typeof setupCommon>;
  const baseTimestamp = new Date(SNAPSHOT_INTERVAL_IN_MS * 3);
  beforeEach(() => {
    common = setupCommon();
    vi.restoreAllMocks();
  });

  describe("createALMLPWrapperSnapshot", () => {
    it("should return epoch-aligned snapshot with correct id and timestamp", () => {
      const entity = common.mockALMLPWrapperData;
      const timestamp = new Date(baseTimestamp.getTime() + 15 * 60 * 1000);
      const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 3;
      const wrapperAddress = getWrapperAddressFromId(entity.id);

      const snapshot = createALMLPWrapperSnapshot(entity, timestamp);

      expect(snapshot.id).toBe(
        ALMLPWrapperSnapshotId(entity.chainId, wrapperAddress, expectedEpochMs),
      );
      expect(snapshot.timestamp.getTime()).toBe(expectedEpochMs);
    });

    it("should copy entity fields into snapshot without persisting", () => {
      const entity = common.mockALMLPWrapperData;
      const snapshot = createALMLPWrapperSnapshot(entity, baseTimestamp);

      expect(snapshot.chainId).toBe(entity.chainId);
      expect(snapshot.pool).toBe(entity.pool);
      expect(snapshot.token0).toBe(entity.token0);
      expect(snapshot.token1).toBe(entity.token1);
      expect(snapshot.lpAmount).toBe(entity.lpAmount);
      expect(snapshot.liquidity).toBe(entity.liquidity);
      expect(snapshot.tickLower).toBe(entity.tickLower);
      expect(snapshot.tickUpper).toBe(entity.tickUpper);
    });
  });

  it("should call ALM_LP_WrapperSnapshot.set with correct id and epoch-aligned timestamp", () => {
    const context = common.createMockContext({
      ALM_LP_WrapperSnapshot: { set: vi.fn() },
    });
    const entity = common.mockALMLPWrapperData;
    const timestamp = new Date(baseTimestamp.getTime() + 15 * 60 * 1000);
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 3;
    const wrapperAddress = getWrapperAddressFromId(entity.id);
    const expectedId = ALMLPWrapperSnapshotId(
      entity.chainId,
      wrapperAddress,
      expectedEpochMs,
    );

    setALMLPWrapperSnapshot(entity, timestamp, context);

    expect(context.ALM_LP_WrapperSnapshot.set).toHaveBeenCalledTimes(1);
    expect(context.ALM_LP_WrapperSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expectedId,
        timestamp: new Date(expectedEpochMs),
      }),
    );
  });

  it("should use full entity.id as wrapper when id has no hyphen (fallback branch)", () => {
    const context = common.createMockContext({
      ALM_LP_WrapperSnapshot: { set: vi.fn() },
    });
    const entityWithoutHyphenInId = {
      ...common.mockALMLPWrapperData,
      id: toChecksumAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    };
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 3;
    const wrapperAddress = getWrapperAddressFromId(entityWithoutHyphenInId.id);

    setALMLPWrapperSnapshot(entityWithoutHyphenInId, baseTimestamp, context);

    expect(context.ALM_LP_WrapperSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        wrapper: wrapperAddress,
        id: ALMLPWrapperSnapshotId(
          entityWithoutHyphenInId.chainId,
          wrapperAddress,
          expectedEpochMs,
        ),
        timestamp: new Date(expectedEpochMs),
      }),
    );
  });

  it("should spread entity fields into the snapshot", () => {
    const context = common.createMockContext({
      ALM_LP_WrapperSnapshot: { set: vi.fn() },
    });
    const entity = common.mockALMLPWrapperData;
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 3;
    const wrapperAddress = getWrapperAddressFromId(entity.id);

    setALMLPWrapperSnapshot(entity, baseTimestamp, context);

    expect(context.ALM_LP_WrapperSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ALMLPWrapperSnapshotId(
          entity.chainId,
          wrapperAddress,
          expectedEpochMs,
        ),
        timestamp: new Date(expectedEpochMs),
        chainId: entity.chainId,
        pool: entity.pool,
        token0: entity.token0,
        token1: entity.token1,
        lpAmount: entity.lpAmount,
        liquidity: entity.liquidity,
        tickLower: entity.tickLower,
        tickUpper: entity.tickUpper,
      }),
    );
  });
});
