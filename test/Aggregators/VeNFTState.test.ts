import type { VeNFTState, handlerContext } from "generated";
import {
  loadVeNFTState,
  updateVeNFTState,
} from "../../src/Aggregators/VeNFTState";
import { VeNFTId, VeNFTStateSnapshotId } from "../../src/Constants";
import { getSnapshotEpoch } from "../../src/Snapshots/Shared";

function getVeNFTStateStore(
  ctx: Partial<handlerContext>,
): NonNullable<handlerContext["VeNFTState"]> {
  const store = ctx.VeNFTState;
  if (!store) throw new Error("test setup: VeNFTState mock required");
  return store;
}

describe("VeNFTState", () => {
  let mockContext: Partial<handlerContext>;
  const mockVeNFTState: VeNFTState = {
    id: VeNFTId(10, 1n),
    chainId: 10,
    tokenId: 1n,
    owner: "0x1111111111111111111111111111111111111111",
    locktime: 100n,
    lastUpdatedTimestamp: new Date(10000 * 1000),
    totalValueLocked: 100n,
    isAlive: true,
    lastSnapshotTimestamp: undefined,
  };
  const timestamp = new Date(10001 * 1000);

  beforeEach(() => {
    mockContext = {
      VeNFTState: {
        set: jest.fn(),
        get: jest.fn(),
        getOrThrow: jest.fn(),
        getOrCreate: jest.fn(),
        deleteUnsafe: jest.fn(),
        getWhere: {
          tokenId: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
        },
      },
      VeNFTStateSnapshot: {
        set: jest.fn(),
      } as unknown as handlerContext["VeNFTStateSnapshot"],
      log: {
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      },
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("VeNFTId", () => {
    it("returns id in format chainId-tokenId", () => {
      expect(VeNFTId(10, 1n)).toBe("10-1");
      expect(VeNFTId(8453, 42n)).toBe("8453-42");
    });
  });

  describe("loadVeNFTState", () => {
    it("returns VeNFTState when entity exists", async () => {
      const store = getVeNFTStateStore(mockContext);
      jest.mocked(store.get).mockResolvedValue(mockVeNFTState);

      const result = await loadVeNFTState(
        10,
        1n,
        mockContext as handlerContext,
      );

      expect(result).toEqual(mockVeNFTState);
      expect(store.get).toHaveBeenCalledWith(VeNFTId(10, 1n));
    });

    it("returns undefined and logs warn when entity does not exist", async () => {
      jest
        .mocked(getVeNFTStateStore(mockContext).get)
        .mockResolvedValue(undefined);

      const result = await loadVeNFTState(
        10,
        99n,
        mockContext as handlerContext,
      );

      expect(result).toBeUndefined();
      expect(mockContext.log?.warn).toHaveBeenCalledWith(
        "[loadVeNFTState] VeNFTState 10-99 not found",
      );
    });
  });

  describe("updateVeNFTState", () => {
    describe("when updating with deposit diff", () => {
      let result: VeNFTState;
      beforeEach(async () => {
        const depositDiff = {
          id: VeNFTId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          owner: "0x1111111111111111111111111111111111111111",
          locktime: 100n,
          incrementalTotalValueLocked: 50n,
          isAlive: true,
        };

        updateVeNFTState(
          depositDiff,
          mockVeNFTState,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(getVeNFTStateStore(mockContext).set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTState;
      });

      it("should update the VeNFTState with new values", () => {
        expect(result.id).toBe(VeNFTId(10, 1n));
        expect(result.owner).toBe("0x1111111111111111111111111111111111111111");
        expect(result.locktime).toBe(100n); // diff.locktime replaces current.locktime
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
        expect(result.totalValueLocked).toBe(150n); // 100n (current) + 50n (diff) = 150n
        expect(result.isAlive).toBe(true);
      });
    });

    describe("when updating with withdraw diff", () => {
      let result: VeNFTState;
      beforeEach(async () => {
        const withdrawDiff = {
          incrementalTotalValueLocked: -30n,
        };

        updateVeNFTState(
          withdrawDiff,
          mockVeNFTState,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(getVeNFTStateStore(mockContext).set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTState;
      });

      it("should update the VeNFTState with withdrawn amount", () => {
        expect(result.totalValueLocked).toBe(70n); // 100n - 30n = 70n
      });
    });

    describe("when updating with transfer diff", () => {
      let result: VeNFTState;
      beforeEach(async () => {
        const transferDiff = {
          owner: "0x2222222222222222222222222222222222222222",
          isAlive: true,
        };

        updateVeNFTState(
          transferDiff,
          mockVeNFTState,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(getVeNFTStateStore(mockContext).set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTState;
      });

      it("should update the VeNFTState with new owner", () => {
        expect(result.owner).toBe("0x2222222222222222222222222222222222222222");
      });
    });

    describe("when updating with burn diff", () => {
      let result: VeNFTState;
      beforeEach(async () => {
        const burnDiff = {
          owner: "0x0000000000000000000000000000000000000000",
          isAlive: false,
        };

        updateVeNFTState(
          burnDiff,
          mockVeNFTState,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(getVeNFTStateStore(mockContext).set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTState;
      });

      it("should set the VeNFTState to dead", () => {
        expect(result.isAlive).toBe(false);
      });
    });

    describe("when creating new entity", () => {
      let result: VeNFTState;
      beforeEach(async () => {
        // Create a dummy empty VeNFTState to add to
        const emptyVeNFT: VeNFTState = {
          id: "10-99",
          chainId: 10,
          tokenId: 99n,
          owner: "0x0000000000000000000000000000000000000000",
          locktime: 0n,
          lastUpdatedTimestamp: new Date(0),
          totalValueLocked: 0n,
          isAlive: false,
          lastSnapshotTimestamp: undefined,
        };

        const depositDiff = {
          incrementalTotalValueLocked: 100n,
          isAlive: true,
        };

        updateVeNFTState(
          depositDiff,
          emptyVeNFT,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(getVeNFTStateStore(mockContext).set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTState;
      });

      it("should create a new VeNFTState", () => {
        expect(result.totalValueLocked).toBe(100n);
        expect(result.isAlive).toBe(true);
      });
    });

    describe("lastSnapshotTimestamp", () => {
      it("should set lastSnapshotTimestamp to epoch when current has it undefined (first snapshot)", () => {
        const depositDiff = { incrementalTotalValueLocked: 10n };
        updateVeNFTState(
          depositDiff,
          mockVeNFTState, // lastSnapshotTimestamp: undefined
          timestamp,
          mockContext as handlerContext,
        );
        const result = getVeNFTStateStore(mockContext).set as jest.Mock;
        const updated = result.mock.calls[0][0] as VeNFTState;
        // When lastSnapshotTimestamp is undefined we take a snapshot and set it to the epoch
        expect(updated.lastSnapshotTimestamp).toBeDefined();
        expect(updated.lastSnapshotTimestamp?.getTime()).toBe(
          Math.floor(timestamp.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000),
        );
        // Verify VeNFTStateSnapshot persistence was invoked for the first snapshot
        expect(mockContext.VeNFTStateSnapshot?.set).toHaveBeenCalledTimes(1);
        const expectedEpoch = getSnapshotEpoch(timestamp);
        expect(mockContext.VeNFTStateSnapshot?.set).toHaveBeenCalledWith(
          expect.objectContaining({
            id: VeNFTStateSnapshotId(10, 1n, expectedEpoch.getTime()),
            chainId: 10,
            tokenId: 1n,
            owner: mockVeNFTState.owner,
            locktime: mockVeNFTState.locktime,
            lastUpdatedTimestamp: timestamp,
            totalValueLocked: 110n,
            isAlive: true,
            timestamp: expectedEpoch,
          }),
        );
      });

      it("should preserve lastSnapshotTimestamp when present and diff does not provide a newer one", () => {
        const stateWithSnapshot: VeNFTState = {
          ...mockVeNFTState,
          lastSnapshotTimestamp: new Date(9000 * 1000),
        };
        const depositDiff = { incrementalTotalValueLocked: 10n };
        updateVeNFTState(
          depositDiff,
          stateWithSnapshot,
          timestamp,
          mockContext as handlerContext,
        );
        const result = getVeNFTStateStore(mockContext).set as jest.Mock;
        const updated = result.mock.calls[0][0] as VeNFTState;
        expect(updated.lastSnapshotTimestamp).toEqual(new Date(9000 * 1000));
      });

      it("should replace lastSnapshotTimestamp when diff provides a newer value", () => {
        const stateWithOlderSnapshot: VeNFTState = {
          ...mockVeNFTState,
          lastSnapshotTimestamp: new Date(8000 * 1000),
        };
        const newerSnapshotTime = new Date(12000 * 1000);
        const depositDiff = {
          incrementalTotalValueLocked: 10n,
          lastSnapshotTimestamp: newerSnapshotTime,
        };
        updateVeNFTState(
          depositDiff,
          stateWithOlderSnapshot,
          timestamp,
          mockContext as handlerContext,
        );
        const result = getVeNFTStateStore(mockContext).set as jest.Mock;
        const updated = result.mock.calls[0][0] as VeNFTState;
        expect(updated.lastSnapshotTimestamp).toEqual(newerSnapshotTime);
      });

      it("should not replace lastSnapshotTimestamp when diff provides an older value", () => {
        const existingSnapshot = new Date(10000 * 1000);
        const stateWithNewerSnapshot: VeNFTState = {
          ...mockVeNFTState,
          lastSnapshotTimestamp: existingSnapshot,
        };
        const olderSnapshotTime = new Date(5000 * 1000);
        const depositDiff = {
          incrementalTotalValueLocked: 10n,
          lastSnapshotTimestamp: olderSnapshotTime,
        };
        updateVeNFTState(
          depositDiff,
          stateWithNewerSnapshot,
          timestamp,
          mockContext as handlerContext,
        );
        const result = getVeNFTStateStore(mockContext).set as jest.Mock;
        const updated = result.mock.calls[0][0] as VeNFTState;
        expect(updated.lastSnapshotTimestamp).toEqual(existingSnapshot);
      });
    });
  });
});
