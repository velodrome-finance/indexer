import { TickMath } from "@uniswap/v3-sdk";
import type { NonFungiblePosition, handlerContext } from "generated";
import { MockDb } from "../../../generated/src/TestHelpers.gen";
import {
  applyStakedPositionToEdges,
  isPositionInRange,
  updateTicksForStakedPosition,
} from "../../../src/Aggregators/CLStakedLiquidity";
import {
  type PoolData,
  updateLiquidityPoolAggregator,
} from "../../../src/Aggregators/LiquidityPoolAggregator";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../../src/Aggregators/UserStatsPerPool";
import {
  NonFungiblePositionId,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  LiquidityChangeType,
  attributeLiquidityChangeToUserStatsPerPool,
  updateStakedPositionLiquidity,
} from "../../../src/EventHandlers/NFPM/NFPMCommonLogic";
import {
  calculatePositionAmountsFromLiquidity,
  calculateTotalUSD,
} from "../../../src/Helpers";
import { defaultNfpmAddress, setupCommon } from "../Pool/common";

vi.mock("../../../src/Aggregators/CLStakedLiquidity");
vi.mock("../../../src/Aggregators/LiquidityPoolAggregator");
vi.mock("../../../src/Aggregators/UserStatsPerPool");
vi.mock("../../../src/Helpers");

