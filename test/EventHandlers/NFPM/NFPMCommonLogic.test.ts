import type { NonFungiblePosition, handlerContext } from "generated";
import { MockDb } from "../../../generated/src/TestHelpers.gen";
import { findPositionByTokenId } from "../../../src/EventHandlers/NFPM/NFPMCommonLogic";

describe("NFPMCommonLogic", () => {
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
    liquidity: 26679636922854n,
    mintTransactionHash:
      "0xaaa36689c538fcfee2e665f2c7b30bcf2f28ab898050252f50ec1f1d05a5392c",
    mintLogIndex: 42,
    lastUpdatedTimestamp: new Date(),
  };

  const mockPositionDifferentChain: NonFungiblePosition = {
    ...mockPosition,
    id: `8453_${poolAddress}_${tokenId}`,
    chainId: 8453, // Different chain
  };

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let mockContext: handlerContext;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();

    // Setup getWhere for tokenId queries
    const storedPositions: NonFungiblePosition[] = [];
    mockDb = {
      ...mockDb,
      entities: {
        ...mockDb.entities,
        NonFungiblePosition: {
          ...mockDb.entities.NonFungiblePosition,
          getWhere: {
            tokenId: {
              eq: async (id: bigint) => {
                return storedPositions.filter((p) => p.tokenId === id);
              },
            },
          },
        },
      },
    } as typeof mockDb;

    // Store positions in the array
    storedPositions.push(mockPosition);
    storedPositions.push(mockPositionDifferentChain);

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
      },
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    } as unknown as handlerContext;
  });

  describe("findPositionByTokenId", () => {
    it("should find position by tokenId on correct chain", async () => {
      const positions = await findPositionByTokenId(
        tokenId,
        chainId,
        mockContext,
      );

      expect(positions).toHaveLength(1);
      expect(positions[0]?.id).toBe(mockPosition.id);
      expect(positions[0]?.chainId).toBe(chainId);
    });

    it("should filter by chainId to avoid cross-chain collisions", async () => {
      const positions = await findPositionByTokenId(
        tokenId,
        8453, // Different chain
        mockContext,
      );

      expect(positions).toHaveLength(1);
      expect(positions[0]?.id).toBe(mockPositionDifferentChain.id);
      expect(positions[0]?.chainId).toBe(8453);
    });

    it("should return empty array when no position exists", async () => {
      const positions = await findPositionByTokenId(
        999n, // Non-existent tokenId
        chainId,
        mockContext,
      );

      expect(positions).toHaveLength(0);
    });

    it("should return empty array when position exists on different chain", async () => {
      const positions = await findPositionByTokenId(
        tokenId,
        1, // Chain where position doesn't exist
        mockContext,
      );

      expect(positions).toHaveLength(0);
    });
  });
});
