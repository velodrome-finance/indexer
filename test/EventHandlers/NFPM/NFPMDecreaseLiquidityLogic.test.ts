import type { NonFungiblePosition, handlerContext } from "generated";
import { MockDb, NFPM } from "../../../generated/src/TestHelpers.gen";
import {
  type PoolData,
  loadPoolData,
} from "../../../src/Aggregators/LiquidityPoolAggregator";
import {
  NonFungiblePositionId,
  NonFungiblePositionSnapshotId,
} from "../../../src/Constants";
import {
  LiquidityChangeType,
  attributeLiquidityChangeToUserStatsPerPool,
} from "../../../src/EventHandlers/NFPM/NFPMCommonLogic";
import {
  calculateDecreaseLiquidityDiff,
  processNFPMDecreaseLiquidity,
} from "../../../src/EventHandlers/NFPM/NFPMDecreaseLiquidityLogic";
import { getSnapshotEpoch } from "../../../src/Snapshots/Shared";

vi.mock("../../../src/Aggregators/LiquidityPoolAggregator", async () => ({
  ...(await vi.importActual(
    "../../../src/Aggregators/LiquidityPoolAggregator",
  )),
  loadPoolData: vi.fn(),
}));

vi.mock("../../../src/EventHandlers/NFPM/NFPMCommonLogic", async () => ({
  ...(await vi.importActual("../../../src/EventHandlers/NFPM/NFPMCommonLogic")),
  attributeLiquidityChangeToUserStatsPerPool: vi.fn(),
}));

