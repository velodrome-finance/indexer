import type {
  CLPoolMintEvent,
  NFPM_IncreaseLiquidity_event,
  NonFungiblePosition,
  handlerContext,
} from "generated";
import { MockDb, NFPM } from "../../../generated/src/TestHelpers.gen";
import type { PoolData } from "../../../src/Aggregators/LiquidityPoolAggregator";
import { loadPoolData } from "../../../src/Aggregators/LiquidityPoolAggregator";
import { attributeLiquidityChangeToUserStatsPerPool } from "../../../src/EventHandlers/NFPM/NFPMCommonLogic";
import { LiquidityChangeType } from "../../../src/EventHandlers/NFPM/NFPMCommonLogic";
import {
  calculateIncreaseLiquidityDiff,
  processNFPMIncreaseLiquidity,
} from "../../../src/EventHandlers/NFPM/NFPMIncreaseLiquidityLogic";

jest.mock("../../../src/Aggregators/LiquidityPoolAggregator", () => ({
  ...jest.requireActual("../../../src/Aggregators/LiquidityPoolAggregator"),
  loadPoolData: jest.fn(),
}));

jest.mock("../../../src/EventHandlers/NFPM/NFPMCommonLogic", () => ({
  ...jest.requireActual("../../../src/EventHandlers/NFPM/NFPMCommonLogic"),
  attributeLiquidityChangeToUserStatsPerPool: jest.fn(),
}));

