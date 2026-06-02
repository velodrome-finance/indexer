import type { VeNFTState } from "envio";
import {
  loadVeNFTState,
  updateVeNFTState,
} from "../../src/Aggregators/VeNFTState";
import {
  VeNFTId,
  VeNFTStateSnapshotId,
  toChecksumAddress,
} from "../../src/Constants";
import type { handlerContext } from "../../src/EntityTypes";
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
    owner: toChecksumAddress("0x1111111111111111111111111111111111111111"),
    locktime: 100n,
    isPermanent: false,
    lastUpdatedTimestamp: new Date(10000 * 1000),
    totalValueLocked: 100n,
    isAlive: true,
    lastSnapshotTimestamp: undefined,
  };
  const timestamp = new Date(10001 * 1000);

  beforeEach(() => {
    mockContext = {
      VeNFTState: {
        set: vi.fn(),
        get: vi.fn(),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
      VeNFTStateSnapshot: {
        set: vi.fn(),
      } as unknown as handlerContext["VeNFTStateSnapshot"],
      VeNFTPoolVote: {
        getWhere: vi.fn().mockResolvedValue([]),
      } as unknown as handlerContext["VeNFTPoolVote"],
      VeNFTPoolVoteSnapshot: {
        set: vi.fn(),
      } as unknown as handlerContext["VeNFTPoolVoteSnapshot"],
      log: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      vi.mocked(store.get).mockResolvedValue(mockVeNFTState);

      const result = await loadVeNFTState(
        10,
        1n,
        mockContext as handlerContext,
      );

      expect(result).toEqual(mockVeNFTState);
      expect(store.get).toHaveBeenCalledWith(VeNFTId(10, 1n));
    });

    it("returns undefined and logs warn when entity does not exist", async () => {
      vi.mocked(getVeNFTStateStore(mockContext).get).mockResolvedValue(
        undefined,
      );

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
          owner: toChecksumAddress(
            "0x1111111111111111111111111111111111111111",
          ),
          locktime: 100n,
          incrementalTotalValueLocked: 50n,
          isAlive: true,
        };

        await updateVeNFTState(
          depositDiff,
          mockVeNFTState,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
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

        await updateVeNFTState(
          withdrawDiff,
          mockVeNFTState,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTState;
      });

      it("should update the VeNFTState with withdrawn amount", () => {
        expect(result.totalValueLocked).toBe(70n); // 100n - 30n = 70n
      });
    });

    describe("when a decrement drives totalValueLocked negative (issue #816)", () => {
      let result: VeNFTState;
      beforeEach(async () => {
        // Zero-initialised shell: a decrement is processed against state the
        // matching deposit never populated (e.g. the deposit was not indexed),
        // so the raw subtraction would persist as a negative balance.
        const zeroShell: VeNFTState = {
          ...mockVeNFTState,
          totalValueLocked: 0n,
        };
        const overdraftDiff = {
          incrementalTotalValueLocked: -100n,
        };

        await updateVeNFTState(
          overdraftDiff,
          zeroShell,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
        result = mockSet?.mock.calls[0]?.[0] as VeNFTState;
      });

      it("clamps totalValueLocked to 0n instead of persisting a negative", () => {
        expect(result.totalValueLocked).toBe(0n);
      });

      it("emits a [NEG_VENFT_TVL_GUARD] warn log with diagnostic fields", () => {
        const warn = vi.mocked(mockContext.log?.warn);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("[NEG_VENFT_TVL_GUARD]"),
        );
        const msg = warn?.mock.calls
          .map((c) => c[0] as string)
          .find((m) => m.includes("[NEG_VENFT_TVL_GUARD]"));
        expect(msg).toContain("priorTVL=0");
        expect(msg).toContain("delta=-100");
        expect(msg).toContain("clampedTo=0");
      });
    });

    describe("when updating with transfer diff", () => {
      let result: VeNFTState;
      beforeEach(async () => {
        const transferDiff = {
          owner: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ),
          isAlive: true,
        };

        await updateVeNFTState(
          transferDiff,
          mockVeNFTState,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTState;
      });

      it("should update the VeNFTState with new owner", () => {
        expect(result.owner).toBe(
          toChecksumAddress("0x2222222222222222222222222222222222222222"),
        );
      });
    });

    describe("when updating with permanent-lock diff", () => {
      it("flips isPermanent to true and zeroes locktime", async () => {
        const lockDiff = {
          isPermanent: true,
          locktime: 0n,
        };

        await updateVeNFTState(
          lockDiff,
          mockVeNFTState,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
        const result = mockSet?.mock.calls[0]?.[0] as VeNFTState;
        expect(result.isPermanent).toBe(true);
        expect(result.locktime).toBe(0n);
      });

      it("restores isPermanent to false on unlock", async () => {
        const permanentState: VeNFTState = {
          ...mockVeNFTState,
          isPermanent: true,
          locktime: 0n,
        };
        const unlockDiff = {
          isPermanent: false,
          locktime: 9999n,
        };

        await updateVeNFTState(
          unlockDiff,
          permanentState,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
        const result = mockSet?.mock.calls[0]?.[0] as VeNFTState;
        expect(result.isPermanent).toBe(false);
        expect(result.locktime).toBe(9999n);
      });

      it("preserves isPermanent when diff does not provide it", async () => {
        const permanentState: VeNFTState = {
          ...mockVeNFTState,
          isPermanent: true,
          locktime: 0n,
        };
        const incrementOnly = { incrementalTotalValueLocked: 5n };

        await updateVeNFTState(
          incrementOnly,
          permanentState,
          timestamp,
          mockContext as handlerContext,
        );

        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
        const result = mockSet?.mock.calls[0]?.[0] as VeNFTState;
        expect(result.isPermanent).toBe(true);
        expect(result.locktime).toBe(0n);
      });
    });

    describe("locktime=0 ∧ !isPermanent ∧ isAlive invariant guard", () => {
      it("warns when the final state violates the permanent-lock invariant", async () => {
        const freshState: VeNFTState = {
          ...mockVeNFTState,
          locktime: 0n,
          isPermanent: false,
          isAlive: true,
        };
        const violatingDiff = {
          // Mirrors the pre-fix one-shot permanent-create pathology: a Deposit
          // landing locktime=0 without inferring isPermanent.
          locktime: 0n,
          incrementalTotalValueLocked: 100n,
          isAlive: true,
        };

        await updateVeNFTState(
          violatingDiff,
          freshState,
          timestamp,
          mockContext as handlerContext,
        );

        expect(mockContext.log?.warn).toHaveBeenCalledWith(
          expect.stringContaining("[VENFT_LOCKSTATE_INVARIANT]"),
        );
      });

      it("does not warn when the lock is a valid permanent (locktime=0 ∧ isPermanent)", async () => {
        const permanentState: VeNFTState = {
          ...mockVeNFTState,
          locktime: 0n,
          isPermanent: true,
          isAlive: true,
        };
        const incrementOnly = { incrementalTotalValueLocked: 5n };

        await updateVeNFTState(
          incrementOnly,
          permanentState,
          timestamp,
          mockContext as handlerContext,
        );

        expect(mockContext.log?.warn).not.toHaveBeenCalled();
      });

      it("does not warn when the lock is dead (locktime=0 ∧ !isAlive)", async () => {
        const burnedState: VeNFTState = {
          ...mockVeNFTState,
          locktime: 0n,
          isPermanent: false,
          isAlive: false,
        };
        const noopDiff = {};

        await updateVeNFTState(
          noopDiff,
          burnedState,
          timestamp,
          mockContext as handlerContext,
        );

        expect(mockContext.log?.warn).not.toHaveBeenCalled();
      });
    });

    describe("when updating with burn diff", () => {
      let result: VeNFTState;
      beforeEach(async () => {
        const burnDiff = {
          owner: toChecksumAddress(
            "0x0000000000000000000000000000000000000000",
          ),
          isAlive: false,
        };

        await updateVeNFTState(
          burnDiff,
          mockVeNFTState,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
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
          owner: toChecksumAddress(
            "0x0000000000000000000000000000000000000000",
          ),
          locktime: 0n,
          isPermanent: false,
          lastUpdatedTimestamp: new Date(0),
          totalValueLocked: 0n,
          isAlive: false,
          lastSnapshotTimestamp: undefined,
        };

        const depositDiff = {
          incrementalTotalValueLocked: 100n,
          isAlive: true,
        };

        await updateVeNFTState(
          depositDiff,
          emptyVeNFT,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTState;
      });

      it("should create a new VeNFTState", () => {
        expect(result.totalValueLocked).toBe(100n);
        expect(result.isAlive).toBe(true);
      });
    });

    describe("lastSnapshotTimestamp", () => {
      it("should set lastSnapshotTimestamp to epoch when current has it undefined (first snapshot)", async () => {
        const depositDiff = { incrementalTotalValueLocked: 10n };
        await updateVeNFTState(
          depositDiff,
          mockVeNFTState, // lastSnapshotTimestamp: undefined
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
        const updated = mockSet.mock.calls[0][0] as VeNFTState;
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

      it("should preserve lastSnapshotTimestamp when present and diff does not provide a newer one", async () => {
        const stateWithSnapshot: VeNFTState = {
          ...mockVeNFTState,
          lastSnapshotTimestamp: new Date(9000 * 1000),
        };
        const depositDiff = { incrementalTotalValueLocked: 10n };
        await updateVeNFTState(
          depositDiff,
          stateWithSnapshot,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
        const updated = mockSet.mock.calls[0][0] as VeNFTState;
        expect(updated.lastSnapshotTimestamp).toEqual(new Date(9000 * 1000));
      });

      it("should replace lastSnapshotTimestamp when diff provides a newer value", async () => {
        const stateWithOlderSnapshot: VeNFTState = {
          ...mockVeNFTState,
          lastSnapshotTimestamp: new Date(8000 * 1000),
        };
        const newerSnapshotTime = new Date(12000 * 1000);
        const depositDiff = {
          incrementalTotalValueLocked: 10n,
          lastSnapshotTimestamp: newerSnapshotTime,
        };
        await updateVeNFTState(
          depositDiff,
          stateWithOlderSnapshot,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
        const updated = mockSet.mock.calls[0][0] as VeNFTState;
        expect(updated.lastSnapshotTimestamp).toEqual(newerSnapshotTime);
      });

      it("should not replace lastSnapshotTimestamp when diff provides an older value", async () => {
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
        await updateVeNFTState(
          depositDiff,
          stateWithNewerSnapshot,
          timestamp,
          mockContext as handlerContext,
        );
        const mockSet = vi.mocked(getVeNFTStateStore(mockContext).set);
        const updated = mockSet.mock.calls[0][0] as VeNFTState;
        expect(updated.lastSnapshotTimestamp).toEqual(existingSnapshot);
      });
    });
  });
});
