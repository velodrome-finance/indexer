import type {
  CLPoolMintEvent,
  NonFungiblePosition,
  handlerContext,
} from "generated";
import { MockDb, NFPM } from "../../../generated/src/TestHelpers.gen";
import { loadPoolData } from "../../../src/Aggregators/LiquidityPoolAggregator";
import type { PoolData } from "../../../src/Aggregators/LiquidityPoolAggregator";
import {
  CLPoolMintEventId,
  NonFungiblePositionId,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  LiquidityChangeType,
  attributeLiquidityChangeToUserStatsPerPool,
} from "../../../src/EventHandlers/NFPM/NFPMCommonLogic";
import {
  createPositionFromCLPoolMint,
  handleMintTransfer,
  handleRegularTransfer,
  isGaugeTransfer,
  processNFPMTransfer,
} from "../../../src/EventHandlers/NFPM/NFPMTransferLogic";

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

describe("NFPMTransferLogic", () => {
  const chainId = 10;
  const tokenId = 540n;
  const poolAddress = toChecksumAddress(
    "0x00cd0AbB6c2964F7Dfb5169dD94A9F004C35F458",
  );
  const transactionHash =
    "0xaaa36689c538fcfee2e665f2c7b30bcf2f28ab898050252f50ec1f1d05a5392c";
  const mintLogIndex = 42;
  const transferLogIndex = 43;
  const ownerAddress = toChecksumAddress(
    "0x3096D872E1FCc96e5E55F43411971d49bB137B9B",
  );
  const originalOwnerAddress = toChecksumAddress(
    "0x1DFAb7699121fEF702d07932a447868dCcCFb029",
  );
  const token0Address = toChecksumAddress(
    "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  );
  const token1Address = toChecksumAddress(
    "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
  );
  const nfpmAddress = toChecksumAddress(
    "0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4",
  );
  const zeroAddress = toChecksumAddress(
    "0x0000000000000000000000000000000000000000",
  );
  const gaugeAddress = toChecksumAddress(
    "0x9a9e000000000000000000000000000000000001",
  );
  const userA = toChecksumAddress("0x1111111111111111111111111111111111111111");
  const userB = toChecksumAddress("0x2222222222222222222222222222222222222222");
  const defaultSqrtPriceX96 = 79228162514264337593543950336n;
  const positionLiquidityAmount = 26679636922854n;

  // Stable ID calculation helper (chainId-poolAddress-tokenId)
  const getStableId = () =>
    NonFungiblePositionId(chainId, poolAddress, tokenId);

  /** Minimal PoolData stub for tests (gauge and/or sqrtPriceX96). */
  function minimalPoolData(
    overrides: {
      gaugeAddress?: string;
      sqrtPriceX96?: bigint;
    } = {},
  ): PoolData {
    return {
      liquidityPoolAggregator: {
        chainId,
        gaugeAddress: overrides.gaugeAddress,
        sqrtPriceX96: overrides.sqrtPriceX96 ?? 0n,
      } as PoolData["liquidityPoolAggregator"],
      token0Instance: {} as PoolData["token0Instance"],
      token1Instance: {} as PoolData["token1Instance"],
    };
  }

  /** Position with non-zero liquidity for transfer accounting tests. */
  function positionWithLiquidity(owner: string) {
    return {
      ...mockPosition,
      owner,
      liquidity: positionLiquidityAmount,
      tickLower: -4n,
      tickUpper: 0n,
    };
  }

  /** Resolve position after transfer (stored or DB). */
  function getPositionAfterTransfer() {
    return (
      storedPositions.find((p) => p.id === mockPosition.id) ??
      mockDb.entities.NonFungiblePosition.get(mockPosition.id)
    );
  }

  // Default mock event data for mint transfers
  const defaultMintTransferEventData = {
    block: {
      timestamp: 1711601595,
      number: 118001409,
      hash: transactionHash,
    },
    chainId: chainId,
    logIndex: transferLogIndex,
    srcAddress: nfpmAddress,
    transaction: {
      hash: transactionHash,
    },
  };

  // Default mock event data for regular transfers
  const defaultRegularTransferEventData = {
    block: {
      timestamp: 1711601643,
      number: 118001433,
      hash: "0xaae8d84e6bd723bd1782fa608dd7f0b9cdcdc04a5f6a497ba9046938e4c3e4ef",
    },
    chainId: chainId,
    logIndex: 30,
    srcAddress: nfpmAddress,
  };

  const mockCLPoolMintEvent: CLPoolMintEvent = {
    id: CLPoolMintEventId(chainId, poolAddress, transactionHash, mintLogIndex),
    chainId: chainId,
    pool: poolAddress,
    owner: ownerAddress,
    tickLower: -4n,
    tickUpper: 0n,
    liquidity: 26679636922854n,
    amount0: 18500000000n,
    amount1: 15171806313n,
    token0: token0Address,
    token1: token1Address,
    transactionHash: transactionHash,
    logIndex: mintLogIndex,
    consumedByTokenId: undefined,
    createdAt: new Date(1711601595000),
  };

  const mockPosition: NonFungiblePosition = {
    id: getStableId(),
    chainId: chainId,
    tokenId: tokenId,
    owner: originalOwnerAddress,
    pool: poolAddress,
    tickUpper: 0n,
    tickLower: -4n,
    token0: token0Address,
    token1: token1Address,
    liquidity: 0n,
    mintTransactionHash: transactionHash,
    mintLogIndex: mintLogIndex,
    lastUpdatedTimestamp: new Date(1711601595000),
    lastSnapshotTimestamp: undefined,
  };

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let mockContext: handlerContext;
  let mockDbRef: { current: ReturnType<typeof MockDb.createMockDb> };
  let storedPositions: NonFungiblePosition[] = [];
  let storedMintEvents: CLPoolMintEvent[] = [];

  /**
   * Helper function to create a mock context with getWhere functionality
   */
  function createMockContext(
    positions: NonFungiblePosition[] = [],
    mintEvents: CLPoolMintEvent[] = [],
  ): handlerContext {
    const db = MockDb.createMockDb();
    let currentDb = positions.reduce(
      (acc, pos) => acc.entities.NonFungiblePosition.set(pos),
      db,
    );
    currentDb = mintEvents.reduce(
      (acc, event) => acc.entities.CLPoolMintEvent.set(event),
      currentDb,
    );

    mockDbRef = { current: currentDb };

    const originalSetPosition = currentDb.entities.NonFungiblePosition.set;
    const originalSetMintEvent = currentDb.entities.CLPoolMintEvent.set;

    const trackPosition = (entity: NonFungiblePosition) => {
      const index = positions.findIndex((p) => p.id === entity.id);
      if (index >= 0) {
        positions[index] = entity;
      } else {
        positions.push(entity);
      }
    };

    const trackMintEvent = (entity: CLPoolMintEvent) => {
      const index = mintEvents.findIndex((e) => e.id === entity.id);
      if (index >= 0) {
        mintEvents[index] = entity;
      } else {
        mintEvents.push(entity);
      }
    };

    // Wrap mockDb to track entities
    currentDb = {
      ...currentDb,
      entities: {
        ...currentDb.entities,
        NonFungiblePosition: {
          ...currentDb.entities.NonFungiblePosition,
          set: (entity: NonFungiblePosition) => {
            trackPosition(entity);
            const updatedDb = originalSetPosition(entity);
            mockDbRef.current = updatedDb;
            return updatedDb;
          },
        },
        CLPoolMintEvent: {
          ...currentDb.entities.CLPoolMintEvent,
          set: (entity: CLPoolMintEvent) => {
            trackMintEvent(entity);
            const updatedDb = originalSetMintEvent(entity);
            mockDbRef.current = updatedDb;
            return updatedDb;
          },
        },
      },
    } as typeof currentDb;
    mockDbRef.current = currentDb;

    return {
      ...currentDb,
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
        ...currentDb.entities.NonFungiblePosition,
        getWhere: vi
          .fn()
          .mockImplementation((filter: { tokenId?: { _eq?: bigint } }) =>
            Promise.resolve(
              positions.filter((p) => p.tokenId === filter?.tokenId?._eq),
            ),
          ),
        set: (entity: NonFungiblePosition) => {
          trackPosition(entity);
          const updatedDb =
            mockDbRef.current.entities.NonFungiblePosition.set(entity);
          mockDbRef.current = updatedDb;
          mockDb = updatedDb;
          return updatedDb;
        },
        get: (id: string) => {
          const stored = positions.find((p) => p.id === id);
          if (stored) {
            return stored;
          }
          return mockDbRef.current.entities.NonFungiblePosition.get(id);
        },
        deleteUnsafe: (id: string) => {
          const index = positions.findIndex((p) => p.id === id);
          if (index >= 0) {
            positions.splice(index, 1);
          }
        },
      },
      CLPoolMintEvent: {
        ...currentDb.entities.CLPoolMintEvent,
        getWhere: vi
          .fn()
          .mockImplementation(
            (filter: { transactionHash?: { _eq?: string } }) =>
              Promise.resolve(
                mintEvents.filter(
                  (e) => e.transactionHash === filter?.transactionHash?._eq,
                ),
              ),
          ),
        set: (entity: CLPoolMintEvent) => {
          trackMintEvent(entity);
          const updatedDb =
            mockDbRef.current.entities.CLPoolMintEvent.set(entity);
          mockDbRef.current = updatedDb;
          mockDb = updatedDb;
          return updatedDb;
        },
        get: (id: string) => {
          return mockDbRef.current.entities.CLPoolMintEvent.get(id);
        },
        deleteUnsafe: (id: string) => {
          const index = mintEvents.findIndex((e) => e.id === id);
          if (index >= 0) {
            mintEvents.splice(index, 1);
          }
        },
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as handlerContext;
  }

  /**
   * Helper function to create a mock Transfer event
   */
  function createMockTransferEvent(
    from: string,
    to: string,
    overrides: {
      tokenId?: bigint;
      mockEventData?: Partial<typeof defaultMintTransferEventData>;
    } = {},
  ) {
    const isMint = from === zeroAddress;
    const defaultEventData = isMint
      ? defaultMintTransferEventData
      : defaultRegularTransferEventData;

    return NFPM.Transfer.createMockEvent({
      from: from as `0x${string}`,
      to: to as `0x${string}`,
      tokenId: overrides.tokenId ?? tokenId,
      mockEventData: {
        ...defaultEventData,
        ...overrides.mockEventData,
      },
    });
  }

  beforeEach(() => {
    storedPositions = [];
    storedMintEvents = [];
    mockContext = createMockContext(storedPositions, storedMintEvents);
    mockDb = MockDb.createMockDb();
    vi.mocked(loadPoolData).mockResolvedValue(null);
    vi.mocked(attributeLiquidityChangeToUserStatsPerPool).mockClear();
    vi.mocked(attributeLiquidityChangeToUserStatsPerPool).mockResolvedValue();
  });

  // Helper functions to set entities
  const setPosition = (entity: NonFungiblePosition) => {
    // Add to storedPositions for getWhere queries
    const index = storedPositions.findIndex((p) => p.id === entity.id);
    if (index >= 0) {
      storedPositions[index] = entity;
    } else {
      storedPositions.push(entity);
    }
    // Also add to mockDb
    mockDb = mockDb.entities.NonFungiblePosition.set(entity);
    if (mockDbRef) {
      mockDbRef.current = mockDb;
    }
    return mockDb;
  };

  const setMintEvent = (entity: CLPoolMintEvent) => {
    const index = storedMintEvents.findIndex((e) => e.id === entity.id);
    if (index >= 0) {
      storedMintEvents[index] = entity;
    } else {
      storedMintEvents.push(entity);
    }
    mockDb = mockDb.entities.CLPoolMintEvent.set(entity);
    if (mockDbRef) {
      mockDbRef.current = mockDb;
    }
    return mockDb;
  };

  describe("createPositionFromCLPoolMint", () => {
    it("should create position from CLPoolMintEvent with stable ID", async () => {
      const owner = toChecksumAddress(
        "0x3096D872E1FCc96e5E55F43411971d49bB137B9B",
      );
      const blockTimestamp = 1711601595;

      setMintEvent(mockCLPoolMintEvent);

      await createPositionFromCLPoolMint(
        mockCLPoolMintEvent,
        tokenId,
        owner,
        chainId,
        blockTimestamp,
        mockContext,
      );

      const stableId = getStableId();
      const position = storedPositions.find((p) => p.id === stableId);

      expect(position).toBeDefined();
      if (!position) return;
      expect(position.id).toBe(stableId);
      expect(position.tokenId).toBe(tokenId);
      expect(position.owner.toLowerCase()).toBe(owner.toLowerCase());
      expect(position.pool).toBe(poolAddress);
      expect(position.tickUpper).toBe(mockCLPoolMintEvent.tickUpper);
      expect(position.tickLower).toBe(mockCLPoolMintEvent.tickLower);
      expect(position.token0).toBe(mockCLPoolMintEvent.token0);
      expect(position.token1).toBe(mockCLPoolMintEvent.token1);
      expect(position.liquidity).toBe(0n); // Should start at 0
      expect(position.mintTransactionHash).toBe(transactionHash);
      expect(position.mintLogIndex).toBe(mintLogIndex);
      expect(position.lastSnapshotTimestamp).toBeUndefined();

      // CLPoolMintEvent should be deleted
      const deletedEvent = storedMintEvents.find(
        (e) => e.id === mockCLPoolMintEvent.id,
      );
      expect(deletedEvent).toBeUndefined();
    });
  });

  describe("handleMintTransfer", () => {
    it("should create position from CLPoolMintEvent when matching mint found", async () => {
      setMintEvent(mockCLPoolMintEvent);

      const mockEvent = createMockTransferEvent(zeroAddress, ownerAddress);

      await handleMintTransfer(mockEvent, mockContext, []);

      const stableId = getStableId();
      const position = storedPositions.find((p) => p.id === stableId);

      expect(position).toBeDefined();
      if (!position) return;

      expect(position.id).toBe(stableId);
      expect(position.tokenId).toBe(tokenId);
      expect(position.owner.toLowerCase()).toBe(ownerAddress.toLowerCase());
      expect(position.lastSnapshotTimestamp).toBeUndefined();
    });

    it("should not create new position if position already exists", async () => {
      setPosition(mockPosition);

      const mockEvent = createMockTransferEvent(zeroAddress, ownerAddress);

      // Pass the position from storedPositions to match what processNFPMTransfer would do
      const existingPositions = storedPositions.filter(
        (p) => p.tokenId === tokenId,
      );
      await handleMintTransfer(mockEvent, mockContext, existingPositions);

      // Position should still exist with same ID
      const position =
        storedPositions.find((p) => p.id === mockPosition.id) ||
        mockDbRef.current.entities.NonFungiblePosition.get(mockPosition.id);
      expect(position).toBeDefined();
      if (!position) return;
      expect(position.id).toBe(mockPosition.id);
    });

    it("should log warning if no CLPoolMintEvent found", async () => {
      const mockEvent = createMockTransferEvent(zeroAddress, ownerAddress);

      await handleMintTransfer(mockEvent, mockContext, []);

      // No position should be created
      const stableId = getStableId();
      const position = storedPositions.find((p) => p.id === stableId);
      expect(position).toBeUndefined();

      expect(mockContext.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("No CLPoolMintEvent found"),
      );
    });

    it("should select closest preceding mint by logIndex when multiple mints exist", async () => {
      // Create multiple CLPoolMintEvents in the same transaction
      const mintEvent1: CLPoolMintEvent = {
        ...mockCLPoolMintEvent,
        id: CLPoolMintEventId(chainId, poolAddress, transactionHash, 40),
        logIndex: 40,
      };
      const mintEvent2: CLPoolMintEvent = {
        ...mockCLPoolMintEvent,
        id: CLPoolMintEventId(chainId, poolAddress, transactionHash, 41),
        logIndex: 41,
      };
      const mintEvent3: CLPoolMintEvent = {
        ...mockCLPoolMintEvent,
        id: CLPoolMintEventId(chainId, poolAddress, transactionHash, 42),
        logIndex: 42,
      };

      setMintEvent(mintEvent1);
      setMintEvent(mintEvent2);
      setMintEvent(mintEvent3);

      const mockEvent = createMockTransferEvent(zeroAddress, ownerAddress);

      await handleMintTransfer(mockEvent, mockContext, []);

      const stableId = getStableId();
      const position = storedPositions.find((p) => p.id === stableId);

      expect(position).toBeDefined();
      if (!position) return;
      expect(position.mintLogIndex).toBe(42); // Should select the closest preceding (42)
    });

    it("should filter out consumed CLPoolMintEvents", async () => {
      const consumedMintEvent: CLPoolMintEvent = {
        ...mockCLPoolMintEvent,
        consumedByTokenId: 100n, // Already consumed
      };
      const unconsumedMintEvent: CLPoolMintEvent = {
        ...mockCLPoolMintEvent,
        id: CLPoolMintEventId(chainId, poolAddress, transactionHash, 41),
        logIndex: 41,
        consumedByTokenId: undefined,
      };

      setMintEvent(consumedMintEvent);
      setMintEvent(unconsumedMintEvent);

      const mockEvent = createMockTransferEvent(zeroAddress, ownerAddress);

      await handleMintTransfer(mockEvent, mockContext, []);

      const stableId = getStableId();
      const position = storedPositions.find((p) => p.id === stableId);

      expect(position).toBeDefined();
      if (!position) return;
      expect(position.mintLogIndex).toBe(41); // Should use unconsumed event
    });

    it("should handle null/undefined mintEvents from getWhere query (covers ?? [] fallback)", async () => {
      // Create a new mock context with getWhere that returns null to test ?? [] fallback on line 95
      const nullMockContext = {
        ...mockContext,
        CLPoolMintEvent: {
          ...mockContext.CLPoolMintEvent,
          getWhere: vi.fn().mockResolvedValue(null),
        },
      } as unknown as handlerContext;

      const mockEvent = createMockTransferEvent(zeroAddress, ownerAddress);

      await handleMintTransfer(mockEvent, nullMockContext, []);

      // Should log warning since no events found
      expect(nullMockContext.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("No CLPoolMintEvent found"),
      );
    });

    it("should keep prev when current.logIndex <= prev.logIndex in reduce", async () => {
      // Create events where the reduce function keeps prev instead of current
      // Order matters: first event (prev) has logIndex 42, second (current) has 41
      // When current.logIndex (41) <= prev.logIndex (42), we keep prev
      const mintEvent1: CLPoolMintEvent = {
        ...mockCLPoolMintEvent,
        id: CLPoolMintEventId(chainId, poolAddress, transactionHash, 42),
        logIndex: 42, // This will be prev in reduce
      };
      const mintEvent2: CLPoolMintEvent = {
        ...mockCLPoolMintEvent,
        id: CLPoolMintEventId(chainId, poolAddress, transactionHash, 41),
        logIndex: 41, // This will be current in reduce, and 41 <= 42, so we keep prev
      };

      // Add them in order so mintEvent1 is processed first (becomes prev)
      setMintEvent(mintEvent1);
      setMintEvent(mintEvent2);

      const mockEvent = createMockTransferEvent(zeroAddress, ownerAddress);

      await handleMintTransfer(mockEvent, mockContext, []);

      const stableId = getStableId();
      const position = storedPositions.find((p) => p.id === stableId);

      expect(position).toBeDefined();
      if (!position) return;
      // Should keep prev (42) when current (41) <= prev (42)
      expect(position.mintLogIndex).toBe(42);
    });

    it("should handle reduce when all events have same logIndex", async () => {
      // Create events with same logIndex to test the "prev" branch when current.logIndex === prev.logIndex
      const mintEvent1: CLPoolMintEvent = {
        ...mockCLPoolMintEvent,
        id: CLPoolMintEventId(chainId, poolAddress, transactionHash, 41),
        logIndex: 41,
      };
      const mintEvent2: CLPoolMintEvent = {
        ...mockCLPoolMintEvent,
        id: CLPoolMintEventId(chainId, poolAddress, transactionHash, 41),
        logIndex: 41, // Same logIndex - should keep prev
      };

      setMintEvent(mintEvent1);
      setMintEvent(mintEvent2);

      const mockEvent = createMockTransferEvent(zeroAddress, ownerAddress);

      await handleMintTransfer(mockEvent, mockContext, []);

      const stableId = getStableId();
      const position = storedPositions.find((p) => p.id === stableId);

      expect(position).toBeDefined();
      if (!position) return;
      // Should use the first one (prev) when logIndexes are equal
      expect(position.mintLogIndex).toBe(41);
    });
  });

  describe("isGaugeTransfer", () => {
    it("returns false when gaugeAddress is undefined", () => {
      expect(isGaugeTransfer(userA, userB, undefined)).toBe(false);
    });

    it("returns false when both from and to are different from gauge", () => {
      expect(isGaugeTransfer(userA, userB, gaugeAddress)).toBe(false);
    });

    it("returns true when from is gauge", () => {
      expect(isGaugeTransfer(gaugeAddress, userB, gaugeAddress)).toBe(true);
    });

    it("returns true when to is gauge", () => {
      expect(isGaugeTransfer(userA, gaugeAddress, gaugeAddress)).toBe(true);
    });
  });

  describe("handleRegularTransfer", () => {
    it("logs error and returns when positions array is empty", async () => {
      const mockEvent = createMockTransferEvent(userA, userB);

      await handleRegularTransfer(mockEvent, [], mockContext);

      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "[handleRegularTransfer] No positions provided",
        ),
      );
      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining(`tokenId ${tokenId}`),
      );
    });

    it("should update owner of existing position", async () => {
      vi.mocked(loadPoolData).mockResolvedValue(
        minimalPoolData({ sqrtPriceX96: defaultSqrtPriceX96 }),
      );
      const mockEvent = createMockTransferEvent(mockPosition.owner, userB);

      setPosition(mockPosition);

      await handleRegularTransfer(mockEvent, [mockPosition], mockContext);

      const updatedPosition = mockDb.entities.NonFungiblePosition.get(
        mockPosition.id,
      );
      expect(updatedPosition).toBeDefined();
      if (!updatedPosition) return;

      expect(updatedPosition.owner.toLowerCase()).toBe(userB.toLowerCase());
      expect(updatedPosition.id).toBe(mockPosition.id);
      expect(updatedPosition.lastUpdatedTimestamp).toEqual(
        new Date(defaultRegularTransferEventData.block.timestamp * 1000),
      );
    });

    it("updates owner but skips attribution when poolData is null (logs warn)", async () => {
      vi.mocked(loadPoolData).mockResolvedValue(null);
      const mockEvent = createMockTransferEvent(mockPosition.owner, userB);
      setPosition(mockPosition);

      await handleRegularTransfer(mockEvent, [mockPosition], mockContext);

      expect(mockContext.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("Pool data not found"),
      );
      expect(mockContext.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("during transfer"),
      );
      const positionAfter = getPositionAfterTransfer();
      expect(positionAfter?.owner).toBe(userB);
    });

    it("does not update owner when transfer is stake (user to gauge)", async () => {
      const positionWithOwner = {
        ...mockPosition,
        owner: originalOwnerAddress,
      };
      setPosition(positionWithOwner);
      const mockEvent = createMockTransferEvent(
        originalOwnerAddress,
        gaugeAddress,
      );
      vi.mocked(loadPoolData).mockResolvedValueOnce(
        minimalPoolData({ gaugeAddress: mockEvent.params.to }),
      );

      await handleRegularTransfer(mockEvent, [positionWithOwner], mockContext);

      const positionAfter = getPositionAfterTransfer();
      expect(positionAfter).toBeDefined();
      expect(positionAfter?.owner?.toLowerCase()).toBe(
        originalOwnerAddress.toLowerCase(),
      );
    });

    it("does not update owner when transfer is unstake (gauge to user)", async () => {
      vi.mocked(loadPoolData).mockResolvedValue(
        minimalPoolData({ gaugeAddress }),
      );
      const positionWithOwner = {
        ...mockPosition,
        owner: originalOwnerAddress,
      };
      setPosition(positionWithOwner);
      const mockEvent = createMockTransferEvent(
        gaugeAddress,
        originalOwnerAddress,
      );

      await handleRegularTransfer(mockEvent, [positionWithOwner], mockContext);

      const positionAfter = getPositionAfterTransfer();
      expect(positionAfter).toBeDefined();
      expect(positionAfter?.owner).toBe(originalOwnerAddress);
    });

    it("updates owner when transfer is normal and pool has gauge", async () => {
      vi.mocked(loadPoolData).mockResolvedValue(
        minimalPoolData({ gaugeAddress, sqrtPriceX96: 1n }),
      );
      const positionOwnedByA = { ...mockPosition, owner: userA };
      setPosition(positionOwnedByA);
      const mockEvent = createMockTransferEvent(userA, userB);

      await handleRegularTransfer(mockEvent, [positionOwnedByA], mockContext);

      const updatedPosition = getPositionAfterTransfer();
      expect(updatedPosition).toBeDefined();
      expect(updatedPosition?.owner).toBe(userB);
    });
  });

  describe("transfer accounting", () => {
    it("calls REMOVE for sender and ADD for recipient on regular transfer", async () => {
      vi.mocked(loadPoolData).mockResolvedValue(
        minimalPoolData({ sqrtPriceX96: defaultSqrtPriceX96 }),
      );
      const pos = positionWithLiquidity(userA);
      setPosition(pos);
      const mockEvent = createMockTransferEvent(userA, userB);

      await handleRegularTransfer(mockEvent, [pos], mockContext);

      expect(attributeLiquidityChangeToUserStatsPerPool).toHaveBeenCalledTimes(
        2,
      );
      const [removeCall, addCall] = vi.mocked(
        attributeLiquidityChangeToUserStatsPerPool,
      ).mock.calls;
      // Arguments: (owner, poolAddress, poolData, context, amount0, amount1, blockTimestamp, liquidityChangeType)
      const [removeUser, , , , removeAmount0, removeAmount1, , removeType] =
        removeCall;
      const [addUser, , , , addAmount0, addAmount1, , addType] = addCall;
      expect(removeUser).toBe(userA);
      expect(removeType).toBe(LiquidityChangeType.REMOVE);
      expect(addUser).toBe(userB);
      expect(addType).toBe(LiquidityChangeType.ADD);
      expect(removeAmount0).toBe(addAmount0);
      expect(removeAmount1).toBe(addAmount1);
    });

    it("calls only REMOVE for sender on burn (to zero address)", async () => {
      vi.mocked(loadPoolData).mockResolvedValue(
        minimalPoolData({ sqrtPriceX96: defaultSqrtPriceX96 }),
      );
      const pos = positionWithLiquidity(userA);
      setPosition(pos);
      const mockEvent = createMockTransferEvent(userA, zeroAddress);

      await handleRegularTransfer(mockEvent, [pos], mockContext);

      expect(attributeLiquidityChangeToUserStatsPerPool).toHaveBeenCalledTimes(
        1,
      );
      const [removeCall] = vi.mocked(attributeLiquidityChangeToUserStatsPerPool)
        .mock.calls;
      // Arguments: (owner, poolAddress, poolData, context, amount0, amount1, blockTimestamp, liquidityChangeType)
      const [removeUser, , , , removeAmount0, removeAmount1, , removeType] =
        removeCall;
      expect(removeUser).toBe(userA);
      expect(removeType).toBe(LiquidityChangeType.REMOVE);
    });

    it("does not call attributeLiquidityChangeToUserStatsPerPool when sqrtPriceX96 is 0", async () => {
      vi.mocked(loadPoolData).mockResolvedValue(
        minimalPoolData({ sqrtPriceX96: 0n }),
      );
      const pos = positionWithLiquidity(userA);
      setPosition(pos);
      const mockEvent = createMockTransferEvent(userA, userB);

      await handleRegularTransfer(mockEvent, [pos], mockContext);

      expect(attributeLiquidityChangeToUserStatsPerPool).not.toHaveBeenCalled();
      const updatedPosition = getPositionAfterTransfer();
      expect(updatedPosition?.owner).toBe(userB);
    });

    it("does not call attributeLiquidityChangeToUserStatsPerPool on self-transfer (from === to)", async () => {
      vi.mocked(loadPoolData).mockResolvedValue(
        minimalPoolData({ sqrtPriceX96: defaultSqrtPriceX96 }),
      );
      const pos = positionWithLiquidity(userA);
      setPosition(pos);
      const mockEvent = createMockTransferEvent(userA, userA);

      await handleRegularTransfer(mockEvent, [pos], mockContext);

      expect(attributeLiquidityChangeToUserStatsPerPool).not.toHaveBeenCalled();
      const updatedPosition = getPositionAfterTransfer();
      expect(updatedPosition?.owner).toBe(userA);
    });
  });

  describe("processNFPMTransfer", () => {
    it("should handle mint transfer and create position", async () => {
      setMintEvent(mockCLPoolMintEvent);

      const mockEvent = createMockTransferEvent(zeroAddress, ownerAddress);

      await processNFPMTransfer(mockEvent, mockContext);

      const stableId = getStableId();
      const createdPosition =
        storedPositions.find((p) => p.id === stableId) ||
        mockDbRef.current.entities.NonFungiblePosition.get(stableId);
      expect(createdPosition).toBeDefined();
      if (!createdPosition) return;
      expect(createdPosition.tokenId).toBe(tokenId);
      expect(createdPosition.owner.toLowerCase()).toBe(
        ownerAddress.toLowerCase(),
      );
    });

    it("should handle regular transfer and update owner", async () => {
      vi.mocked(loadPoolData).mockResolvedValue(
        minimalPoolData({ sqrtPriceX96: defaultSqrtPriceX96 }),
      );
      setPosition(mockPosition);

      const mockEvent = createMockTransferEvent(mockPosition.owner, userB);

      await processNFPMTransfer(mockEvent, mockContext);

      const updatedPosition =
        storedPositions.find((p) => p.id === mockPosition.id) ||
        mockDbRef.current.entities.NonFungiblePosition.get(mockPosition.id);
      expect(updatedPosition).toBeDefined();
      if (!updatedPosition) return;
      expect(updatedPosition.owner.toLowerCase()).toBe(userB.toLowerCase());
    });

    it("should log error and return early if position not found for regular transfer", async () => {
      const mockEvent = createMockTransferEvent(userA, userB, {
        tokenId: 999n, // Non-existent tokenId
      });

      await processNFPMTransfer(mockEvent, mockContext);

      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining("not found during transfer"),
      );
    });

    it("should return early if mint transfer fails to find CLPoolMintEvent", async () => {
      const mockEvent = createMockTransferEvent(zeroAddress, ownerAddress);

      await processNFPMTransfer(mockEvent, mockContext);

      expect(mockContext.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("No CLPoolMintEvent found"),
      );

      const position = mockDb.entities.NonFungiblePosition.get(getStableId());
      expect(position).toBeUndefined();
    });
  });
});