describe("NFPMIncreaseLiquidityLogic", () => {
  const chainId = 10;
  const tokenId = 540n;
  const poolAddress = "0x00cd0AbB6c2964F7Dfb5169dD94A9F004C35F458";
  const transactionHash =
    "0xaaa36689c538fcfee2e665f2c7b30bcf2f28ab898050252f50ec1f1d05a5392c";
  const ownerAddress = "0x1DFAb7699121fEF702d07932a447868dCcCFb029";
  const token0Address = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85";
  const token1Address = "0x7F5c764cBc14f9669B88837ca1490cCa17c31607";
  const nfpmAddress = "0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4";

  const mockPosition: NonFungiblePosition = {
    id: `${chainId}_${poolAddress}_${tokenId}`,
    chainId: chainId,
    tokenId: tokenId,
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

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let mockContext: handlerContext;
  let storedPositions: NonFungiblePosition[];
  let storedMintEvents: CLPoolMintEvent[];

  /**
   * Helper function to create a mock context with getWhere functionality
   */
  function createMockContext(
    positions: NonFungiblePosition[] = [mockPosition],
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

    const originalSet = currentDb.entities.NonFungiblePosition.set;
    const trackPosition = (entity: NonFungiblePosition) => {
      const index = positions.findIndex((p) => p.id === entity.id);
      if (index >= 0) {
        positions[index] = entity;
      } else {
        positions.push(entity);
      }
    };

    return {
      ...currentDb,
      LiquidityPoolAggregator: {
        get: jest.fn().mockResolvedValue(undefined),
      },
      NonFungiblePosition: {
        ...currentDb.entities.NonFungiblePosition,
        getWhere: {
          tokenId: {
            eq: async (id: bigint) => {
              return positions.filter((p) => p.tokenId === id);
            },
          },
          pool: {
            eq: jest.fn(),
          },
          owner: {
            eq: jest.fn(),
          },
          mintTransactionHash: {
            eq: jest.fn(),
          },
        },
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
      CLPoolMintEvent: {
        ...currentDb.entities.CLPoolMintEvent,
        getWhere: {
          transactionHash: {
            eq: async (txHash: string) => {
              return mintEvents.filter((e) => e.transactionHash === txHash);
            },
          },
        },
        deleteUnsafe: (id: string) => {
          const index = mintEvents.findIndex((e) => e.id === id);
          if (index >= 0) {
            mintEvents.splice(index, 1);
          }
        },
        get: (id: string) => {
          return mockDb.entities.CLPoolMintEvent.get(id);
        },
        // biome-ignore lint/suspicious/noExplicitAny: Mock for testing
      } as any,
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    } as unknown as handlerContext;
  }

  /**
   * Helper function to create a mock IncreaseLiquidity event
   */
  function createMockIncreaseLiquidityEvent(
    liquidity: bigint,
    overrides: {
      tokenId?: bigint;
      amount0?: bigint;
      amount1?: bigint;
      mockEventData?: typeof defaultMockEventData;
    } = {},
  ) {
    return NFPM.IncreaseLiquidity.createMockEvent({
      tokenId: overrides.tokenId ?? tokenId,
      liquidity: liquidity,
      amount0: overrides.amount0 ?? 18500000000n,
      amount1: overrides.amount1 ?? 15171806313n,
      mockEventData: {
        ...defaultMockEventData,
        ...overrides.mockEventData,
      },
    });
  }

  beforeEach(() => {
    jest.mocked(loadPoolData).mockResolvedValue(null);
    jest.mocked(attributeLiquidityChangeToUserStatsPerPool).mockResolvedValue();
    storedPositions = [mockPosition];
    storedMintEvents = [];
    mockContext = createMockContext(storedPositions, storedMintEvents);
    mockDb = MockDb.createMockDb();
    mockDb = mockDb.entities.NonFungiblePosition.set(mockPosition);
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

      const updatedPosition = mockDb.entities.NonFungiblePosition.get(
        mockPosition.id,
      );
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
        mockEventData: {
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

      const updatedPosition = mockDb.entities.NonFungiblePosition.get(
        mockPosition.id,
      );
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
        id: `${chainId}_${poolAddress}_${transactionHash}_${increaseLogIndex - 1}`,
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

      // Recreate context with the mint event
      storedMintEvents = [mockMintEvent];
      mockContext = createMockContext(storedPositions, storedMintEvents);
      mockDb = MockDb.createMockDb();
      mockDb = mockDb.entities.NonFungiblePosition.set(mockPosition);
      mockDb = mockDb.entities.CLPoolMintEvent.set(mockMintEvent);

      const mockEvent = NFPM.IncreaseLiquidity.createMockEvent({
        tokenId: tokenId,
        liquidity: increaseAmount,
        amount0: 18500000000n,
        amount1: 15171806313n,
        mockEventData: {
          ...defaultMockEventData,
          block: {
            ...defaultMockEventData.block,
            hash: transactionHash,
          },
          logIndex: increaseLogIndex,
          transaction: {
            hash: transactionHash,
          },
        },
      });

      await processNFPMIncreaseLiquidity(mockEvent, mockContext);

      // CLPoolMintEvent should be deleted from storedMintEvents
      expect(storedMintEvents.length).toBe(0);
    });

    it("should deterministically select closest preceding mint when multiple CLPoolMintEvents match", async () => {
      const increaseAmount = 168374122051126n;
      const increaseLogIndex = 15;

      // Create multiple CLPoolMintEvents that all match the criteria
      // They have different logIndexes but all match pool, ticks, and liquidity
      const mockMintEvent1: CLPoolMintEvent = {
        id: `${chainId}_${poolAddress}_${transactionHash}_5`,
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
        id: `${chainId}_${poolAddress}_${transactionHash}_10`,
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
        id: `${chainId}_${poolAddress}_${transactionHash}_8`,
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

      // Recreate context with multiple mint events
      storedMintEvents = [mockMintEvent1, mockMintEvent2, mockMintEvent3];
      mockContext = createMockContext(storedPositions, storedMintEvents);
      mockDb = MockDb.createMockDb();
      mockDb = mockDb.entities.NonFungiblePosition.set(mockPosition);
      mockDb = mockDb.entities.CLPoolMintEvent.set(mockMintEvent1);
      mockDb = mockDb.entities.CLPoolMintEvent.set(mockMintEvent2);
      mockDb = mockDb.entities.CLPoolMintEvent.set(mockMintEvent3);

      const mockEvent = NFPM.IncreaseLiquidity.createMockEvent({
        tokenId: tokenId,
        liquidity: increaseAmount,
        amount0: 18500000000n,
        amount1: 15171806313n,
        mockEventData: {
          ...defaultMockEventData,
          block: {
            ...defaultMockEventData.block,
            hash: transactionHash,
          },
          logIndex: increaseLogIndex,
          transaction: {
            hash: transactionHash,
          },
        },
      });

      await processNFPMIncreaseLiquidity(mockEvent, mockContext);

      // Only the closest preceding mint (logIndex 10) should be deleted
      expect(storedMintEvents.length).toBe(2);
      expect(
        storedMintEvents.find((e) => e.id === mockMintEvent2.id),
      ).toBeUndefined(); // Should be deleted
      expect(
        storedMintEvents.find((e) => e.id === mockMintEvent1.id),
      ).toBeDefined(); // Should remain
      expect(
        storedMintEvents.find((e) => e.id === mockMintEvent3.id),
      ).toBeDefined(); // Should remain
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
      const position = mockDb.entities.NonFungiblePosition.get(mockPosition.id);
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
        jest.mocked(attributeLiquidityChangeToUserStatsPerPool),
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
      jest.mocked(loadPoolData).mockResolvedValue(mockPoolData);

      const increaseAmount = 168374122051126n;
      const amount0 = 18500000000n;
      const amount1 = 15171806313n;
      const mockEvent = createMockIncreaseLiquidityEvent(increaseAmount, {
        amount0,
        amount1,
      });

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
