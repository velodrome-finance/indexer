import type { CLPoolMintEvent, NonFungiblePosition } from "envio";
import { type PoolData, loadPoolData } from "../../../src/Aggregators/Pool";
import {
  CLPoolMintEventId,
  NonFungiblePositionId,
  toChecksumAddress,
} from "../../../src/Constants";
import type { handlerContext } from "../../../src/EntityTypes";
import {
  LiquidityChangeType,
  attributeLiquidityChangeToUserStatsPerPool,
} from "../../../src/EventHandlers/NFPM/NFPMCommonLogic";
import {
  calculateIncreaseLiquidityDiff,
  processNFPMIncreaseLiquidity,
} from "../../../src/EventHandlers/NFPM/NFPMIncreaseLiquidityLogic";
import { defaultNfpmAddress } from "../Pool/common";

vi.mock("../../../src/Aggregators/Pool", async () => ({
  ...(await vi.importActual("../../../src/Aggregators/Pool")),
  loadPoolData: vi.fn(),
}));

vi.mock("../../../src/EventHandlers/NFPM/NFPMCommonLogic", async () => ({
  ...(await vi.importActual("../../../src/EventHandlers/NFPM/NFPMCommonLogic")),
  attributeLiquidityChangeToUserStatsPerPool: vi.fn(),
}));

