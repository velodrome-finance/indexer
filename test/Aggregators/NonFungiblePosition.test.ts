import type { NonFungiblePosition, handlerContext } from "generated";
import { updateNonFungiblePosition } from "../../src/Aggregators/NonFungiblePosition";
import { NonFungiblePositionId, toChecksumAddress } from "../../src/Constants";
import { getSnapshotEpoch } from "../../src/Snapshots/Shared";

describe("NonFungiblePosition", () => {
  let mockContext: Partial<handlerContext>;
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const poolAddress = toChecksumAddress(
    "0x0000000000000000000000000000000000000001",
  );
  const mockNonFungiblePosition: NonFungiblePosition = {
    id: NonFungiblePositionId(10, poolAddress, 1n),
    chainId: 10,
    tokenId: 1n,
    owner: toChecksumAddress("0x1111111111111111111111111111111111111111"),
    pool: poolAddress,
    tickUpper: 100n,
    tickLower: -100n,
    token0: toChecksumAddress("0x0000000000000000000000000000000000000002"),
    token1: toChecksumAddress("0x0000000000000000000000000000000000000003"),
    liquidity: 1000000000000000000n,
    mintTransactionHash: transactionHash,
    mintLogIndex: 42,
    lastUpdatedTimestamp: new Date(10000 * 1000),
    lastSnapshotTimestamp: undefined,
  };
  const timestamp = new Date(10001 * 1000);

  beforeEach(() => {
    mockContext = {
      NonFungiblePositionSnapshot: {
        set: vi.fn(),
      } as unknown as handlerContext["NonFungiblePositionSnapshot"],
      NonFungiblePosition: {
        set: vi.fn(),
        get: vi.fn(),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
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

  describe("updateNonFungiblePosition", () => {
    describe("when updating with transfer diff (owner change)", () => {
      let result: NonFungiblePosition;
      beforeEach(async () => {
        const transferDiff = {
          id: NonFungiblePositionId(10, poolAddress, 1n),
          chainId: 10,
          tokenId: 1n,
          owner: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ),
          lastUpdatedTimestamp: timestamp,
          lastSnapshotTimestamp: undefined,
        };

        updateNonFungiblePosition(
          transferDiff,
          mockNonFungiblePosition,
          mockContext as handlerContext,
          timestamp,
        );
        const mockSet = vi.mocked(mockContext.NonFungiblePosition?.set);
        result = mockSet?.mock.calls[0]?.[0] as NonFungiblePosition;
      });

      it("should update the nonFungiblePosition with new owner", () => {
        expect(result.id).toBe(NonFungiblePositionId(10, poolAddress, 1n));
        expect(result.owner).toBe(
          toChecksumAddress("0x2222222222222222222222222222222222222222"),
        );
        expect(result.tickUpper).toBe(100n); // unchanged
        expect(result.tickLower).toBe(-100n); // unchanged
        expect(result.liquidity).toBe(1000000000000000000n); // unchanged
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
        // When lastSnapshotTimestamp was undefined we take a snapshot and set it to the snapshot epoch (start of interval containing timestamp)
        const expectedSnapshotEpoch = getSnapshotEpoch(timestamp);
        expect(result.lastSnapshotTimestamp?.getTime()).toBe(
          expectedSnapshotEpoch.getTime(),
        );
        expect(mockContext.NonFungiblePositionSnapshot?.set).toHaveBeenCalled();
      });
    });

    describe("when updating with increase liquidity diff", () => {
      let result: NonFungiblePosition;
      beforeEach(async () => {
        const increaseDiff = {
          incrementalLiquidity: 500000000000000000n, // add liquidity
          lastUpdatedTimestamp: timestamp,
          lastSnapshotTimestamp: undefined,
        };

        updateNonFungiblePosition(
          increaseDiff,
          mockNonFungiblePosition,
          mockContext as handlerContext,
          timestamp,
        );
        const mockSet = vi.mocked(mockContext.NonFungiblePosition?.set);
        result = mockSet?.mock.calls[0]?.[0] as NonFungiblePosition;
      });

      it("should update liquidity incrementally", () => {
        expect(result.liquidity).toBe(1500000000000000000n); // 1000000000000000000n + 500000000000000000n
        expect(result.owner).toBe(
          toChecksumAddress("0x1111111111111111111111111111111111111111"),
        ); // unchanged
        expect(result.tickUpper).toBe(100n); // unchanged
        expect(result.tickLower).toBe(-100n); // unchanged
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
        expect(mockContext.NonFungiblePositionSnapshot?.set).toHaveBeenCalled();
      });
    });

    describe("when updating with decrease liquidity diff", () => {
      let result: NonFungiblePosition;
      beforeEach(async () => {
        const decreaseDiff = {
          incrementalLiquidity: -300000000000000000n, // remove liquidity
          lastUpdatedTimestamp: timestamp,
          lastSnapshotTimestamp: undefined,
        };

        updateNonFungiblePosition(
          decreaseDiff,
          mockNonFungiblePosition,
          mockContext as handlerContext,
          timestamp,
        );
        const mockSet = vi.mocked(mockContext.NonFungiblePosition?.set);
        result = mockSet?.mock.calls[0]?.[0] as NonFungiblePosition;
      });

      it("should update liquidity incrementally", () => {
        expect(result.liquidity).toBe(700000000000000000n); // 1000000000000000000n - 300000000000000000n
        expect(result.owner).toBe(
          toChecksumAddress("0x1111111111111111111111111111111111111111"),
        ); // unchanged
        expect(result.tickUpper).toBe(100n); // unchanged
        expect(result.tickLower).toBe(-100n); // unchanged
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
        expect(mockContext.NonFungiblePositionSnapshot?.set).toHaveBeenCalled();
      });
    });
  });
});
