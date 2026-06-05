import type { Token, UserStatsPerPool } from "envio";
import { createTestIndexer } from "envio";
import { UserStatsPerPoolId, toChecksumAddress } from "../../../src/Constants";
import { rehydrateTimestamps } from "../../../src/EntityTimestamps";
import type { Pool as PoolEntity } from "../../../src/EntityTypes";
import * as PoolFeesLogic from "../../../src/EventHandlers/Pool/PoolFeesLogic";
import { setupCommon } from "./common";

describe("Pool Fees Event", () => {
  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } =
    setupCommon();
  const poolId = mockLiquidityPoolData.id;

  const chainId = 10 as const;

  let indexer: ReturnType<typeof createTestIndexer>;
  const expectations = {
    amount0In: 3n * 10n ** 18n,
    amount1In: 2n * 10n ** 6n,
    totalLiquidityUSD: 0n,
    // After issue #797: Fees no longer writes USD aggregates — they are
    // derived in processPoolSwap from trusted volume × pool fee rate. So the
    // pool's totalFeesGeneratedUSD is unchanged by a Fees event in isolation.
    totalFeesGeneratedUSD: mockLiquidityPoolData.totalFeesGeneratedUSD,
  };

  expectations.totalLiquidityUSD =
    ((mockLiquidityPoolData.reserve0 - expectations.amount0In) *
      mockToken0Data.pricePerUSDNew) /
      10n ** mockToken0Data.decimals +
    ((mockLiquidityPoolData.reserve1 - expectations.amount1In) *
      mockToken1Data.pricePerUSDNew) /
      10n ** mockToken1Data.decimals;

  let updatedPool: PoolEntity | undefined;
  let createdUserStats: UserStatsPerPool | undefined;

  beforeEach(async () => {
    indexer = createTestIndexer();
    indexer.Token.set(mockToken0Data as Token);
    indexer.Token.set(mockToken1Data as Token);
    indexer.Pool.set(mockLiquidityPoolData);

    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "Pool",
              event: "Fees",
              srcAddress: mockLiquidityPoolData.poolAddress as `0x${string}`,
              block: {
                number: 123456,
                timestamp: 1000000,
                hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
              },
              params: {
                amount0: expectations.amount0In,
                amount1: expectations.amount1In,
                sender: toChecksumAddress(
                  "0x1234567890123456789012345678901234567890",
                ),
              },
            },
          ],
        },
      },
    });

    const rawPool = await indexer.Pool.get(poolId);
    updatedPool = rawPool ? rehydrateTimestamps("Pool", rawPool) : undefined;
    createdUserStats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(
        10,
        toChecksumAddress("0x1234567890123456789012345678901234567890"),
        toChecksumAddress("0x3333333333333333333333333333333333333333"),
      ),
    );
  });

  it("should update Pool", async () => {
    expect(updatedPool).toBeDefined();
    expect(updatedPool?.lastUpdatedTimestamp).toEqual(new Date(1000000 * 1000));
  });

  it("should update Pool nominal fees", async () => {
    // For regular pools, fees are tracked as unstaked fees
    expect(updatedPool?.totalFeesGenerated0).toBe(
      mockLiquidityPoolData.totalFeesGenerated0 + expectations.amount0In,
    );
    expect(updatedPool?.totalFeesGenerated1).toBe(
      // token1 has 6 decimals; the raw fee is normalized to a 1e18 base (#812)
      mockLiquidityPoolData.totalFeesGenerated1 +
        expectations.amount1In * 10n ** 12n,
    );
  });

  it("should update Pool total fees in USD", async () => {
    expect(updatedPool?.totalFeesGeneratedUSD).toBe(
      expectations.totalFeesGeneratedUSD,
    );
  });

  it("should create a new UserStatsPerPool entity", async () => {
    expect(createdUserStats).toBeDefined();
    expect(createdUserStats?.id).toBe(
      UserStatsPerPoolId(
        10,
        toChecksumAddress("0x1234567890123456789012345678901234567890"),
        toChecksumAddress("0x3333333333333333333333333333333333333333"),
      ),
    );
    expect(createdUserStats?.userAddress).toBe(
      toChecksumAddress("0x1234567890123456789012345678901234567890"),
    );
    expect(createdUserStats?.poolAddress).toBe(
      toChecksumAddress("0x3333333333333333333333333333333333333333"),
    );
    expect(createdUserStats?.chainId).toBe(10);
    expect(createdUserStats?.numberOfSwaps).toBe(0n);
    expect(createdUserStats?.totalSwapVolumeUSD).toBe(0n);
  });

  it("should update UserStatsPerPool entity with fee contributions", async () => {
    expect(createdUserStats?.totalFeesContributed0).toBe(
      expectations.amount0In,
    );
    expect(createdUserStats?.totalFeesContributed1).toBe(
      // token1 (6 decimals) raw fee normalized to a 1e18 base (#812)
      expectations.amount1In * 10n ** 12n,
    );

    // Per issue #797: Fees no longer writes USD — user fee USD stays at the
    // baseline 0n until a Swap on the same pool drives it.
    expect(createdUserStats?.totalFeesContributedUSD).toBe(0n);
  });

  it("should set correct timestamps for UserStatsPerPool entity", async () => {
    const rawStats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(
        10,
        toChecksumAddress("0x1234567890123456789012345678901234567890"),
        toChecksumAddress("0x3333333333333333333333333333333333333333"),
      ),
    );
    const stats = rawStats
      ? rehydrateTimestamps("UserStatsPerPool", rawStats)
      : undefined;
    expect(stats?.firstActivityTimestamp).toEqual(new Date(1000000 * 1000));
    expect(stats?.lastActivityTimestamp).toEqual(new Date(1000000 * 1000));
  });

  it("should handle existing user correctly", async () => {
    // Create an existing user stats
    const { createMockUserStatsPerPool } = setupCommon();
    const existingUserStats = createMockUserStatsPerPool({
      userAddress: toChecksumAddress(
        "0x1234567890123456789012345678901234567890",
      ),
      poolAddress: toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      ),
      chainId: 10,
      totalLiquidityAddedUSD: 2000n,
      totalFeesContributedUSD: 2000n,
      totalFeesContributed0: 1000n,
      totalFeesContributed1: 800n,
      numberOfSwaps: 5n,
      totalSwapVolumeUSD: 10000n,
      firstActivityTimestamp: new Date(500000 * 1000),
      lastActivityTimestamp: new Date(800000 * 1000),
    });

    // Use a fresh indexer seeded with pool, tokens, and existing user stats
    const existingUserIndexer = createTestIndexer();
    existingUserIndexer.Token.set(mockToken0Data as Token);
    existingUserIndexer.Token.set(mockToken1Data as Token);
    existingUserIndexer.Pool.set(mockLiquidityPoolData);
    existingUserIndexer.UserStatsPerPool.set(existingUserStats);

    await existingUserIndexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "Pool",
              event: "Fees",
              srcAddress: mockLiquidityPoolData.poolAddress as `0x${string}`,
              block: {
                number: 123457,
                timestamp: 2000000,
                hash: "0x1234567890123456789012345678901234567890123456789012345678901235",
              },
              params: {
                amount0: 500n,
                amount1: 300n,
                sender: toChecksumAddress(
                  "0x1234567890123456789012345678901234567890",
                ),
              },
            },
          ],
        },
      },
    });

    const rawUserStats = await existingUserIndexer.UserStatsPerPool.get(
      UserStatsPerPoolId(
        10,
        toChecksumAddress("0x1234567890123456789012345678901234567890"),
        toChecksumAddress("0x3333333333333333333333333333333333333333"),
      ),
    );
    const updatedUserStats = rawUserStats
      ? rehydrateTimestamps("UserStatsPerPool", rawUserStats)
      : undefined;

    expect(updatedUserStats).toBeDefined();
    expect(updatedUserStats?.totalFeesContributed0).toBe(
      existingUserStats.totalFeesContributed0 + 500n,
    );
    expect(updatedUserStats?.totalFeesContributed1).toBe(
      // token1 (6 decimals): 300 raw → 300 * 1e12 on a 1e18 base (#812)
      existingUserStats.totalFeesContributed1 + 300n * 10n ** 12n,
    );
    expect(updatedUserStats?.numberOfSwaps).toBe(
      existingUserStats.numberOfSwaps,
    );
    expect(updatedUserStats?.totalSwapVolumeUSD).toBe(
      existingUserStats.totalSwapVolumeUSD,
    );
    expect(updatedUserStats?.firstActivityTimestamp).toEqual(
      existingUserStats.firstActivityTimestamp,
    );
    expect(updatedUserStats?.lastActivityTimestamp).toEqual(
      new Date(2000000 * 1000),
    );
  });

  // #814: fee contributions are the fee-leg of a swap and must accrue to the
  // transaction signer (the user), not params.sender (the router for routed
  // swaps). `from` is lower-cased to also prove it is checksummed before keying.
  describe("attribution target (#814)", () => {
    const router = toChecksumAddress(
      "0x1234567890123456789012345678901234567890",
    );
    const userLower = "0xaaaabbbbccccddddeeeeffff0000111122223333";
    const userChecksummed = toChecksumAddress(userLower);
    const poolAddress = toChecksumAddress(
      "0x3333333333333333333333333333333333333333",
    );

    let attributed: UserStatsPerPool | undefined;
    let routerRow: UserStatsPerPool | undefined;

    beforeEach(async () => {
      const feesIndexer = createTestIndexer();
      feesIndexer.Token.set(mockToken0Data as Token);
      feesIndexer.Token.set(mockToken1Data as Token);
      feesIndexer.Pool.set(mockLiquidityPoolData);

      await feesIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Fees",
                srcAddress: mockLiquidityPoolData.poolAddress as `0x${string}`,
                block: {
                  number: 123456,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                transaction: { from: userLower },
                params: {
                  amount0: expectations.amount0In,
                  amount1: expectations.amount1In,
                  sender: router,
                },
              },
            ],
          },
        },
      });

      attributed = await feesIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(10, userChecksummed, poolAddress),
      );
      routerRow = await feesIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(10, router, poolAddress),
      );
    });

    it("attributes fee contributions to tx.from (the user)", () => {
      expect(attributed).toBeDefined();
      expect(attributed?.totalFeesContributed0).toBe(expectations.amount0In);
      expect(attributed?.totalFeesContributed1).toBe(
        // token1 (6 decimals) raw fee normalized to a 1e18 base (#812)
        expectations.amount1In * 10n ** 12n,
      );
    });

    it("does not attribute fee contributions to params.sender (the router)", () => {
      expect(routerRow).toBeUndefined();
    });
  });

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      // Create a fresh indexer without the pool
      const freshIndexer = createTestIndexer();
      freshIndexer.Token.set(mockToken0Data as Token);
      freshIndexer.Token.set(mockToken1Data as Token);
      // Note: We intentionally don't set the Pool

      await freshIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Fees",
                srcAddress: mockLiquidityPoolData.poolAddress as `0x${string}`,
                block: {
                  number: 123456,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  amount0: 3n * 10n ** 18n,
                  amount1: 2n * 10n ** 6n,
                  sender: toChecksumAddress(
                    "0x1234567890123456789012345678901234567890",
                  ),
                },
              },
            ],
          },
        },
      });

      // Pool should not exist
      const pool = await freshIndexer.Pool.get(poolId);
      expect(pool).toBeUndefined();

      // User stats will still be created because loadOrCreateUserData is called in parallel
      // but they should have default/zero values since no fees processing occurred
      const userStats = await freshIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(
          10,
          toChecksumAddress("0x1234567890123456789012345678901234567890"),
          toChecksumAddress("0x3333333333333333333333333333333333333333"),
        ),
      );
      expect(userStats).toBeDefined();
      // Verify no fee activity was recorded
      expect(userStats?.totalFeesContributed0).toBe(0n);
      expect(userStats?.totalFeesContributed1).toBe(0n);
      expect(userStats?.totalFeesContributedUSD).toBe(0n);
    });
  });
});