describe("NFPMDecreaseLiquidityLogic", () => {
  const chainId = 10;
  const tokenId = 540n;
  const poolAddress = "0x00cd0AbB6c2964F7Dfb5169dD94A9F004C35F458";
  const blockTimestamp = new Date(1712065791 * 1000);

  function expectSnapshotSet(context: handlerContext, liquidity: bigint): void {
    const epoch = getSnapshotEpoch(blockTimestamp);
    expect(context.NonFungiblePositionSnapshot.set).toHaveBeenCalledTimes(1);
    expect(context.NonFungiblePositionSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: NonFungiblePositionSnapshotId(chainId, tokenId, epoch.getTime()),
        chainId,
        tokenId,
        owner: mockPosition.owner,
        pool: poolAddress,
        liquidity,
        lastUpdatedTimestamp: blockTimestamp,
        timestamp: epoch,
      }),
    );
  }

  const mockPosition: NonFungiblePosition = {
    id: NonFungiblePositionId(chainId, poolAddress, tokenId),
    chainId: chainId,
    tokenId: tokenId,
    owner: "0x1DFAb7699121fEF702d07932a447868dCcCFb029",
    pool: poolAddress,
    tickUpper: 0n,
    tickLower: -4n,
    token0: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    token1: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
    liquidity: 373020348524042n, // Total liquidity before decrease
    mintTransactionHash:
      "0xaaa36689c538fcfee2e665f2c7b30bcf2f28ab898050252f50ec1f1d05a5392c",
    mintLogIndex: 42,
    lastUpdatedTimestamp: new Date(1711601595000),
    lastSnapshotTimestamp: undefined,
  };

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let mockContext: handlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadPoolData).mockResolvedValue(null);
    vi.mocked(attributeLiquidityChangeToUserStatsPerPool).mockResolvedValue();
    mockDb = MockDb.createMockDb();
    mockDb = mockDb.entities.NonFungiblePosition.set(mockPosition);

    // Setup getWhere for tokenId queries
    const storedPositions: NonFungiblePosition[] = [mockPosition];

    // Store original set method to avoid recursion
    const originalSet = mockDb.entities.NonFungiblePosition.set;

    // Helper to track positions when they're set
    const trackPosition = (entity: NonFungiblePosition) => {
      const index = storedPositions.findIndex((p) => p.id === entity.id);
      if (index >= 0) {
        storedPositions[index] = entity;
      } else {
        storedPositions.push(entity);
      }
    };

    mockContext = {
      ...mockDb,
      LiquidityPoolAggregator: {
        get: vi.fn().mockResolvedValue(undefined),
      },
      UserStatsPerPool: {
        get: vi.fn().mockResolvedValue(undefined),
        getWhere: vi.fn().mockResolvedValue([]),
        set: vi.fn(),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
      },
      UserStatsPerPoolSnapshot: {
        set: vi.fn(),
        get: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
      NonFungiblePositionSnapshot: {
        set: vi.fn(),
      },
      NonFungiblePosition: {
        ...mockDb.entities.NonFungiblePosition,
        getWhere: vi
          .fn()
          .mockImplementation((filter: { tokenId?: { _eq?: bigint } }) =>
            Promise.resolve(
              storedPositions.filter((p) => p.tokenId === filter?.tokenId?._eq),
            ),
          ),
        set: (entity: NonFungiblePosition) => {
          trackPosition(entity);
          const updatedDb = originalSet(entity);
          mockDb = updatedDb;
          return updatedDb;
        },
        get: (id: string) => {
          return mockDb.entities.NonFungiblePosition.get(id);
        },
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as handlerContext;
  });

  describe("calculateDecreaseLiquidityDiff", () => {
    it("should calculate correct liquidity decrease", () => {
      const mockEvent = NFPM.DecreaseLiquidity.createMockEvent({
        tokenId: tokenId,
        liquidity: 373020348524042n,
        amount0: 0n,
        amount1: 74592880586n,
        mockEventData: {
          block: {
            timestamp: 1712065791,
            number: 118233507,
            hash: "0x0254451c8999a43d90b4efc69de225e676864561fc1eef2bfe6e1940d613e3f8",
          },
          chainId: chainId,
          logIndex: 96,
          srcAddress: "0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4",
        },
      });

      const diff = calculateDecreaseLiquidityDiff(mockEvent);

      expect(diff.incrementalLiquidity).toBe(-373020348524042n);
      expect(diff.lastUpdatedTimestamp).toEqual(new Date(1712065791 * 1000));
    });

    it("should handle zero liquidity decrease", () => {
      const mockEvent = NFPM.DecreaseLiquidity.createMockEvent({
        tokenId: tokenId,
        liquidity: 0n,
        amount0: 0n,
        amount1: 0n,
        mockEventData: {
          block: {
            timestamp: 1712065791,
            number: 118233507,
            hash: "0x0254451c8999a43d90b4efc69de225e676864561fc1eef2bfe6e1940d613e3f8",
          },
          chainId: chainId,
          logIndex: 96,
          srcAddress: "0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4",
        },
      });

      const diff = calculateDecreaseLiquidityDiff(mockEvent);

      expect(diff.incrementalLiquidity).toBe(0n);
    });
  });

  describe("processNFPMDecreaseLiquidity", () => {
    it("should process decrease liquidity event and update position", async () => {
      const mockEvent = NFPM.DecreaseLiquidity.createMockEvent({
        tokenId: tokenId,
        liquidity: 373020348524042n,
        amount0: 0n,
        amount1: 74592880586n,
        mockEventData: {
          block: {
            timestamp: 1712065791,
            number: 118233507,
            hash: "0x0254451c8999a43d90b4efc69de225e676864561fc1eef2bfe6e1940d613e3f8",
          },
          chainId: chainId,
          logIndex: 96,
          srcAddress: "0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4",
        },
      });

      await processNFPMDecreaseLiquidity(mockEvent, mockContext);

      const updatedPosition = mockDb.entities.NonFungiblePosition.get(
        mockPosition.id,
      );
      expect(updatedPosition).toBeDefined();
      if (!updatedPosition) return;

      // Liquidity should be decreased: 373020348524042 - 373020348524042 = 0
      expect(updatedPosition.liquidity).toBe(0n);
      expect(updatedPosition.lastUpdatedTimestamp).toEqual(
        new Date(1712065791 * 1000),
      );

      expectSnapshotSet(mockContext, 0n);
    });

    it("should handle partial liquidity decrease", async () => {
      const decreaseAmount = 100000000000000n; // Smaller than current liquidity
      const mockEvent = NFPM.DecreaseLiquidity.createMockEvent({
        tokenId: tokenId,
        liquidity: decreaseAmount,
        amount0: 0n,
        amount1: 20000000000n,
        mockEventData: {
          block: {
            timestamp: 1712065791,
            number: 118233507,
            hash: "0x0254451c8999a43d90b4efc69de225e676864561fc1eef2bfe6e1940d613e3f8",
          },
          chainId: chainId,
          logIndex: 96,
          srcAddress: "0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4",
        },
      });

      await processNFPMDecreaseLiquidity(mockEvent, mockContext);

      const updatedPosition = mockDb.entities.NonFungiblePosition.get(
        mockPosition.id,
      );
      expect(updatedPosition).toBeDefined();
      if (!updatedPosition) return;

      // Liquidity should be decreased: 373020348524042 - 100000000000000 = 273020348524042
      const expectedLiquidity = 373020348524042n - decreaseAmount;
      expect(updatedPosition.liquidity).toBe(expectedLiquidity);

      expectSnapshotSet(mockContext, expectedLiquidity);
    });

    it("should log error and return early if position not found", async () => {
      const mockEvent = NFPM.DecreaseLiquidity.createMockEvent({
        tokenId: 999n, // Non-existent tokenId
        liquidity: 100000000000000000n,
        amount0: 0n,
        amount1: 20000000000n,
        mockEventData: {
          block: {
            timestamp: 1712065791,
            number: 118233507,
            hash: "0x0254451c8999a43d90b4efc69de225e676864561fc1eef2bfe6e1940d613e3f8",
          },
          chainId: chainId,
          logIndex: 96,
          srcAddress: "0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4",
        },
      });

      await processNFPMDecreaseLiquidity(mockEvent, mockContext);

      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining("not found during decrease liquidity"),
      );

      expect(
        mockContext.NonFungiblePositionSnapshot.set,
      ).not.toHaveBeenCalled();

      // Position should remain unchanged
      const position = mockDb.entities.NonFungiblePosition.get(mockPosition.id);
      expect(position?.liquidity).toBe(mockPosition.liquidity);
    });

    it("does not call attributeLiquidityChangeToUserStatsPerPool when loadPoolData returns null", async () => {
      // loadPoolData left as beforeEach default (null)
      const mockEvent = NFPM.DecreaseLiquidity.createMockEvent({
        tokenId: tokenId,
        liquidity: 373020348524042n,
        amount0: 0n,
        amount1: 74592880586n,
        mockEventData: {
          block: {
            timestamp: 1712065791,
            number: 118233507,
            hash: "0x0254451c8999a43d90b4efc69de225e676864561fc1eef2bfe6e1940d613e3f8",
          },
          chainId: chainId,
          logIndex: 96,
          srcAddress: "0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4",
        },
      });

      await processNFPMDecreaseLiquidity(mockEvent, mockContext);

      expect(
        vi.mocked(attributeLiquidityChangeToUserStatsPerPool),
      ).not.toHaveBeenCalled();

      expectSnapshotSet(mockContext, 0n);
    });

    it("calls attributeLiquidityChangeToUserStatsPerPool when poolData is loaded", async () => {
      const mockPoolData: PoolData = {
        token0Instance: {} as PoolData["token0Instance"],
        token1Instance: {} as PoolData["token1Instance"],
        liquidityPoolAggregator: {
          chainId,
        } as PoolData["liquidityPoolAggregator"],
      };
      const mockEvent = NFPM.DecreaseLiquidity.createMockEvent({
        tokenId: tokenId,
        liquidity: 373020348524042n,
        amount0: 0n,
        amount1: 74592880586n,
        mockEventData: {
          block: {
            timestamp: 1712065791,
            number: 118233507,
            hash: "0x0254451c8999a43d90b4efc69de225e676864561fc1eef2bfe6e1940d613e3f8",
          },
          chainId: chainId,
          logIndex: 96,
          srcAddress: "0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4",
        },
      });

      vi.mocked(loadPoolData).mockResolvedValue(mockPoolData);
      await processNFPMDecreaseLiquidity(mockEvent, mockContext);

      expect(attributeLiquidityChangeToUserStatsPerPool).toHaveBeenCalledTimes(
        1,
      );
      const [owner, poolAddr, data, , amount0, amount1, ts, type] = vi.mocked(
        attributeLiquidityChangeToUserStatsPerPool,
      ).mock.calls[0];
      expect(owner).toBe(mockPosition.owner);
      expect(poolAddr).toBe(poolAddress);
      expect(data).toBe(mockPoolData);
      expect(amount0).toBe(0n);
      expect(amount1).toBe(74592880586n);
      expect(ts).toBe(1712065791);
      expect(type).toBe(LiquidityChangeType.REMOVE);

      expectSnapshotSet(mockContext, 0n);
    });
  });
});
