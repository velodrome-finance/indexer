import { TickMath } from "@uniswap/v3-sdk";
import type { handlerContext } from "generated";
import {
  createUserStatsPerPoolEntity,
  updateUserStatsPerPool,
} from "../../src/Aggregators/UserStatsPerPool";
import {
  NonFungiblePositionId,
  PoolId,
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  TokenId,
  toChecksumAddress,
} from "../../src/Constants";
import { setupCommon } from "../EventHandlers/Pool/common";

/**
 * Phase 2 tests: Verify that snapshot-time CL staked USD is computed
 * by iterating stakedCLPositionTokenIds with direct get() lookups
 * instead of using getWhere scans.
 */
describe("UserStatsPerPool CL snapshot USD via direct gets", () => {
  let common: ReturnType<typeof setupCommon>;

  const mockChainId = 10;
  const mockPoolAddress = toChecksumAddress(
    "0xabcdef1234567890abcdef1234567890abcdef12",
  );
  const mockUserAddress = toChecksumAddress(
    "0x1234567890123456789012345678901234567890",
  );
  const poolId = PoolId(mockChainId, mockPoolAddress);

  // Use a sqrtPriceX96 at tick 0 (price = 1)
  const sqrtPriceX96AtTick0 = BigInt(TickMath.getSqrtRatioAtTick(0).toString());

  // First call: never snapshotted → triggers snapshot.
  // Second call: new epoch → triggers snapshot.
  const epoch1Timestamp = new Date(1000000 * 1000); // epoch 1
  const epoch2Timestamp = new Date(1004000 * 1000); // epoch 2 (>1h later)

  beforeEach(() => {
    common = setupCommon();
  });

  function buildMockContext(opts: {
    positions?: Array<{
      tokenId: bigint;
      liquidity: bigint;
      tickLower: bigint;
      tickUpper: bigint;
    }>;
    isCL?: boolean;
  }) {
    const isCL = opts.isCL ?? true;
    const poolEntity = common.createMockLiquidityPoolAggregator({
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      isCL,
      sqrtPriceX96: sqrtPriceX96AtTick0,
      tick: 0n,
    });
    const token0 = common.mockToken0Data;
    const token1 = common.mockToken1Data;

    // Build position lookup map for direct get()
    const positionMap = new Map<
      string,
      ReturnType<typeof common.createMockNonFungiblePosition>
    >();
    for (const pos of opts.positions ?? []) {
      const nfp = common.createMockNonFungiblePosition({
        chainId: mockChainId,
        pool: mockPoolAddress,
        tokenId: pos.tokenId,
        owner: mockUserAddress,
        liquidity: pos.liquidity,
        tickLower: pos.tickLower,
        tickUpper: pos.tickUpper,
        isStakedInGauge: true,
      });
      positionMap.set(nfp.id, nfp);
    }

    return common.createMockContext({
      UserStatsPerPool: { set: async () => {} },
      UserStatsPerPoolSnapshot: { set: vi.fn() },
      LiquidityPoolAggregator: {
        get: async (id: string) => (id === poolId ? poolEntity : undefined),
      },
      Token: {
        get: async (id: string) => {
          if (id === token0.id) return token0;
          if (id === token1.id) return token1;
          return undefined;
        },
      },
      NonFungiblePosition: {
        get: async (id: string) => positionMap.get(id) ?? undefined,
        // getWhere should NOT be called — that's the whole point of this optimization
        getWhere: async () => {
          throw new Error(
            "getWhere should NOT be called — direct get() should be used instead",
          );
        },
      },
      log: { error: () => {}, warn: () => {}, info: () => {} },
    });
  }

  it("should return 0n for empty stakedCLPositionTokenIds", async () => {
    const ctx = buildMockContext({ positions: [] });
    const userStats = common.createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      currentLiquidityStaked: 0n,
      stakedCLPositionTokenIds: [],
      firstActivityTimestamp: epoch1Timestamp,
      lastActivityTimestamp: epoch1Timestamp,
    });

    const result = await updateUserStatsPerPool(
      { lastActivityTimestamp: epoch2Timestamp },
      userStats,
      ctx,
      epoch2Timestamp,
    );

    expect(result.currentLiquidityStakedUSD).toBe(0n);
  });

  it("should compute USD for a single staked position via direct get", async () => {
    const ctx = buildMockContext({
      positions: [
        {
          tokenId: 42n,
          liquidity: 1000000n, // L
          tickLower: -1000n,
          tickUpper: 1000n,
        },
      ],
    });
    const userStats = common.createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      currentLiquidityStaked: 1000000n,
      stakedCLPositionTokenIds: [42n],
      firstActivityTimestamp: epoch1Timestamp,
      lastActivityTimestamp: epoch1Timestamp,
    });

    const result = await updateUserStatsPerPool(
      { lastActivityTimestamp: epoch2Timestamp },
      userStats,
      ctx,
      epoch2Timestamp,
    );

    // Should be > 0 (exact value depends on CL math but definitely non-zero for in-range position)
    expect(result.currentLiquidityStakedUSD).toBeGreaterThan(0n);
  });

  it("should sum USD across multiple staked positions", async () => {
    const ctx = buildMockContext({
      positions: [
        {
          tokenId: 42n,
          liquidity: 1000000n,
          tickLower: -1000n,
          tickUpper: 1000n,
        },
        {
          tokenId: 99n,
          liquidity: 2000000n,
          tickLower: -500n,
          tickUpper: 500n,
        },
      ],
    });
    const userStats = common.createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      currentLiquidityStaked: 3000000n,
      stakedCLPositionTokenIds: [42n, 99n],
      firstActivityTimestamp: epoch1Timestamp,
      lastActivityTimestamp: epoch1Timestamp,
    });

    // First, compute single-position USD for reference
    const ctxSingle = buildMockContext({
      positions: [
        {
          tokenId: 42n,
          liquidity: 1000000n,
          tickLower: -1000n,
          tickUpper: 1000n,
        },
      ],
    });
    const singleStats = common.createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      currentLiquidityStaked: 1000000n,
      stakedCLPositionTokenIds: [42n],
      firstActivityTimestamp: epoch1Timestamp,
      lastActivityTimestamp: epoch1Timestamp,
    });
    const singleResult = await updateUserStatsPerPool(
      { lastActivityTimestamp: epoch2Timestamp },
      singleStats,
      ctxSingle,
      epoch2Timestamp,
    );

    const result = await updateUserStatsPerPool(
      { lastActivityTimestamp: epoch2Timestamp },
      userStats,
      ctx,
      epoch2Timestamp,
    );

    // Multi should be greater than single (2x liquidity in tighter range = more USD)
    expect(result.currentLiquidityStakedUSD).toBeGreaterThan(
      singleResult.currentLiquidityStakedUSD,
    );
  });

  it("should skip missing position entities gracefully", async () => {
    // Position 42 exists but position 99 doesn't
    const ctx = buildMockContext({
      positions: [
        {
          tokenId: 42n,
          liquidity: 1000000n,
          tickLower: -1000n,
          tickUpper: 1000n,
        },
      ],
    });
    const userStats = common.createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      currentLiquidityStaked: 1000000n,
      stakedCLPositionTokenIds: [42n, 99n], // 99 doesn't exist
      firstActivityTimestamp: epoch1Timestamp,
      lastActivityTimestamp: epoch1Timestamp,
    });

    const result = await updateUserStatsPerPool(
      { lastActivityTimestamp: epoch2Timestamp },
      userStats,
      ctx,
      epoch2Timestamp,
    );

    // Should still compute USD for position 42 (> 0), just skip 99
    expect(result.currentLiquidityStakedUSD).toBeGreaterThan(0n);
  });

  it("should NOT call getWhere during snapshot computation", async () => {
    // The mock getWhere throws — if it's called, the test will fail
    const ctx = buildMockContext({
      positions: [
        {
          tokenId: 42n,
          liquidity: 1000000n,
          tickLower: -1000n,
          tickUpper: 1000n,
        },
      ],
    });
    const userStats = common.createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      currentLiquidityStaked: 1000000n,
      stakedCLPositionTokenIds: [42n],
      firstActivityTimestamp: epoch1Timestamp,
      lastActivityTimestamp: epoch1Timestamp,
    });

    // This should NOT throw — getWhere is not called
    await expect(
      updateUserStatsPerPool(
        { lastActivityTimestamp: epoch2Timestamp },
        userStats,
        ctx,
        epoch2Timestamp,
      ),
    ).resolves.toBeDefined();
  });

  it("should propagate computed USD to snapshot", async () => {
    const ctx = buildMockContext({
      positions: [
        {
          tokenId: 42n,
          liquidity: 1000000n,
          tickLower: -1000n,
          tickUpper: 1000n,
        },
      ],
    });
    const userStats = common.createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      currentLiquidityStaked: 1000000n,
      stakedCLPositionTokenIds: [42n],
      firstActivityTimestamp: epoch1Timestamp,
      lastActivityTimestamp: epoch1Timestamp,
    });

    await updateUserStatsPerPool(
      { lastActivityTimestamp: epoch2Timestamp },
      userStats,
      ctx,
      epoch2Timestamp,
    );

    expect(ctx.UserStatsPerPoolSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        currentLiquidityStakedUSD: expect.any(BigInt),
        stakedCLPositionTokenIds: [42n],
      }),
    );
    // Verify the snapshot USD is > 0
    const snapshotCall = (
      ctx.UserStatsPerPoolSnapshot.set as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(snapshotCall.currentLiquidityStakedUSD).toBeGreaterThan(0n);
  });
});