describe("NFPMCommonLogic", () => {
  const chainId = 10;
  const tokenId = 540n;
  const poolAddress = toChecksumAddress(
    "0x00cd0AbB6c2964F7Dfb5169dD94A9F004C35F458",
  );
  const nfpmAddressA = defaultNfpmAddress;
  const nfpmAddressB = toChecksumAddress(
    "0x416b433906b1B72FA758e166e239c43d68dC6F29",
  );
  const poolAddressB = toChecksumAddress(
    "0x00cd0AbB6c2964F7Dfb5169dD94A9F004C35F459",
  );

  const mockPosition: NonFungiblePosition = {
    id: NonFungiblePositionId(chainId, nfpmAddressA, tokenId),
    chainId: chainId,
    tokenId: tokenId,
    owner: toChecksumAddress("0x1DFAb7699121fEF702d07932a447868dCcCFb029"),
    pool: poolAddress,
    nfpmAddress: nfpmAddressA,
    tickUpper: 0n,
    tickLower: -4n,
    token0: toChecksumAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"),
    token1: toChecksumAddress("0x7F5c764cBc14f9669B88837ca1490cCa17c31607"),
    liquidity: 26679636922854n,
    mintTransactionHash:
      "0xaaa36689c538fcfee2e665f2c7b30bcf2f28ab898050252f50ec1f1d05a5392c",
    mintLogIndex: 42,
    lastUpdatedTimestamp: new Date(),
    lastSnapshotTimestamp: undefined,
    isStakedInGauge: false,
  };

  const mockPositionDifferentChain: NonFungiblePosition = {
    ...mockPosition,
    id: NonFungiblePositionId(8453, nfpmAddressA, tokenId),
    chainId: 8453, // Different chain
  };

  // Same chain (chainId=10) and same tokenId as mockPosition, but different NFPM and pool.
  // Reproduces the intra-chain multi-NFPM collision: Optimism has two NFPM contracts,
  // each with its own tokenId counter, so tokenId 540 can exist on both.
  const mockPositionSameTokenDifferentNfpm: NonFungiblePosition = {
    ...mockPosition,
    id: NonFungiblePositionId(chainId, nfpmAddressB, tokenId),
    pool: poolAddressB,
    nfpmAddress: nfpmAddressB,
  };

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let mockContext: handlerContext;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();

    const storedPositions: NonFungiblePosition[] = [
      mockPosition,
      mockPositionDifferentChain,
      mockPositionSameTokenDifferentNfpm,
    ];

    const getWhereNonFungiblePosition = vi
      .fn()
      .mockImplementation((filter: { tokenId?: { _eq?: bigint } }) => {
        const id = filter?.tokenId?._eq;
        if (id === undefined) return Promise.resolve(storedPositions);
        return Promise.resolve(storedPositions.filter((p) => p.tokenId === id));
      });

    mockContext = {
      ...mockDb,
      NonFungiblePosition: {
        ...mockDb.entities.NonFungiblePosition,
        getWhere: getWhereNonFungiblePosition,
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
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as handlerContext;
  });

  // Regression for #621: the new stable ID for NonFungiblePosition is
  // {chainId}-{nfpmAddress}-{tokenId}, so two positions that share (chainId, tokenId)
  // under different NFPMs live as distinct entities instead of silently overwriting
  // each other (as they would have with the old {chainId}-{poolAddress}-{tokenId} key
  // when both factories/NFPMs happened to mint into the same pool).
  describe("NonFungiblePositionId identity", () => {
    it("produces distinct IDs for two positions sharing (chainId, tokenId) under different NFPMs", () => {
      expect(mockPosition.id).not.toBe(mockPositionSameTokenDifferentNfpm.id);
      expect(mockPosition.chainId).toBe(
        mockPositionSameTokenDifferentNfpm.chainId,
      );
      expect(mockPosition.tokenId).toBe(
        mockPositionSameTokenDifferentNfpm.tokenId,
      );
    });
  });

  describe("attributeLiquidityChangeToUserStatsPerPool", () => {
    const { createMockUserStatsPerPool, mockToken0Data, mockToken1Data } =
      setupCommon();

    const owner = toChecksumAddress(
      "0x1DFAb7699121fEF702d07932a447868dCcCFb029",
    );
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
      vi.mocked(loadOrCreateUserData).mockReset();
      vi.mocked(updateUserStatsPerPool).mockReset();
      vi.mocked(calculateTotalUSD).mockReset();
      vi.mocked(loadOrCreateUserData).mockResolvedValue(mockUserData);
      vi.mocked(calculateTotalUSD).mockReturnValue(totalLiquidityUSD);
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
      const [diff] = vi.mocked(updateUserStatsPerPool).mock.calls[0];
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
      const [diff] = vi.mocked(updateUserStatsPerPool).mock.calls[0];
      expect(diff).toMatchObject({
        incrementalTotalLiquidityRemovedUSD: totalLiquidityUSD,
        incrementalTotalLiquidityRemovedToken0: amount0,
        incrementalTotalLiquidityRemovedToken1: amount1,
        lastActivityTimestamp: expectedTimestamp,
      });
    });
  });

  describe("updateStakedPositionLiquidity", () => {
    const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
      setupCommon();

    const stakedPosition: NonFungiblePosition = {
      ...mockPosition,
      tickLower: -200n,
      tickUpper: 200n,
      liquidity: 5000n,
      isStakedInGauge: true,
    };

    const sqrtPriceX96AtTick0 = BigInt(
      TickMath.getSqrtRatioAtTick(0).toString(),
    );

    const poolData: PoolData = {
      token0Instance: mockToken0Data,
      token1Instance: mockToken1Data,
      liquidityPoolAggregator: {
        ...mockLiquidityPoolData,
        isCL: true,
        tick: 0n, // Position [-200, 200] is in range
        sqrtPriceX96: sqrtPriceX96AtTick0,
        stakedLiquidityInRange: 1000n,
      },
    };

    const timestamp = new Date(1000000 * 1000);
    const blockNumber = 123456;

    beforeEach(() => {
      vi.mocked(updateTicksForStakedPosition).mockReset();
      vi.mocked(updateTicksForStakedPosition).mockResolvedValue(undefined);
      vi.mocked(isPositionInRange).mockReset();
      vi.mocked(updateLiquidityPoolAggregator).mockReset();
      vi.mocked(updateLiquidityPoolAggregator).mockResolvedValue(undefined);
      vi.mocked(calculatePositionAmountsFromLiquidity).mockReset();
      vi.mocked(calculatePositionAmountsFromLiquidity).mockReturnValue({
        amount0: 100n,
        amount1: 200n,
      });
      // applyStakedPositionToEdges is auto-mocked by vi.mock above; return a
      // valid shape so NFPMCommonLogic's destructure doesn't trip.
      vi.mocked(applyStakedPositionToEdges).mockReset();
      vi.mocked(applyStakedPositionToEdges).mockReturnValue({
        edges: [-200n, 200n],
        nets: [5000n, -5000n],
      });
    });

    it("should always update tick entities regardless of in-range status", async () => {
      vi.mocked(isPositionInRange).mockReturnValue(false);

      await updateStakedPositionLiquidity(
        stakedPosition,
        poolData,
        5000n,
        mockContext,
        timestamp,
        chainId,
        blockNumber,
      );

      expect(updateTicksForStakedPosition).toHaveBeenCalledWith(
        chainId,
        stakedPosition.pool,
        stakedPosition.tickLower,
        stakedPosition.tickUpper,
        5000n,
        mockContext,
      );
    });

    it("should update total staked reserves and stakedLiquidityInRange when position is in range", async () => {
      vi.mocked(isPositionInRange).mockReturnValue(true);

      await updateStakedPositionLiquidity(
        stakedPosition,
        poolData,
        5000n, // positive = increase
        mockContext,
        timestamp,
        chainId,
        blockNumber,
      );

      expect(isPositionInRange).toHaveBeenCalledWith(-200n, 200n, 0n);
      expect(calculatePositionAmountsFromLiquidity).toHaveBeenCalledWith(
        5000n,
        sqrtPriceX96AtTick0,
        -200n,
        200n,
      );
      expect(updateLiquidityPoolAggregator).toHaveBeenCalledWith(
        {
          stakedLiquidityInRange: 6000n, // 1000 + 5000
          incrementalStakedReserve0: 100n, // direction=+1 * 100
          incrementalStakedReserve1: 200n, // direction=+1 * 200
          stakedTickEdges: [-200n, 200n],
          stakedTickEdgeNets: [5000n, -5000n],
          hasStakes: true, // belt-and-suspenders: NFPM path also flips the latch when edges are non-empty
        },
        poolData.liquidityPoolAggregator,
        timestamp,
        mockContext,
        chainId,
        blockNumber,
      );
    });

    it("should use negative direction for decrease (negative liquidityDelta)", async () => {
      vi.mocked(isPositionInRange).mockReturnValue(true);

      await updateStakedPositionLiquidity(
        stakedPosition,
        poolData,
        -3000n, // negative = decrease
        mockContext,
        timestamp,
        chainId,
        blockNumber,
      );

      // abs(-3000) = 3000 passed to calculatePositionAmountsFromLiquidity
      expect(calculatePositionAmountsFromLiquidity).toHaveBeenCalledWith(
        3000n,
        sqrtPriceX96AtTick0,
        -200n,
        200n,
      );
      expect(updateLiquidityPoolAggregator).toHaveBeenCalledWith(
        {
          stakedLiquidityInRange: -2000n, // 1000 + (-3000)
          incrementalStakedReserve0: -100n, // direction=-1 * 100
          incrementalStakedReserve1: -200n, // direction=-1 * 200
          stakedTickEdges: [-200n, 200n],
          stakedTickEdgeNets: [5000n, -5000n],
          hasStakes: true,
        },
        poolData.liquidityPoolAggregator,
        timestamp,
        mockContext,
        chainId,
        blockNumber,
      );
    });

    it("should update total staked reserves but not stakedLiquidityInRange when position is out of range", async () => {
      vi.mocked(isPositionInRange).mockReturnValue(false);

      await updateStakedPositionLiquidity(
        stakedPosition,
        poolData,
        5000n,
        mockContext,
        timestamp,
        chainId,
        blockNumber,
      );

      expect(updateTicksForStakedPosition).toHaveBeenCalled();
      expect(calculatePositionAmountsFromLiquidity).toHaveBeenCalledWith(
        5000n,
        sqrtPriceX96AtTick0,
        -200n,
        200n,
      );
      expect(updateLiquidityPoolAggregator).toHaveBeenCalledWith(
        {
          stakedLiquidityInRange: undefined, // not in range, so unchanged
          incrementalStakedReserve0: 100n,
          incrementalStakedReserve1: 200n,
          stakedTickEdges: [-200n, 200n],
          stakedTickEdgeNets: [5000n, -5000n],
          hasStakes: true,
        },
        poolData.liquidityPoolAggregator,
        timestamp,
        mockContext,
        chainId,
        blockNumber,
      );
    });

    it("should persist edge-list updates even when sqrtPriceX96 is zero", async () => {
      vi.mocked(isPositionInRange).mockReturnValue(true);

      const poolDataZeroPrice: PoolData = {
        ...poolData,
        liquidityPoolAggregator: {
          ...poolData.liquidityPoolAggregator,
          sqrtPriceX96: 0n,
        },
      };

      await updateStakedPositionLiquidity(
        stakedPosition,
        poolDataZeroPrice,
        5000n,
        mockContext,
        timestamp,
        chainId,
        blockNumber,
      );

      expect(updateTicksForStakedPosition).toHaveBeenCalled();
      // Reserve math is skipped (no sqrtPriceX96 to split into token0/token1),
      // but we still persist the edge-list update so the swap path has correct
      // state once the pool is initialized.
      expect(updateLiquidityPoolAggregator).toHaveBeenCalledWith(
        {
          stakedTickEdges: [-200n, 200n],
          stakedTickEdgeNets: [5000n, -5000n],
          hasStakes: true,
        },
        poolDataZeroPrice.liquidityPoolAggregator,
        timestamp,
        mockContext,
        chainId,
        blockNumber,
      );
    });
  });
});