describe("NFPMIncreaseLiquidityLogic", () => {
  const chainId = 10;
  const tokenId = 540n;
  const poolAddress = toChecksumAddress(
    "0x00cd0AbB6c2964F7Dfb5169dD94A9F004C35F458",
  );
  const transactionHash =
    "0xaaa36689c538fcfee2e665f2c7b30bcf2f28ab898050252f50ec1f1d05a5392c";
  const ownerAddress = toChecksumAddress(
    "0x1DFAb7699121fEF702d07932a447868dCcCFb029",
  );
  const token0Address = toChecksumAddress(
    "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  );
  const token1Address = toChecksumAddress(
    "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
  );
  const nfpmAddress = defaultNfpmAddress;

  const mockPosition: NonFungiblePosition = {
    id: NonFungiblePositionId(chainId, nfpmAddress, tokenId),
    chainId: chainId,
    tokenId: tokenId,
    nfpmAddress: nfpmAddress,
    owner: ownerAddress,
    pool: poolAddress,
    tickUpper: 0n,
    tickLower: -4n,
    token0: token0Address,
    token1: token1Address,
    liquidity: 26679636922854n, // Initial liquidity
    mintTransactionHash: transactionHash,
    mintLogIndex: 42,
    lastUpdatedTimestamp: new Date(1711601595000),
    lastSnapshotTimestamp: undefined,
    isStakedInGauge: false,
  };

  // Shared mock event data
  const defaultMockEventData = {
    block: {
      timestamp: 1711601977,
      number: 118001600,
      hash: "0x2067933cb279a762d577c482ae8304772ad4c2ef35d744a21c2bfd2a3a86fc26",
    },
    chainId: chainId,
    logIndex: 10,
    srcAddress: nfpmAddress,
  };

  let mockContext: handlerContext;
  let storedPositions: Map<string, NonFungiblePosition>;
  let storedMintEvents: Map<string, CLPoolMintEvent>;
  let registryState: Map<string, string[]>;

  /**
   * Helper function to create a mock IncreaseLiquidity event
   */
  function createMockIncreaseLiquidityEvent(
    liquidity: bigint,
    overrides: {
      tokenId?: bigint;
      amount0?: bigint;
      amount1?: bigint;
      eventData?: Partial<typeof defaultMockEventData> & {
        transaction?: { hash: string };
      };
    } = {},
  ) {
    const eventData = {
      ...defaultMockEventData,
      ...overrides.eventData,
    };
    return {
      params: {
        tokenId: overrides.tokenId ?? tokenId,
        liquidity: liquidity,
        amount0: overrides.amount0 ?? 18500000000n,
        amount1: overrides.amount1 ?? 15171806313n,
      },
      block: eventData.block,
      transaction: overrides.eventData?.transaction ?? {
        hash: eventData.block.hash,
      },
      chainId: eventData.chainId,
      logIndex: eventData.logIndex,
      srcAddress: eventData.srcAddress,
    } as unknown as Parameters<typeof processNFPMIncreaseLiquidity>[0];
  }

  function buildMockContext(): handlerContext {
    return {
      Pool: {
        get: vi.fn().mockResolvedValue(undefined),
        getOrThrow: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
        getOrCreate: vi.fn(),
        set: vi.fn(),
        deleteUnsafe: vi.fn(),
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
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
      },
      NonFungiblePositionSnapshot: {
        set: vi.fn(),
        get: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
      },
      NonFungiblePosition: {
        getWhere: vi
          .fn()
          .mockImplementation((filter: { tokenId?: { _eq?: bigint } }) =>
            Promise.resolve(
              Array.from(storedPositions.values()).filter(
                (p) => p.tokenId === filter?.tokenId?._eq,
              ),
            ),
          ),
        set: vi.fn().mockImplementation((entity: NonFungiblePosition) => {
          storedPositions.set(entity.id, entity);
        }),
        get: vi
          .fn()
          .mockImplementation((id: string) =>
            Promise.resolve(storedPositions.get(id)),
          ),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
      },
      CLPoolMintEvent: {
        get: vi
          .fn()
          .mockImplementation((id: string) =>
            Promise.resolve(storedMintEvents.get(id)),
          ),
        set: vi.fn().mockImplementation((entity: CLPoolMintEvent) => {
          storedMintEvents.set(entity.id, entity);
        }),
        deleteUnsafe: vi.fn().mockImplementation((id: string) => {
          storedMintEvents.delete(id);
        }),
        getWhere: vi.fn().mockResolvedValue([]),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
      },
      TxCLPoolMintRegistry: {
        get: vi.fn().mockImplementation((id: string) => {
          const ids = registryState.get(id);
          return Promise.resolve(ids ? { id, mintEventIds: ids } : undefined);
        }),
        set: vi
          .fn()
          .mockImplementation(
            (entity: { id: string; mintEventIds: string[] }) => {
              registryState.set(entity.id, entity.mintEventIds);
            },
          ),
        deleteUnsafe: vi.fn().mockImplementation((id: string) => {
          registryState.delete(id);
        }),
        getWhere: vi.fn().mockResolvedValue([]),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
      },
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as handlerContext;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(loadPoolData).mockResolvedValue(null);
    vi.mocked(attributeLiquidityChangeToUserStatsPerPool).mockResolvedValue();
    storedPositions = new Map([[mockPosition.id, mockPosition]]);
    storedMintEvents = new Map();
    registryState = new Map();
    mockContext = buildMockContext();
  });

  describe("calculateIncreaseLiquidityDiff", () => {
    it("should calculate correct liquidity increase", () => {
      const mockEvent = createMockIncreaseLiquidityEvent(168374122051126n);

      const diff = calculateIncreaseLiquidityDiff(mockEvent);

      expect(diff.incrementalLiquidity).toBe(168374122051126n);
      expect(diff.lastUpdatedTimestamp).toEqual(
        new Date(defaultMockEventData.block.timestamp * 1000),
      );
    });

    it("should handle zero liquidity increase", () => {
      const mockEvent = createMockIncreaseLiquidityEvent(0n, {
        amount0: 0n,
        amount1: 0n,
      });

      const diff = calculateIncreaseLiquidityDiff(mockEvent);

      expect(diff.incrementalLiquidity).toBe(0n);
    });
  });

  describe("processNFPMIncreaseLiquidity", () => {
    it("should process increase liquidity event and update position", async () => {
      const increaseAmount = 168374122051126n;
      const mockEvent = createMockIncreaseLiquidityEvent(increaseAmount);

      await processNFPMIncreaseLiquidity(mockEvent, mockContext);

      const updatedPosition = storedPositions.get(mockPosition.id);
      expect(updatedPosition).toBeDefined();
      if (!updatedPosition) return;

      // Liquidity should be increased: 26679636922854 + 168374122051126 = 195053758973980
      expect(updatedPosition.liquidity).toBe(
        mockPosition.liquidity + increaseAmount,
      );
      expect(updatedPosition.lastUpdatedTimestamp).toEqual(
        new Date(defaultMockEventData.block.timestamp * 1000),
      );
    });

    it("should handle multiple liquidity increases", async () => {
      // First increase
      const firstIncrease = 168374122051126n;
      const firstEvent = createMockIncreaseLiquidityEvent(firstIncrease);

      await processNFPMIncreaseLiquidity(firstEvent, mockContext);

      // Second increase
      const secondIncrease = 177966589550062n;
      const secondEvent = createMockIncreaseLiquidityEvent(secondIncrease, {
        eventData: {
          block: {
            timestamp: 1711603759,
            number: 118002491,
            hash: "0x05ec84c822d9309df9403afa62befa7dd143f0b43eb51b145bbc573e53efada6",
          },
          chainId: chainId,
          logIndex: 16,
          srcAddress: nfpmAddress,
        },
        amount0: 17000000000n,
        amount1: 18589603370n,
      });

      await processNFPMIncreaseLiquidity(secondEvent, mockContext);

      const updatedPosition = storedPositions.get(mockPosition.id);
      expect(updatedPosition).toBeDefined();
      if (!updatedPosition) return;

      // Total liquidity: initial + first + second
      expect(updatedPosition.liquidity).toBe(
        mockPosition.liquidity + firstIncrease + secondIncrease,
      );
    });

    it("should clean up orphaned CLPoolMintEvent for increase (not new mint)", async () => {
      const increaseAmount = 168374122051126n;
      const increaseLogIndex = 10;

      // Create a CLPoolMintEvent that matches the increase (should be deleted)
      const mockMintEvent: CLPoolMintEvent = {
        id: CLPoolMintEventId(
          chainId,
          poolAddress,
          transactionHash,
          increaseLogIndex - 1,
        ),
        chainId: chainId,
        pool: poolAddress,
        owner: mockPosition.owner,
        tickLower: mockPosition.tickLower,
        tickUpper: mockPosition.tickUpper,
        liquidity: increaseAmount,
        amount0: 18500000000n,
        amount1: 15171806313n,
        token0: mockPosition.token0,
        token1: mockPosition.token1,
        transactionHash: transactionHash,
        logIndex: increaseLogIndex - 1,
        consumedByTokenId: undefined,
        createdAt: new Date(),
      };

      storedMintEvents.set(mockMintEvent.id, mockMintEvent);
      registryState.set(`${chainId}-${transactionHash}`, [mockMintEvent.id]);

      const mockEvent = createMockIncreaseLiquidityEvent(increaseAmount, {
        eventData: {
          block: {
            ...defaultMockEventData.block,
            hash: transactionHash,
          },
          logIndex: increaseLogIndex,
          transaction: { hash: transactionHash },
        },
      });

      await processNFPMIncreaseLiquidity(mockEvent, mockContext);

      // CLPoolMintEvent should be deleted from storedMintEvents
      expect(storedMintEvents.size).toBe(0);

      // Registry row should be deleted after its last id is consumed
      const registryId = `${chainId}-${transactionHash}`;
      expect(
        mockContext.TxCLPoolMintRegistry.deleteUnsafe,
      ).toHaveBeenCalledWith(registryId);
      const registryAfter =
        await mockContext.TxCLPoolMintRegistry.get(registryId);
      expect(registryAfter).toBeUndefined();
    });

    it("should not delete any CLPoolMintEvent when mint events exist in tx but none match the increase", async () => {
      const increaseAmount = 168374122051126n;
      const increaseLogIndex = 10;

      // Mint event in same tx but with different liquidity so it does not match the filter
      const nonMatchingMintEvent: CLPoolMintEvent = {
        id: `${chainId}_${poolAddress}_${transactionHash}_${increaseLogIndex - 1}`,
        chainId: chainId,
        pool: poolAddress,
        owner: mockPosition.owner,
        tickLower: mockPosition.tickLower,
        tickUpper: mockPosition.tickUpper,
        liquidity: 999n, // Different from increaseAmount — filter will exclude it
        amount0: 18500000000n,
        amount1: 15171806313n,
        token0: mockPosition.token0,
        token1: mockPosition.token1,
        transactionHash: transactionHash,
        logIndex: increaseLogIndex - 1,
        consumedByTokenId: undefined,
        createdAt: new Date(),
      };

      storedMintEvents.set(nonMatchingMintEvent.id, nonMatchingMintEvent);
      registryState.set(`${chainId}-${transactionHash}`, [
        nonMatchingMintEvent.id,
      ]);

      const mockEvent = createMockIncreaseLiquidityEvent(increaseAmount, {
        eventData: {
          logIndex: increaseLogIndex,
          transaction: { hash: transactionHash },
        },
      });

      await processNFPMIncreaseLiquidity(mockEvent, mockContext);

      // No mint event matched; none should be deleted
      expect(storedMintEvents.size).toBe(1);
      expect(storedMintEvents.has(nonMatchingMintEvent.id)).toBe(true);
    });

    it("should deterministically select closest preceding mint when multiple CLPoolMintEvents match", async () => {
      const increaseAmount = 168374122051126n;
      const increaseLogIndex = 15;

      // Create multiple CLPoolMintEvents that all match the criteria
      const mockMintEvent1: CLPoolMintEvent = {
        id: CLPoolMintEventId(chainId, poolAddress, transactionHash, 5),
        chainId: chainId,
        pool: poolAddress,
        owner: mockPosition.owner,
        tickLower: mockPosition.tickLower,
        tickUpper: mockPosition.tickUpper,
        liquidity: increaseAmount,
        amount0: 18500000000n,
        amount1: 15171806313n,
        token0: mockPosition.token0,
        token1: mockPosition.token1,
        transactionHash: transactionHash,
        logIndex: 5, // Earlier logIndex
        consumedByTokenId: undefined,
        createdAt: new Date(),
      };

      const mockMintEvent2: CLPoolMintEvent = {
        id: CLPoolMintEventId(chainId, poolAddress, transactionHash, 10),
        chainId: chainId,
        pool: poolAddress,
        owner: mockPosition.owner,
        tickLower: mockPosition.tickLower,
        tickUpper: mockPosition.tickUpper,
        liquidity: increaseAmount,
        amount0: 18500000000n,
        amount1: 15171806313n,
        token0: mockPosition.token0,
        token1: mockPosition.token1,
        transactionHash: transactionHash,
        logIndex: 10, // Higher logIndex - should be selected (closest preceding)
        consumedByTokenId: undefined,
        createdAt: new Date(),
      };

      const mockMintEvent3: CLPoolMintEvent = {
        id: CLPoolMintEventId(chainId, poolAddress, transactionHash, 8),
        chainId: chainId,
        pool: poolAddress,
        owner: mockPosition.owner,
        tickLower: mockPosition.tickLower,
        tickUpper: mockPosition.tickUpper,
        liquidity: increaseAmount,
        amount0: 18500000000n,
        amount1: 15171806313n,
        token0: mockPosition.token0,
        token1: mockPosition.token1,
        transactionHash: transactionHash,
        logIndex: 8, // Middle logIndex
        consumedByTokenId: undefined,
        createdAt: new Date(),
      };

      storedMintEvents.set(mockMintEvent1.id, mockMintEvent1);
      storedMintEvents.set(mockMintEvent2.id, mockMintEvent2);
      storedMintEvents.set(mockMintEvent3.id, mockMintEvent3);
      registryState.set(`${chainId}-${transactionHash}`, [
        mockMintEvent1.id,
        mockMintEvent2.id,
        mockMintEvent3.id,
      ]);

      const mockEvent = createMockIncreaseLiquidityEvent(increaseAmount, {
        eventData: {
          block: {
            ...defaultMockEventData.block,
            hash: transactionHash,
          },
          logIndex: increaseLogIndex,
          transaction: { hash: transactionHash },
        },
      });

      await processNFPMIncreaseLiquidity(mockEvent, mockContext);

      // Only the closest preceding mint (logIndex 10) should be deleted
      expect(storedMintEvents.size).toBe(2);
      expect(storedMintEvents.has(mockMintEvent2.id)).toBe(false); // Should be deleted
      expect(storedMintEvents.has(mockMintEvent1.id)).toBe(true); // Should remain
      expect(storedMintEvents.has(mockMintEvent3.id)).toBe(true); // Should remain

      // Registry row should be updated with the remaining ids (not deleted, since 2 remain)
      const registryId = `${chainId}-${transactionHash}`;
      expect(mockContext.TxCLPoolMintRegistry.set).toHaveBeenCalledWith({
        id: registryId,
        mintEventIds: expect.arrayContaining([
          mockMintEvent1.id,
          mockMintEvent3.id,
        ]),
      });
      expect(
        mockContext.TxCLPoolMintRegistry.deleteUnsafe,
      ).not.toHaveBeenCalled();
      const registryAfter =
        await mockContext.TxCLPoolMintRegistry.get(registryId);
      expect(registryAfter?.mintEventIds).toEqual(
        expect.arrayContaining([mockMintEvent1.id, mockMintEvent3.id]),
      );
      expect(registryAfter?.mintEventIds).toHaveLength(2);
      expect(registryAfter?.mintEventIds).not.toContain(mockMintEvent2.id);
    });

    it("should log error and return early if position not found", async () => {
      const mockEvent = createMockIncreaseLiquidityEvent(100000000000000000n, {
        tokenId: 999n, // Non-existent tokenId
        amount0: 50000000000n,
        amount1: 30000000000n,
      });

      await processNFPMIncreaseLiquidity(mockEvent, mockContext);

      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining("not found during increase liquidity"),
      );

      // Position should remain unchanged
      const position = storedPositions.get(mockPosition.id);
      expect(position?.liquidity).toBe(mockPosition.liquidity);
    });

    it("does not call attributeLiquidityChangeToUserStatsPerPool when loadPoolData returns null", async () => {
      // loadPoolData left as beforeEach default (null) — verifies early-exit when poolData is absent
      const mockEvent = createMockIncreaseLiquidityEvent(168374122051126n, {
        amount0: 18500000000n,
        amount1: 15171806313n,
      });

      await processNFPMIncreaseLiquidity(mockEvent, mockContext);

      expect(
        vi.mocked(attributeLiquidityChangeToUserStatsPerPool),
      ).not.toHaveBeenCalled();
    });

    it("calls attributeLiquidityChangeToUserStatsPerPool when poolData is loaded", async () => {
      const mockPoolData: PoolData = {
        token0Instance: {} as PoolData["token0Instance"],
        token1Instance: {} as PoolData["token1Instance"],
        liquidityPoolAggregator: {
          chainId,
        } as PoolData["liquidityPoolAggregator"],
      };
      const increaseAmount = 168374122051126n;
      const amount0 = 18500000000n;
      const amount1 = 15171806313n;
      const mockEvent = createMockIncreaseLiquidityEvent(increaseAmount, {
        amount0,
        amount1,
      });

      vi.mocked(loadPoolData).mockResolvedValue(mockPoolData);
      await processNFPMIncreaseLiquidity(mockEvent, mockContext);

      expect(attributeLiquidityChangeToUserStatsPerPool).toHaveBeenCalledTimes(
        1,
      );
      expect(attributeLiquidityChangeToUserStatsPerPool).toHaveBeenCalledWith(
        mockPosition.owner,
        poolAddress,
        mockPoolData,
        expect.anything(), // context
        amount0,
        amount1,
        expect.anything(), // timestamp
        LiquidityChangeType.ADD,
      );
    });
  });
});
