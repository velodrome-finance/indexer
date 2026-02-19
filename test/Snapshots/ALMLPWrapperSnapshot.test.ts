import {
  ALMLPWrapperSnapshotId,
  SNAPSHOT_INTERVAL_IN_MS,
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
    jest.clearAllMocks();
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
      ALM_LP_WrapperSnapshot: { set: jest.fn() },
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
    const setArg = (context.ALM_LP_WrapperSnapshot.set as jest.Mock).mock
      .calls[0][0];
    expect(setArg.id).toBe(expectedId);
    expect(setArg.timestamp.getTime()).toBe(expectedEpochMs);
  });

  it("should use full entity.id as wrapper when id has no hyphen (fallback branch)", () => {
    const context = common.createMockContext({
      ALM_LP_WrapperSnapshot: { set: jest.fn() },
    });
    const entityWithoutHyphenInId = {
      ...common.mockALMLPWrapperData,
      id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const expectedEpochMs = SNAPSHOT_INTERVAL_IN_MS * 3;
    const wrapperAddress = getWrapperAddressFromId(entityWithoutHyphenInId.id);

    setALMLPWrapperSnapshot(entityWithoutHyphenInId, baseTimestamp, context);

    const setArg = (context.ALM_LP_WrapperSnapshot.set as jest.Mock).mock
      .calls[0][0];
    expect(setArg.wrapper).toBe(wrapperAddress);
    expect(setArg.id).toBe(
      ALMLPWrapperSnapshotId(
        entityWithoutHyphenInId.chainId,
        wrapperAddress,
        expectedEpochMs,
      ),
    );
  });

  it("should spread entity fields into the snapshot", () => {
    const context = common.createMockContext({
      ALM_LP_WrapperSnapshot: { set: jest.fn() },
    });
    const entity = common.mockALMLPWrapperData;

    setALMLPWrapperSnapshot(entity, baseTimestamp, context);

    const setArg = (context.ALM_LP_WrapperSnapshot.set as jest.Mock).mock
      .calls[0][0];
    expect(setArg.chainId).toBe(entity.chainId);
    expect(setArg.pool).toBe(entity.pool);
    expect(setArg.token0).toBe(entity.token0);
    expect(setArg.token1).toBe(entity.token1);
    expect(setArg.lpAmount).toBe(entity.lpAmount);
    expect(setArg.liquidity).toBe(entity.liquidity);
    expect(setArg.tickLower).toBe(entity.tickLower);
    expect(setArg.tickUpper).toBe(entity.tickUpper);
  });
});
