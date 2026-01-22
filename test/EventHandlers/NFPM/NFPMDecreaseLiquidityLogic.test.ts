import type {
  NFPM_DecreaseLiquidity_event,
  NonFungiblePosition,
  handlerContext,
} from "generated";
import { MockDb, NFPM } from "../../../generated/src/TestHelpers.gen";
import {
  _calculateDecreaseLiquidityDiff,
  processNFPMDecreaseLiquidity,
} from "../../../src/EventHandlers/NFPM/NFPMDecreaseLiquidityLogic";

describe("NFPMDecreaseLiquidityLogic", () => {
  const chainId = 10;
  const tokenId = 540n;
  const poolAddress = "0x00cd0AbB6c2964F7Dfb5169dD94A9F004C35F458";

  const mockPosition: NonFungiblePosition = {
    id: `${chainId}_${poolAddress}_${tokenId}`,
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
  };

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let mockContext: handlerContext;

  beforeEach(() => {
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
      NonFungiblePosition: {
        ...mockDb.entities.NonFungiblePosition,
        getWhere: {
          tokenId: {
            eq: async (id: bigint) => {
              return storedPositions.filter((p) => p.tokenId === id);
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
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    } as unknown as handlerContext;
  });

  describe("_calculateDecreaseLiquidityDiff", () => {
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

      const diff = _calculateDecreaseLiquidityDiff(mockEvent);

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

      const diff = _calculateDecreaseLiquidityDiff(mockEvent);

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
      expect(updatedPosition.liquidity).toBe(373020348524042n - decreaseAmount);
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

      // Position should remain unchanged
      const position = mockDb.entities.NonFungiblePosition.get(mockPosition.id);
      expect(position?.liquidity).toBe(mockPosition.liquidity);
    });
  });
});
