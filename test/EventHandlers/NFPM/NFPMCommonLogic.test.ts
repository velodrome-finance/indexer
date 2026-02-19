import type { NonFungiblePosition, handlerContext } from "generated";
import { MockDb } from "../../../generated/src/TestHelpers.gen";
import type { PoolData } from "../../../src/Aggregators/LiquidityPoolAggregator";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../../src/Aggregators/UserStatsPerPool";
import { NonFungiblePositionId } from "../../../src/Constants";
import {
  LiquidityChangeType,
  attributeLiquidityChangeToUserStatsPerPool,
  findPositionByTokenId,
} from "../../../src/EventHandlers/NFPM/NFPMCommonLogic";
import { calculateTotalUSD } from "../../../src/Helpers";
import { setupCommon } from "../Pool/common";

jest.mock("../../../src/Aggregators/LiquidityPoolAggregator");
jest.mock("../../../src/Aggregators/UserStatsPerPool");
jest.mock("../../../src/Helpers");

describe("NFPMCommonLogic", () => {
  const chainId = 10;
  const tokenId = 540n;
  const poolAddress = "0x00cd0AbB6c2964F7Dfb5169dD94A9F004C35F458";

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
    liquidity: 26679636922854n,
    mintTransactionHash:
      "0xaaa36689c538fcfee2e665f2c7b30bcf2f28ab898050252f50ec1f1d05a5392c",
    mintLogIndex: 42,
    lastUpdatedTimestamp: new Date(),
    lastSnapshotTimestamp: undefined,
  };

  const mockPositionDifferentChain: NonFungiblePosition = {
    ...mockPosition,
    id: NonFungiblePositionId(8453, poolAddress, tokenId),
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

  describe("attributeLiquidityChangeToUserStatsPerPool", () => {
    const { createMockUserStatsPerPool, mockToken0Data, mockToken1Data } =
      setupCommon();

    const owner = "0x1DFAb7699121fEF702d07932a447868dCcCFb029";
    const amount0 = 18500000000n;
    const amount1 = 15171806313n;
    const blockTimestamp = 1712065791;
    const totalLiquidityUSD = 5000000000000000000n; // 5e18

    const mockUserData = createMockUserStatsPerPool({
      userAddress: owner,
      poolAddress,
      chainId,
    });

    const mockPoolData: PoolData = {
      token0Instance: mockToken0Data,
      token1Instance: mockToken1Data,
      liquidityPoolAggregator: {
        chainId,
      } as PoolData["liquidityPoolAggregator"],
    };

    beforeEach(() => {
      jest.mocked(loadOrCreateUserData).mockReset();
      jest.mocked(updateUserStatsPerPool).mockReset();
      jest.mocked(calculateTotalUSD).mockReset();

      jest.mocked(loadOrCreateUserData).mockResolvedValue(mockUserData);
      jest.mocked(calculateTotalUSD).mockReturnValue(totalLiquidityUSD);
    });

    it("should call updateUserStatsPerPool with add diff when kind is ADD", async () => {
      await attributeLiquidityChangeToUserStatsPerPool(
        owner,
        poolAddress,
        mockPoolData,
        mockContext,
        amount0,
        amount1,
        blockTimestamp,
        LiquidityChangeType.ADD,
      );

      expect(calculateTotalUSD).toHaveBeenCalledWith(
        amount0,
        amount1,
        mockToken0Data,
        mockToken1Data,
      );
      const expectedTimestamp = new Date(blockTimestamp * 1000);
      expect(loadOrCreateUserData).toHaveBeenCalledWith(
        owner,
        poolAddress,
        chainId,
        mockContext,
        expectedTimestamp,
      );
      expect(updateUserStatsPerPool).toHaveBeenCalledTimes(1);
      const [diff] = jest.mocked(updateUserStatsPerPool).mock.calls[0];
      expect(diff).toMatchObject({
        incrementalTotalLiquidityAddedUSD: totalLiquidityUSD,
        incrementalTotalLiquidityAddedToken0: amount0,
        incrementalTotalLiquidityAddedToken1: amount1,
        lastActivityTimestamp: expectedTimestamp,
      });
    });

    it("should call updateUserStatsPerPool with remove diff when kind is REMOVE", async () => {
      await attributeLiquidityChangeToUserStatsPerPool(
        owner,
        poolAddress,
        mockPoolData,
        mockContext,
        amount0,
        amount1,
        blockTimestamp,
        LiquidityChangeType.REMOVE,
      );
      expect(calculateTotalUSD).toHaveBeenCalledWith(
        amount0,
        amount1,
        mockToken0Data,
        mockToken1Data,
      );
      const expectedTimestamp = new Date(blockTimestamp * 1000);
      expect(loadOrCreateUserData).toHaveBeenCalledWith(
        owner,
        poolAddress,
        chainId,
        mockContext,
        expectedTimestamp,
      );

      expect(updateUserStatsPerPool).toHaveBeenCalledTimes(1);
      const [diff] = jest.mocked(updateUserStatsPerPool).mock.calls[0];
      expect(diff).toMatchObject({
        incrementalTotalLiquidityRemovedUSD: totalLiquidityUSD,
        incrementalTotalLiquidityRemovedToken0: amount0,
        incrementalTotalLiquidityRemovedToken1: amount1,
        lastActivityTimestamp: expectedTimestamp,
      });
    });
  });
});
