import { expect } from "chai";
import sinon from "sinon";
import { MockDb, NFPM } from "../../../generated/src/TestHelpers.gen";

const NonFungiblePositionId = (chainId: number, tokenId: bigint) =>
  `${chainId}_${tokenId}`;

const TokenId = (chainId: number, tokenAddress: string) =>
  `${chainId}_${tokenAddress}`;

describe("NFPM Events", () => {
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  const chainId = 10;
  const tokenId = 1n;
  const token0Address = "0xToken0Address0000000000000000000000";
  const token1Address = "0xToken1Address0000000000000000000000";

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
    // Initial amounts match what will be in the IncreaseLiquidity event for a newly minted position
    amount0: 500000000000000000n, // Matches IncreaseLiquidity event amount0
    amount1: 1000000000000000000n, // Matches IncreaseLiquidity event amount1
    amountUSD: 2500000000000000000n, // (0.5 * 1) + (1 * 2) = 2.5
    transactionHash: transactionHash,
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
    mockDb = MockDb.createMockDb();
    mockDb = mockDb.entities.NonFungiblePosition.set({
      ...mockNonFungiblePosition,
    });
    mockDb = mockDb.entities.Token.set(mockToken0);
    mockDb = mockDb.entities.Token.set(mockToken1);
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
      const placeholderPosition = {
        id: `${chainId}_0`, // Placeholder ID from CLPool.Mint (format: ${chainId}_0)
        chainId: chainId,
        tokenId: 0n, // Placeholder tokenId
        owner: "0x1111111111111111111111111111111111111111",
        pool: "0xPoolAddress0000000000000000000000",
        tickUpper: 100n,
        tickLower: -100n,
        token0: token0Address,
        token1: token1Address,
        amount0: 500000000000000000n,
        amount1: 1000000000000000000n,
        amountUSD: 2500000000000000000n,
        transactionHash: transactionHash,
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

      // Setup getWhere for transactionHash lookup
      const storedPositions = [placeholderPosition];
      const mockDbWithGetWhere = {
        ...finalDb,
        entities: {
          ...finalDb.entities,
          NonFungiblePosition: {
            ...finalDb.entities.NonFungiblePosition,
            getWhere: {
              transactionHash: {
                eq: async (txHash: string) => {
                  return storedPositions.filter(
                    (entity) => entity.transactionHash === txHash,
                  );
                },
              },
            },
          },
        },
      } as typeof finalDb;

      // Create Transfer event for mint (from = zero address)
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
          logIndex: 1,
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

      // Should create new position with correct ID
      const updatedEntity = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity).to.exist;
      if (!updatedEntity) return;

      // Verify it was migrated from placeholder
      expect(updatedEntity.id).to.equal(
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity.tokenId).to.equal(tokenId);
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
              transactionHash: {
                eq: async (txHash: string) => {
                  // Find all entities with matching transactionHash
                  return storedPositions.filter(
                    (entity) => entity.transactionHash === txHash,
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
      expect(updatedEntity.amount0).to.equal(1000000000000000000n); // 0.5e18 + 0.5e18
      expect(updatedEntity.amount1).to.equal(2000000000000000000n); // 1e18 + 1e18
      expect(updatedEntity.owner).to.equal(mockNonFungiblePosition.owner);
      expect(updatedEntity.tickUpper).to.equal(
        mockNonFungiblePosition.tickUpper,
      );
      expect(updatedEntity.tickLower).to.equal(
        mockNonFungiblePosition.tickLower,
      );
      // amountUSD: (1e18 * 1) + (2e18 * 2) = 1e18 + 4e18 = 5e18
      expect(updatedEntity.amountUSD).to.equal(5000000000000000000n);
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
              transactionHash: {
                eq: async (txHash: string) => {
                  return storedPositions.filter(
                    (entity) => entity.transactionHash === txHash,
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
      // Should be updated: 0.5e18 + 0.5e18 = 1e18
      expect(updatedEntity.amount0).to.equal(1000000000000000000n);
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
              transactionHash: {
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
      // Test error case (lines 112-115): positions found but none match by amounts
      const positionWithDifferentAmounts = {
        ...mockNonFungiblePosition,
        amount0: 999999999999999999n, // Different from event amounts (event has 0.5e18, 1e18)
        amount1: 999999999999999999n,
      };

      // Use fresh mockDb to avoid interference from beforeEach
      const mockDbBase = MockDb.createMockDb();
      const dbWithPosition = mockDbBase.entities.NonFungiblePosition.set(
        positionWithDifferentAmounts,
      );
      const dbWithTokens = dbWithPosition.entities.Token.set(mockToken0);
      const finalDb = dbWithTokens.entities.Token.set(mockToken1);

      const storedPositions = [positionWithDifferentAmounts];
      const mockDbWrongAmounts = {
        ...finalDb,
        entities: {
          ...finalDb.entities,
          NonFungiblePosition: {
            ...finalDb.entities.NonFungiblePosition,
            getWhere: {
              transactionHash: {
                eq: async (txHash: string) => {
                  return storedPositions.filter(
                    (entity) => entity.transactionHash === txHash,
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
      const updatedEntity = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, tokenId),
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
      expect(updatedEntity.amount0).to.equal(200000000000000000n); // 0.5e18 - 0.3e18
      expect(updatedEntity.amount1).to.equal(500000000000000000n); // 1e18 - 0.5e18
      expect(updatedEntity.owner).to.equal(mockNonFungiblePosition.owner);
      expect(updatedEntity.tickUpper).to.equal(
        mockNonFungiblePosition.tickUpper,
      );
      expect(updatedEntity.tickLower).to.equal(
        mockNonFungiblePosition.tickLower,
      );
      // amountUSD: (0.2e18 * 1) + (0.5e18 * 2) = 0.2e18 + 1e18 = 1.2e18
      expect(updatedEntity.amountUSD).to.equal(1200000000000000000n);
    });

    it("should find placeholder position if Transfer hasn't run yet (integration test)", async () => {
      // Simulate scenario where DecreaseLiquidity runs before Transfer
      const placeholderPosition = {
        id: `${chainId}_0`, // Placeholder ID from CLPool.Mint (format: ${chainId}_0)
        chainId: chainId,
        tokenId: 0n, // Placeholder tokenId
        owner: "0x1111111111111111111111111111111111111111",
        pool: "0xPoolAddress0000000000000000000000",
        tickUpper: 100n,
        tickLower: -100n,
        token0: token0Address,
        token1: token1Address,
        amount0: 500000000000000000n,
        amount1: 1000000000000000000n,
        amountUSD: 2500000000000000000n,
        transactionHash: transactionHash,
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

      // Setup getWhere for transactionHash lookup
      const storedPositions = [placeholderPosition];
      const mockDbWithGetWhere = {
        ...finalDb,
        entities: {
          ...finalDb.entities,
          NonFungiblePosition: {
            ...finalDb.entities.NonFungiblePosition,
            getWhere: {
              transactionHash: {
                eq: async (txHash: string) => {
                  return storedPositions.filter(
                    (entity) => entity.transactionHash === txHash,
                  );
                },
              },
            },
          },
        },
      } as typeof finalDb;

      // Create DecreaseLiquidity event
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
        mockDb: mockDbWithGetWhere,
      });

      // Should create new position with correct ID and decreased amounts
      const updatedEntity = result.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity).to.exist;
      if (!updatedEntity) return;

      // Verify it was migrated from placeholder and amounts decreased
      expect(updatedEntity.id).to.equal(
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity.tokenId).to.equal(tokenId);
      expect(updatedEntity.amount0).to.equal(200000000000000000n); // 0.5e18 - 0.3e18
      expect(updatedEntity.amount1).to.equal(500000000000000000n); // 1e18 - 0.5e18
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
              transactionHash: {
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
