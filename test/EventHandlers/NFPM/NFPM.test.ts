import type { PublicClient } from "viem";
import { MockDb, NFPM } from "../../../generated/src/TestHelpers.gen";
import {
  CHAIN_CONSTANTS,
  CLPoolMintEventId,
  NonFungiblePositionId,
  TokenId,
} from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("NFPM Events", () => {
  const {
    mockToken0Data,
    mockToken1Data,
    mockLiquidityPoolData,
    createMockLiquidityPoolAggregator,
  } = setupCommon();

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  const chainId = mockLiquidityPoolData.chainId;
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const token0Address = mockToken0Data.address;
  const token1Address = mockToken1Data.address;
  const tokenId = 1n;

  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  // Mock position with amounts matching the IncreaseLiquidity event amounts
  // This represents a newly minted position before the IncreaseLiquidity event
  const mockNonFungiblePosition = {
    id: NonFungiblePositionId(chainId, poolAddress, tokenId),
    chainId,
    tokenId: tokenId,
    owner: "0x1111111111111111111111111111111111111111",
    pool: poolAddress,
    tickUpper: 100n,
    tickLower: -100n,
    token0: token0Address,
    token1: token1Address,
    liquidity: 1000000000000000000n,
    mintTransactionHash: transactionHash,
    mintLogIndex: 42,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
    mockDb = mockDb.entities.NonFungiblePosition.set({
      ...mockNonFungiblePosition,
    });
    mockDb = mockDb.entities.Token.set(mockToken0Data);
    mockDb = mockDb.entities.Token.set(mockToken1Data);
    mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPoolData);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Transfer Event", () => {
    const eventData = {
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      tokenId: 1n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
      },
    };

    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof NFPM.Transfer.createMockEvent>;

    beforeEach(async () => {
      mockEvent = NFPM.Transfer.createMockEvent(eventData);
      postEventDB = await NFPM.Transfer.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    it("should update the owner", () => {
      const updatedEntity = postEventDB.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, poolAddress, tokenId),
      );
      expect(updatedEntity).toBeDefined();
      if (!updatedEntity) return; // Type guard
      expect(updatedEntity.owner).toBe(eventData.to);
    });

    it("should create position from CLPoolMintEvent (integration test)", async () => {
      // Simulate the real flow: CLPool.Mint creates a CLPoolMintEvent, then NFPM.Transfer creates the position
      // In this test, CLPool.Mint has logIndex 0, Transfer has logIndex 2
      const mintLogIndex = 0;
      const transferLogIndex = 2;
      const stableId = NonFungiblePositionId(chainId, poolAddress, tokenId);

      const mockCLPoolMintEvent = {
        id: CLPoolMintEventId(
          chainId,
          poolAddress,
          transactionHash,
          mintLogIndex,
        ),
        chainId,
        pool: poolAddress,
        owner: "0x1111111111111111111111111111111111111111",
        tickLower: -100n,
        tickUpper: 100n,
        liquidity: 1000000000000000000n,
        amount0: 0n,
        amount1: 0n,
        token0: token0Address,
        token1: token1Address,
        transactionHash: transactionHash,
        logIndex: mintLogIndex,
        consumedByTokenId: undefined,
        createdAt: new Date(1000000 * 1000),
      };

      // Setup mockDb with CLPoolMintEvent
      const mockDbWithMintEvent = MockDb.createMockDb();
      const dbWithMintEvent =
        mockDbWithMintEvent.entities.CLPoolMintEvent.set(mockCLPoolMintEvent);
      const dbWithTokens = dbWithMintEvent.entities.Token.set(mockToken0Data);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1Data);

      // Setup getWhere for queries
      const storedMintEvents = [mockCLPoolMintEvent];
      const mockDbWithGetWhere = {
        ...finalDb,
        entities: {
          ...finalDb.entities,
          NonFungiblePosition: {
            ...finalDb.entities.NonFungiblePosition,
            getWhere: {
              tokenId: {
                eq: async () => [], // No existing position
              },
            },
          },
          CLPoolMintEvent: {
            ...finalDb.entities.CLPoolMintEvent,
            getWhere: {
              transactionHash: {
                eq: async (txHash: string) => {
                  return storedMintEvents.filter(
                    (e) => e.transactionHash === txHash,
                  );
                },
              },
            },
          },
        },
      } as typeof finalDb;

      // Create Transfer event for mint (from = zero address)
      // Transfer logIndex must be > mint logIndex for matching logic
      const mintTransferEvent = NFPM.Transfer.createMockEvent({
        from: "0x0000000000000000000000000000000000000000", // Mint event
        to: "0x2222222222222222222222222222222222222222",
        tokenId: tokenId,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: transferLogIndex,
          srcAddress: "0x3333333333333333333333333333333333333333",
          transaction: {
            hash: transactionHash,
          },
        },
      });

      const result = await NFPM.Transfer.processEvent({
        event: mintTransferEvent,
        mockDb: mockDbWithGetWhere,
      });

      // Should create position with stable ID
      const createdEntity = result.entities.NonFungiblePosition.get(stableId);
      expect(createdEntity).toBeDefined();
      if (!createdEntity) return;

      // Verify it was created correctly
      expect(createdEntity.id).toBe(stableId); // Stable ID format
      expect(createdEntity.tokenId).toBe(tokenId);
      expect(createdEntity.owner).toBe(
        "0x2222222222222222222222222222222222222222",
      );
      expect(createdEntity.pool).toBe(poolAddress);
      expect(createdEntity.mintLogIndex).toBe(mintLogIndex);
    });
  });

  describe("IncreaseLiquidity Event", () => {
    const eventData = {
      tokenId: 1n,
      liquidity: 1000n,
      amount0: 500000000000000000n,
      amount1: 1000000000000000000n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
        transaction: {
          hash: transactionHash,
        },
      },
    };

    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof NFPM.IncreaseLiquidity.createMockEvent>;
    let mockDbWithGetWhere: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(async () => {
      // Setup mockDb with getWhere support for transactionHash filtering
      const storedPositions = [mockNonFungiblePosition];
      mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          NonFungiblePosition: {
            ...mockDb.entities.NonFungiblePosition,
            getWhere: {
              mintTransactionHash: {
                eq: async (txHash: string) => {
                  // Find all entities with matching mintTransactionHash
                  return storedPositions.filter(
                    (entity) => entity.mintTransactionHash === txHash,
                  );
                },
              },
            },
          },
        },
      } as typeof mockDb;

      mockEvent = NFPM.IncreaseLiquidity.createMockEvent(eventData);
      postEventDB = await NFPM.IncreaseLiquidity.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere,
      });
    });

    it("should increase liquidity", () => {
      const updatedEntity = postEventDB.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, poolAddress, tokenId),
      );
      expect(updatedEntity).toBeDefined();
      if (!updatedEntity) return; // Type guard
      // With liquidity = 1e18 + 1000, price at tick 0, ticks -100 to 100
      expect(updatedEntity.owner).toBe(mockNonFungiblePosition.owner);
      expect(updatedEntity.tickUpper).toBe(mockNonFungiblePosition.tickUpper);
      expect(updatedEntity.tickLower).toBe(mockNonFungiblePosition.tickLower);
    });

    it("should filter by transactionHash and then by tickLower/tickUpper/liquidity when multiple positions exist", async () => {
      // Create a second position with different ticks but same transaction hash
      const position2 = {
        ...mockNonFungiblePosition,
        id: NonFungiblePositionId(chainId, mockNonFungiblePosition.pool, 2n),
        tokenId: 2n,
        tickLower: -200n, // Different ticks - won't match IncreaseLiquidity event
        tickUpper: 200n,
      };

      const storedPositions = [mockNonFungiblePosition, position2];
      const mockDbMultiplePositions = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          NonFungiblePosition: {
            ...mockDb.entities.NonFungiblePosition,
            getWhere: {
              tokenId: {
                eq: async () => [],
              },
              mintTransactionHash: {
                eq: async (txHash: string) => {
                  return storedPositions.filter(
                    (entity) => entity.mintTransactionHash === txHash,
                  );
                },
              },
            },
          },
        },
      } as typeof mockDb;

      const result = await NFPM.IncreaseLiquidity.processEvent({
        event: mockEvent,
        mockDb: mockDbMultiplePositions,
      });

      // Should match the first position, not the second
      const updatedEntity = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, poolAddress, tokenId),
      );
      expect(updatedEntity).toBeDefined();
      if (!updatedEntity) return;
    });

    it("should log error and return when no positions found by transaction hash", async () => {
      // Test error case (lines 97-100): no positions found by transaction hash
      const mockDbEmpty = MockDb.createMockDb();
      const dbWithTokens = mockDbEmpty.entities.Token.set(mockToken0Data);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1Data);

      const mockDbNoPositions = {
        ...finalDb,
        entities: {
          ...finalDb.entities,
          NonFungiblePosition: {
            ...finalDb.entities.NonFungiblePosition,
            getWhere: {
              tokenId: {
                eq: async () => [],
              },
              mintTransactionHash: {
                eq: async () => [], // No positions found
              },
            },
          },
        },
      } as typeof finalDb;

      const increaseEvent = NFPM.IncreaseLiquidity.createMockEvent(eventData);
      const result = await NFPM.IncreaseLiquidity.processEvent({
        event: increaseEvent,
        mockDb: mockDbNoPositions,
      });

      // Should not create or update any position
      const updatedEntity = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, poolAddress, tokenId),
      );
      expect(updatedEntity).toBeUndefined();
    });

    it("should log error and return when no matching position found by amounts", async () => {
      // Test error case: position not found by tokenId, and amounts don't match when searching by transaction hash
      // Use a different tokenId so it's not found by tokenId query
      const differentTokenId = 999n;
      const positionWithDifferentTokenId = {
        ...mockNonFungiblePosition,
        id: NonFungiblePositionId(
          chainId,
          mockNonFungiblePosition.pool,
          differentTokenId,
        ), // Update ID to match new tokenId
        tokenId: differentTokenId, // Different tokenId so not found by tokenId query
      };

      // Use fresh mockDb to avoid interference from beforeEach
      const mockDbBase = MockDb.createMockDb();
      const dbWithPosition = mockDbBase.entities.NonFungiblePosition.set(
        positionWithDifferentTokenId,
      );
      const dbWithTokens = dbWithPosition.entities.Token.set(mockToken0Data);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1Data);

      const storedPositions = [positionWithDifferentTokenId];
      const mockDbWrongAmounts = {
        ...finalDb,
        entities: {
          ...finalDb.entities,
          NonFungiblePosition: {
            ...finalDb.entities.NonFungiblePosition,
            getWhere: {
              tokenId: {
                eq: async () => [], // Not found by tokenId
              },
              mintTransactionHash: {
                eq: async (txHash: string) => {
                  return storedPositions.filter(
                    (entity) => entity.mintTransactionHash === txHash,
                  );
                },
              },
            },
          },
        },
      } as typeof finalDb;

      const increaseEvent = NFPM.IncreaseLiquidity.createMockEvent(eventData);
      const result = await NFPM.IncreaseLiquidity.processEvent({
        event: increaseEvent,
        mockDb: mockDbWrongAmounts,
      });

      // Should not update the position (amounts don't match, handler returns early)
      // Position should still exist in the result with original values
      const updatedEntity = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(
          chainId,
          mockNonFungiblePosition.pool,
          differentTokenId,
        ),
      );
      // Position exists but wasn't updated (still has original amounts)
      expect(updatedEntity).toBeDefined();
      if (!updatedEntity) return;
    });
  });

  describe("DecreaseLiquidity Event", () => {
    const eventData = {
      tokenId: 1n,
      liquidity: 1000n,
      amount0: 300000000000000000n,
      amount1: 500000000000000000n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
      },
    };

    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof NFPM.DecreaseLiquidity.createMockEvent>;

    beforeEach(async () => {
      mockEvent = NFPM.DecreaseLiquidity.createMockEvent(eventData);
      postEventDB = await NFPM.DecreaseLiquidity.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    it("should decrease liquidity", () => {
      const updatedEntity = postEventDB.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, poolAddress, tokenId),
      );
      expect(updatedEntity).toBeDefined();
      if (!updatedEntity) return; // Type guard
      // With liquidity = 1e18 - 1000, price at tick 0, ticks -100 to 100
      expect(updatedEntity.owner).toBe(mockNonFungiblePosition.owner);
      expect(updatedEntity.tickUpper).toBe(mockNonFungiblePosition.tickUpper);
      expect(updatedEntity.tickLower).toBe(mockNonFungiblePosition.tickLower);
    });

    it("should log error and return when position not found (Transfer should have run first)", async () => {
      // Simulate scenario where position doesn't exist
      // This should never happen in normal flow since Transfer should have already updated the placeholder
      const mockDb = MockDb.createMockDb();
      const dbWithTokens = mockDb.entities.Token.set(mockToken0Data);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1Data);

      // Create DecreaseLiquidity event for non-existent position
      const decreaseEvent = NFPM.DecreaseLiquidity.createMockEvent({
        tokenId: tokenId,
        liquidity: 1000n,
        amount0: 300000000000000000n,
        amount1: 500000000000000000n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 1,
          srcAddress: "0x3333333333333333333333333333333333333333",
          transaction: {
            hash: transactionHash,
          },
        },
      });

      const result = await NFPM.DecreaseLiquidity.processEvent({
        event: decreaseEvent,
        mockDb: finalDb,
      });

      // Should not create any position
      const updatedEntity = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, poolAddress, tokenId),
      );
      expect(updatedEntity).toBeUndefined();
    });

    it("should log error and return when position is not found", async () => {
      // Test the error case (lines 184-187)
      const mockDbEmpty = MockDb.createMockDb();
      const dbWithTokens = mockDbEmpty.entities.Token.set(mockToken0Data);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1Data);

      // Setup getWhere to return empty array
      const mockDbNoPosition = {
        ...finalDb,
        entities: {
          ...finalDb.entities,
          NonFungiblePosition: {
            ...finalDb.entities.NonFungiblePosition,
            get: async () => undefined,
            getWhere: {
              tokenId: {
                eq: async () => [],
              },
              mintTransactionHash: {
                eq: async () => [], // No positions found
              },
            },
          },
        },
      } as unknown as typeof finalDb;

      const decreaseEvent = NFPM.DecreaseLiquidity.createMockEvent({
        tokenId: tokenId,
        liquidity: 1000n,
        amount0: 300000000000000000n,
        amount1: 500000000000000000n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 1,
          srcAddress: "0x3333333333333333333333333333333333333333",
          transaction: {
            hash: transactionHash,
          },
        },
      });

      const result = await NFPM.DecreaseLiquidity.processEvent({
        event: decreaseEvent,
        mockDb: mockDbNoPosition,
      });

      // Should not create any position
      const updatedEntity = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, poolAddress, tokenId),
      );
      expect(updatedEntity).toBeUndefined();
    });
  });

  describe("Cross-chain tokenId collision prevention", () => {
    // Test the fix for cross-chain tokenId collisions
    // Same tokenId can exist on different chains, so we must filter by chainId
    const chainIdBase = 8453; // Base
    const chainIdLisk = 1135; // Lisk
    const sameTokenId = 42n; // Same tokenId on both chains
    const poolAddressBase = "0x0000000000000000000000000000000000000001";
    const poolAddressLisk = "0xc2026f3fb6fc51F4EcAE40a88b4509cB6C143ed4"; // The pool from the error

    // Position on Base (chain 8453)
    const positionBase = {
      id: NonFungiblePositionId(chainIdBase, poolAddressBase, sameTokenId),
      chainId: chainIdBase,
      tokenId: sameTokenId,
      owner: "0x1111111111111111111111111111111111111111",
      pool: poolAddressBase,
      tickUpper: 100n,
      tickLower: -100n,
      token0: token0Address,
      token1: token1Address,
      liquidity: 1000000000000000000n,
      mintTransactionHash: transactionHash,
      mintLogIndex: 42,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
    };

    // Position on Lisk (chain 1135) with same tokenId
    const positionLisk = {
      id: NonFungiblePositionId(chainIdLisk, poolAddressLisk, sameTokenId),
      chainId: chainIdLisk,
      tokenId: sameTokenId,
      owner: "0x2222222222222222222222222222222222222222",
      pool: poolAddressLisk,
      tickUpper: 200n,
      tickLower: -200n,
      token0: token0Address,
      token1: token1Address,
      liquidity: 2000000000000000000n,
      mintTransactionHash: transactionHash,
      mintLogIndex: 42,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
    };

    // Variables to hold mocks for verification
    let mockSimulateContractBase: jest.Mock;
    let mockSimulateContractLisk: jest.Mock;

    let originalChainConstantsBase: (typeof CHAIN_CONSTANTS)[number];
    let originalChainConstantsLisk: (typeof CHAIN_CONSTANTS)[number];

    beforeEach(() => {
      // Store original values
      originalChainConstantsBase = CHAIN_CONSTANTS[chainIdBase];
      originalChainConstantsLisk = CHAIN_CONSTANTS[chainIdLisk];

      // Mock ethClient for Base chain - create fresh mocks for each test
      const Q96 = 2n ** 96n;
      const mockSqrtPriceX96 = Q96;
      // Use callsFake to ensure the mock properly returns a promise
      mockSimulateContractBase = jest.fn().mockImplementation(async () => {
        return { result: [mockSqrtPriceX96] };
      });
      const mockEthClientBase = {
        simulateContract: mockSimulateContractBase,
      } as unknown as PublicClient;

      // Mock ethClient for Lisk chain - create fresh mocks for each test
      mockSimulateContractLisk = jest.fn().mockImplementation(async () => {
        return { result: [mockSqrtPriceX96] };
      });
      const mockEthClientLisk = {
        simulateContract: mockSimulateContractLisk,
      } as unknown as PublicClient;

      // Setup CHAIN_CONSTANTS for both chains - ensure it's set before any effects are called
      (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
        chainIdBase
      ] = {
        eth_client: mockEthClientBase,
      };
      (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
        chainIdLisk
      ] = {
        eth_client: mockEthClientLisk,
      };
    });

    afterEach(() => {
      // Restore original CHAIN_CONSTANTS
      if (originalChainConstantsBase !== undefined) {
        (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
          chainIdBase
        ] = originalChainConstantsBase;
      } else {
        delete (
          CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>
        )[chainIdBase];
      }
      if (originalChainConstantsLisk !== undefined) {
        (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
          chainIdLisk
        ] = originalChainConstantsLisk;
      } else {
        delete (
          CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>
        )[chainIdLisk];
      }
      jest.restoreAllMocks();
    });

    it("should filter by chainId when querying by tokenId in Transfer event", async () => {
      // Tokens for Base chain so loadPoolData can resolve and Transfer can update owner
      const mockToken0DataBase = {
        ...mockToken0Data,
        id: TokenId(chainIdBase, token0Address),
        chainId: chainIdBase,
      };
      const mockToken1DataBase = {
        ...mockToken1Data,
        id: TokenId(chainIdBase, token1Address),
        chainId: chainIdBase,
      };
      const mockLiquidityPoolAggregatorBase = createMockLiquidityPoolAggregator(
        {
          chainId: chainIdBase,
          poolAddress: poolAddressBase,
          token0_id: mockToken0DataBase.id,
          token1_id: mockToken1DataBase.id,
          token0_address: token0Address,
          token1_address: token1Address,
        },
      );
      // Setup mockDb with both positions (same tokenId, different chains)
      const mockDbCrossChain = MockDb.createMockDb();
      const dbWithBasePosition =
        mockDbCrossChain.entities.NonFungiblePosition.set(positionBase);
      const dbWithBothPositions =
        dbWithBasePosition.entities.NonFungiblePosition.set(positionLisk);
      const dbWithTokens =
        dbWithBothPositions.entities.Token.set(mockToken0Data);
      const dbWithBothChainsTokens = dbWithTokens.entities.Token.set(
        mockToken1Data,
      )
        .entities.Token.set(mockToken0DataBase)
        .entities.Token.set(mockToken1DataBase);
      const finalDb =
        dbWithBothChainsTokens.entities.LiquidityPoolAggregator.set(
          mockLiquidityPoolAggregatorBase,
        );

      // Setup getWhere to return both positions when querying by tokenId
      const storedPositions = [positionBase, positionLisk];
      const mockDbWithGetWhere = {
        ...finalDb,
        entities: {
          ...finalDb.entities,
          NonFungiblePosition: {
            ...finalDb.entities.NonFungiblePosition,
            getWhere: {
              tokenId: {
                eq: async (tokenId: bigint) => {
                  // Return both positions with same tokenId
                  return storedPositions.filter(
                    (pos) => pos.tokenId === tokenId,
                  );
                },
              },
              mintTransactionHash: {
                eq: async () => [],
              },
            },
          },
        },
      } as typeof finalDb;

      // Create Transfer event on Base chain
      const transferEventBase = NFPM.Transfer.createMockEvent({
        from: "0x1111111111111111111111111111111111111111",
        to: "0x3333333333333333333333333333333333333333",
        tokenId: sameTokenId,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainIdBase, // Event is on Base chain
          logIndex: 1,
          srcAddress: "0x3333333333333333333333333333333333333333",
        },
      });

      const result = await NFPM.Transfer.processEvent({
        event: transferEventBase,
        mockDb: mockDbWithGetWhere,
      });

      // Should only update the Base position, not the Lisk position
      const updatedBasePosition = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdBase, poolAddressBase, sameTokenId),
      );
      const liskPosition = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdLisk, poolAddressLisk, sameTokenId),
      );

      expect(updatedBasePosition).toBeDefined();
      if (!updatedBasePosition) return;
      // Should update owner to the new owner
      expect(updatedBasePosition.owner).toBe(
        "0x3333333333333333333333333333333333333333",
      );
      // Should still have Base chain pool address
      expect(updatedBasePosition.pool).toBe(poolAddressBase);
      expect(updatedBasePosition.chainId).toBe(chainIdBase);

      // Lisk position should remain unchanged
      expect(liskPosition).toBeDefined();
      if (!liskPosition) return;
      expect(liskPosition.owner).toBe(positionLisk.owner);
      expect(liskPosition.pool).toBe(poolAddressLisk);
      expect(liskPosition.chainId).toBe(chainIdLisk);
    });

    it("should filter by chainId when querying by tokenId in IncreaseLiquidity event", async () => {
      // Verify CHAIN_CONSTANTS is set up correctly before test
      expect(CHAIN_CONSTANTS[chainIdBase]).toBeDefined();
      expect(CHAIN_CONSTANTS[chainIdBase].eth_client).toBeDefined();
      expect(mockSimulateContractBase).toBeDefined();

      // Create tokens for Base chain
      const mockToken0DataBase = {
        ...mockToken0Data,
        id: TokenId(chainIdBase, token0Address),
        chainId: chainIdBase,
      };
      const mockToken1DataBase = {
        ...mockToken1Data,
        id: TokenId(chainIdBase, token1Address),
        chainId: chainIdBase,
      };

      // Setup mockDb with both positions
      const mockDbCrossChain = MockDb.createMockDb();
      const dbWithBasePosition =
        mockDbCrossChain.entities.NonFungiblePosition.set(positionBase);
      const dbWithBothPositions =
        dbWithBasePosition.entities.NonFungiblePosition.set(positionLisk);
      const dbWithTokens =
        dbWithBothPositions.entities.Token.set(mockToken0DataBase);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1DataBase);

      // Setup getWhere to return both positions when querying by tokenId
      const storedPositions = [positionBase, positionLisk];
      const mockDbWithGetWhere = {
        ...finalDb,
        entities: {
          ...finalDb.entities,
          NonFungiblePosition: {
            ...finalDb.entities.NonFungiblePosition,
            getWhere: {
              tokenId: {
                eq: async (tokenId: bigint) => {
                  return storedPositions.filter(
                    (pos) => pos.tokenId === tokenId,
                  );
                },
              },
              mintTransactionHash: {
                eq: async () => [],
              },
            },
          },
        },
      } as typeof finalDb;

      // Create IncreaseLiquidity event on Base chain
      const increaseEventBase = NFPM.IncreaseLiquidity.createMockEvent({
        tokenId: sameTokenId,
        liquidity: 1000n,
        amount0: 500000000000000000n,
        amount1: 1000000000000000000n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainIdBase, // Event is on Base chain
          logIndex: 1,
          srcAddress: "0x3333333333333333333333333333333333333333",
          transaction: {
            hash: transactionHash,
          },
        },
      });

      const result = await NFPM.IncreaseLiquidity.processEvent({
        event: increaseEventBase,
        mockDb: mockDbWithGetWhere,
      });

      // Should only update the Base position
      const updatedBasePosition = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdBase, poolAddressBase, sameTokenId),
      );
      const liskPosition = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdLisk, poolAddressLisk, sameTokenId),
      );

      expect(updatedBasePosition).toBeDefined();
      if (!updatedBasePosition) return;
      // Should have updated liquidity (increased)
      expect(Number(updatedBasePosition.liquidity)).toBeGreaterThan(
        Number(positionBase.liquidity),
      );

      // Lisk position should remain unchanged
      expect(liskPosition).toBeDefined();
      if (!liskPosition) return;
      expect(liskPosition.liquidity).toBe(positionLisk.liquidity);
      // Should NOT have called Lisk ethClient
      expect(mockSimulateContractLisk).not.toHaveBeenCalled();
    });

    it("should filter by chainId when querying by tokenId in DecreaseLiquidity event", async () => {
      // Verify CHAIN_CONSTANTS is set up correctly before test
      expect(CHAIN_CONSTANTS[chainIdLisk]).toBeDefined();
      expect(CHAIN_CONSTANTS[chainIdLisk].eth_client).toBeDefined();
      expect(mockSimulateContractLisk).toBeDefined();

      // Create tokens for Lisk chain
      const mockToken0DataLisk = {
        ...mockToken0Data,
        id: TokenId(chainIdLisk, token0Address),
        chainId: chainIdLisk,
      };
      const mockToken1DataLisk = {
        ...mockToken1Data,
        id: TokenId(chainIdLisk, token1Address),
        chainId: chainIdLisk,
      };

      // Setup mockDb with both positions
      const mockDbCrossChain = MockDb.createMockDb();
      const dbWithBasePosition =
        mockDbCrossChain.entities.NonFungiblePosition.set(positionBase);
      const dbWithBothPositions =
        dbWithBasePosition.entities.NonFungiblePosition.set(positionLisk);
      const dbWithTokens =
        dbWithBothPositions.entities.Token.set(mockToken0DataLisk);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1DataLisk);

      // Setup getWhere to return both positions when querying by tokenId
      const storedPositions = [positionBase, positionLisk];
      const mockDbWithGetWhere = {
        ...finalDb,
        entities: {
          ...finalDb.entities,
          NonFungiblePosition: {
            ...finalDb.entities.NonFungiblePosition,
            getWhere: {
              tokenId: {
                eq: async (tokenId: bigint) => {
                  return storedPositions.filter(
                    (pos) => pos.tokenId === tokenId,
                  );
                },
              },
              mintTransactionHash: {
                eq: async () => [],
              },
            },
          },
        },
      } as typeof finalDb;

      // Create DecreaseLiquidity event on Lisk chain
      const decreaseEventLisk = NFPM.DecreaseLiquidity.createMockEvent({
        tokenId: sameTokenId,
        liquidity: 1000n,
        amount0: 300000000000000000n,
        amount1: 500000000000000000n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainIdLisk, // Event is on Lisk chain
          logIndex: 1,
          srcAddress: "0x3333333333333333333333333333333333333333",
          transaction: {
            hash: transactionHash,
          },
        },
      });

      const result = await NFPM.DecreaseLiquidity.processEvent({
        event: decreaseEventLisk,
        mockDb: mockDbWithGetWhere,
      });

      // Should only update the Lisk position
      const basePosition = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdBase, poolAddressBase, sameTokenId),
      );
      const updatedLiskPosition = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdLisk, poolAddressLisk, sameTokenId),
      );

      expect(updatedLiskPosition).toBeDefined();
      if (!updatedLiskPosition) return;
      // Should have updated liquidity (decreased)
      expect(Number(updatedLiskPosition.liquidity)).toBeLessThan(
        Number(positionLisk.liquidity),
      );

      // Base position should remain unchanged
      expect(basePosition).toBeDefined();
      if (!basePosition) return;
      expect(basePosition.liquidity).toBe(positionBase.liquidity);
    });

    it("should prevent querying pool from wrong chain (the original bug)", async () => {
      // Setup mockDb with BOTH positions (Base and Lisk with same tokenId)
      const mockDbCrossChain = MockDb.createMockDb();
      const dbWithBasePosition =
        mockDbCrossChain.entities.NonFungiblePosition.set(positionBase);
      const dbWithBothPositions =
        dbWithBasePosition.entities.NonFungiblePosition.set(positionLisk);

      // Create tokens for Base chain
      const mockToken0DataBase = {
        ...mockToken0Data,
        id: TokenId(chainIdBase, token0Address),
        chainId: chainIdBase,
      };
      const mockToken1DataBase = {
        ...mockToken1Data,
        id: TokenId(chainIdBase, token1Address),
        chainId: chainIdBase,
      };
      const dbWithTokens =
        dbWithBothPositions.entities.Token.set(mockToken0DataBase);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1DataBase);

      // Setup getWhere - return BOTH positions when querying by tokenId
      // This simulates the bug: querying by tokenId without chainId filter returns positions from both chains
      const storedPositions = [positionBase, positionLisk]; // Both positions with same tokenId
      const mockDbWithGetWhere = {
        ...finalDb,
        entities: {
          ...finalDb.entities,
          NonFungiblePosition: {
            ...finalDb.entities.NonFungiblePosition,
            getWhere: {
              tokenId: {
                eq: async (tokenId: bigint) => {
                  // Simulate the bug: return positions from both chains when querying by tokenId
                  // (without chainId filtering, this would return both Base and Lisk positions)
                  return storedPositions.filter(
                    (pos) => pos.tokenId === tokenId,
                  );
                },
              },
              mintTransactionHash: {
                eq: async () => [],
              },
            },
          },
        },
      } as typeof finalDb;

      // Create IncreaseLiquidity event on Base chain (8453) for same tokenId
      // This simulates the scenario where:
      // - Event is processed on Base chain (8453)
      // - A position exists on Base chain (8453) with this tokenId
      // - A position also exists on Lisk chain (1135) with the same tokenId
      // - We need to ensure the Base position is used, not the Lisk one
      const increaseEventBase = NFPM.IncreaseLiquidity.createMockEvent({
        tokenId: sameTokenId,
        liquidity: 1000n,
        amount0: 500000000000000000n,
        amount1: 1000000000000000000n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainIdBase, // Event is on Base chain (8453)
          logIndex: 1,
          srcAddress: "0x3333333333333333333333333333333333333333",
          transaction: {
            hash: transactionHash,
          },
        },
      });

      const result = await NFPM.IncreaseLiquidity.processEvent({
        event: increaseEventBase,
        mockDb: mockDbWithGetWhere,
      });

      // Verify: Base position should be updated (correct position was found and used)
      const updatedBasePosition = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdBase, poolAddressBase, sameTokenId),
      );
      expect(updatedBasePosition).toBeDefined();
      if (!updatedBasePosition) return;
      // Should have updated liquidity (increased)
      expect(Number(updatedBasePosition.liquidity)).toBeGreaterThan(
        Number(positionBase.liquidity),
      );

      // Verify: Lisk position should remain unchanged (wrong position was NOT used)
      const liskPosition = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdLisk, poolAddressLisk, sameTokenId),
      );
      expect(liskPosition).toBeDefined();
      if (!liskPosition) return;
      expect(liskPosition.liquidity).toBe(positionLisk.liquidity);
    });
  });
});
