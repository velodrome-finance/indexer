import { expect } from "chai";
import sinon from "sinon";
import type { PublicClient } from "viem";
import { MockDb, NFPM } from "../../../generated/src/TestHelpers.gen";
import { CHAIN_CONSTANTS, TokenIdByChain } from "../../../src/Constants";

const NonFungiblePositionId = (chainId: number, tokenId: bigint) =>
  `${chainId}_${tokenId}`;

const TokenId = (chainId: number, tokenAddress: string) =>
  TokenIdByChain(tokenAddress, chainId);

describe("NFPM Events", () => {
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  const chainId = 10;
  const tokenId = 1n;
  // Use valid Ethereum addresses for tests (TokenIdByChain validates addresses)
  const token0Address = "0x2222222222222222222222222222222222222222";
  const token1Address = "0x3333333333333333333333333333333333333333";

  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  // Mock position with amounts matching the IncreaseLiquidity event amounts
  // This represents a newly minted position before the IncreaseLiquidity event
  const mockNonFungiblePosition = {
    id: NonFungiblePositionId(chainId, tokenId),
    chainId: 10,
    tokenId: tokenId,
    owner: "0x1111111111111111111111111111111111111111",
    pool: "0xPoolAddress0000000000000000000000",
    tickUpper: 100n,
    tickLower: -100n,
    token0: token0Address,
    token1: token1Address,
    liquidity: 1000000000000000000n,
    // Initial amounts match what will be in the IncreaseLiquidity event for a newly minted position
    amount0: 500000000000000000n, // Matches IncreaseLiquidity event amount0
    amount1: 1000000000000000000n, // Matches IncreaseLiquidity event amount1
    amountUSD: 2500000000000000000n, // (0.5 * 1) + (1 * 2) = 2.5
    mintTransactionHash: transactionHash,
    lastUpdatedTimestamp: new Date(),
  };

  // Mock Token entities needed for calculateTotalLiquidityUSD
  // pricePerUSDNew is stored with 18 decimals (1e18 = 1 USD per token)
  const mockToken0 = {
    id: TokenId(chainId, token0Address),
    chainId: chainId,
    address: token0Address,
    symbol: "TOKEN0",
    name: "Token 0",
    decimals: 18n,
    pricePerUSD: 0n,
    pricePerUSDNew: 10n ** 18n, // 1 USD per token (1e18)
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
  };

  const mockToken1 = {
    id: TokenId(chainId, token1Address),
    chainId: chainId,
    address: token1Address,
    symbol: "TOKEN1",
    name: "Token 1",
    decimals: 18n,
    pricePerUSD: 0n,
    pricePerUSDNew: 2n * 10n ** 18n, // 2 USD per token (2e18)
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
  };

  beforeEach(() => {
    // Mock ethClient to return proper slot0 structure for getSqrtPriceX96 effect
    const Q96 = 2n ** 96n;
    const mockSqrtPriceX96 = Q96; // Price at tick 0
    const mockEthClient = {
      simulateContract: sinon.stub().resolves({
        result: [mockSqrtPriceX96], // slot0 returns array with sqrtPriceX96 as first element
      }),
    } as unknown as PublicClient;

    // Mock CHAIN_CONSTANTS to provide mock ethClient
    (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[chainId] =
      {
        eth_client: mockEthClient,
      };

    mockDb = MockDb.createMockDb();
    mockDb = mockDb.entities.NonFungiblePosition.set({
      ...mockNonFungiblePosition,
    });
    mockDb = mockDb.entities.Token.set(mockToken0);
    mockDb = mockDb.entities.Token.set(mockToken1);
  });

  afterEach(() => {
    sinon.restore();
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

    it("should update the owner and recalculate amountUSD", () => {
      const updatedEntity = postEventDB.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity).to.exist;
      if (!updatedEntity) return; // Type guard
      expect(updatedEntity.owner.toLowerCase()).to.equal(
        eventData.to.toLowerCase(),
      );
      expect(updatedEntity.amount0).to.equal(mockNonFungiblePosition.amount0);
      expect(updatedEntity.amount1).to.equal(mockNonFungiblePosition.amount1);
      // amountUSD should be recalculated: (amount0 * pricePerUSD) + (amount1 * pricePerUSD)
      // (0.5e18 * 1) + (1e18 * 2) = 0.5e18 + 2e18 = 2.5e18
      expect(updatedEntity.amountUSD).to.equal(2500000000000000000n);
    });

    it("should find and update placeholder position created by CLPool.Mint (integration test)", async () => {
      // Simulate the real flow: CLPool.Mint creates a placeholder position
      // Placeholder ID format: ${chainId}_${txHash}_${logIndex} (without 0x prefix)
      // Placeholder tokenId is set to 0n as a marker
      // In this test, CLPool.Mint has logIndex 0, Transfer has logIndex 2
      const mintLogIndex = 0;
      const transferLogIndex = 2;
      const placeholderId = `${chainId}_${transactionHash.slice(2)}_${mintLogIndex}`;
      const placeholderPosition = {
        id: placeholderId,
        chainId: chainId,
        tokenId: 0n, // Placeholder marker
        owner: "0x1111111111111111111111111111111111111111",
        pool: "0xPoolAddress0000000000000000000000",
        tickUpper: 100n,
        tickLower: -100n,
        token0: token0Address,
        token1: token1Address,
        liquidity: 1000000000000000000n,
        amount0: 500000000000000000n,
        amount1: 1000000000000000000n,
        amountUSD: 2500000000000000000n,
        mintTransactionHash: transactionHash,
        lastUpdatedTimestamp: new Date(),
      };

      // Setup mockDb with placeholder position
      const mockDbWithPlaceholder = MockDb.createMockDb();
      const dbWithPosition =
        mockDbWithPlaceholder.entities.NonFungiblePosition.set(
          placeholderPosition,
        );
      const dbWithTokens = dbWithPosition.entities.Token.set(mockToken0);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1);

      // Setup getWhere for mintTransactionHash lookup
      const storedPositions = [placeholderPosition];
      const mockDbWithGetWhere = {
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

      // Should update placeholder position in place (keep placeholder ID)
      const updatedEntity = result.entities.NonFungiblePosition.get(
        placeholderId, // Placeholder ID is kept, not changed
      );
      expect(updatedEntity).to.exist;
      if (!updatedEntity) return;

      // Verify it was updated from placeholder
      expect(updatedEntity.id).to.equal(placeholderId); // ID stays as placeholder ID
      expect(updatedEntity.tokenId).to.equal(tokenId); // tokenId updated from 0n to actual tokenId
      expect(updatedEntity.owner.toLowerCase()).to.equal(
        "0x2222222222222222222222222222222222222222".toLowerCase(),
      );
      expect(updatedEntity.amount0).to.equal(placeholderPosition.amount0);
      expect(updatedEntity.amount1).to.equal(placeholderPosition.amount1);
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

    it("should increase amount0 and amount1 and recalculate amountUSD", () => {
      const updatedEntity = postEventDB.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity).to.exist;
      if (!updatedEntity) return; // Type guard
      // Amounts are recalculated from liquidity, not added directly
      // With liquidity = 1e18 + 1000, price at tick 0, ticks -100 to 100
      expect(updatedEntity.amount0).to.equal(4987272070749101n);
      expect(updatedEntity.amount1).to.equal(4987272070749101n);
      expect(updatedEntity.owner).to.equal(mockNonFungiblePosition.owner);
      expect(updatedEntity.tickUpper).to.equal(
        mockNonFungiblePosition.tickUpper,
      );
      expect(updatedEntity.tickLower).to.equal(
        mockNonFungiblePosition.tickLower,
      );
      // amountUSD: (4987272070749101n * 1) + (5000000000000004n * 2) = 14987272070749109n
      expect(updatedEntity.amountUSD).to.equal(14961816212247303n);
    });

    it("should filter by transactionHash and then by amount0 and amount1 when multiple positions exist", async () => {
      // Create a second position with different amounts but same transaction hash
      const position2 = {
        ...mockNonFungiblePosition,
        id: NonFungiblePositionId(chainId, 2n),
        tokenId: 2n,
        amount0: 2000000000000000000n, // Different amounts - won't match IncreaseLiquidity event
        amount1: 4000000000000000000n,
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

      // Should match the first position (amount0: 0.5e18, amount1: 1e18) not the second
      const updatedEntity = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity).to.exist;
      if (!updatedEntity) return;
      // Amounts are recalculated from liquidity, not added directly
      expect(updatedEntity.amount0).to.equal(4987272070749101n);
    });

    it("should log error and return when no positions found by transaction hash", async () => {
      // Test error case (lines 97-100): no positions found by transaction hash
      const mockDbEmpty = MockDb.createMockDb();
      const dbWithTokens = mockDbEmpty.entities.Token.set(mockToken0);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1);

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
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity).to.be.undefined;
    });

    it("should log error and return when no matching position found by amounts", async () => {
      // Test error case: position not found by tokenId, and amounts don't match when searching by transaction hash
      // Use a different tokenId so it's not found by tokenId query
      const differentTokenId = 999n;
      const positionWithDifferentTokenId = {
        ...mockNonFungiblePosition,
        id: NonFungiblePositionId(chainId, differentTokenId), // Update ID to match new tokenId
        tokenId: differentTokenId, // Different tokenId so not found by tokenId query
        amount0: 999999999999999999n, // Different from event amounts (event has 0.5e18, 1e18)
        amount1: 999999999999999999n,
      };

      // Use fresh mockDb to avoid interference from beforeEach
      const mockDbBase = MockDb.createMockDb();
      const dbWithPosition = mockDbBase.entities.NonFungiblePosition.set(
        positionWithDifferentTokenId,
      );
      const dbWithTokens = dbWithPosition.entities.Token.set(mockToken0);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1);

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
        NonFungiblePositionId(chainId, differentTokenId),
      );
      // Position exists but wasn't updated (still has original amounts)
      expect(updatedEntity).to.exist;
      if (!updatedEntity) return;
      expect(updatedEntity.amount0).to.equal(999999999999999999n);
      expect(updatedEntity.amount1).to.equal(999999999999999999n);
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

    it("should decrease amount0 and amount1 and recalculate amountUSD", () => {
      const updatedEntity = postEventDB.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity).to.exist;
      if (!updatedEntity) return; // Type guard
      // Amounts are recalculated from liquidity, not subtracted directly
      // With liquidity = 1e18 - 1000, price at tick 0, ticks -100 to 100
      expect(updatedEntity.amount0).to.equal(4987272070749091n);
      expect(updatedEntity.amount1).to.equal(4987272070749091n);
      expect(updatedEntity.owner).to.equal(mockNonFungiblePosition.owner);
      expect(updatedEntity.tickUpper).to.equal(
        mockNonFungiblePosition.tickUpper,
      );
      expect(updatedEntity.tickLower).to.equal(
        mockNonFungiblePosition.tickLower,
      );
      // amountUSD: (4987272070749091n * 1) + (4999999999999994n * 2) = 14987272070749079n
      expect(updatedEntity.amountUSD).to.equal(14961816212247273n);
    });

    it("should log error and return when position not found (Transfer should have run first)", async () => {
      // Simulate scenario where position doesn't exist
      // This should never happen in normal flow since Transfer should have already updated the placeholder
      const mockDb = MockDb.createMockDb();
      const dbWithTokens = mockDb.entities.Token.set(mockToken0);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1);

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
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity).to.be.undefined;
    });

    it("should log error and return when position is not found", async () => {
      // Test the error case (lines 184-187)
      const mockDbEmpty = MockDb.createMockDb();
      const dbWithTokens = mockDbEmpty.entities.Token.set(mockToken0);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1);

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
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity).to.be.undefined;
    });
  });
});
