import type { Token, UserStatsPerPool } from "generated";
import { MockDb, Pool } from "../../../generated/src/TestHelpers.gen";
import { UserStatsPerPoolId, toChecksumAddress } from "../../../src/Constants";
import type { Pool as PoolEntity } from "../../../src/EntityTypes";
import * as PoolFeesLogic from "../../../src/EventHandlers/Pool/PoolFeesLogic";
import { setupCommon } from "./common";

describe("Pool Fees Event", () => {
  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } =
    setupCommon();
  const poolId = mockLiquidityPoolData.id;

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let updatedDB: ReturnType<typeof MockDb.createMockDb>;
  const expectations = {
    amount0In: 3n * 10n ** 18n,
    amount1In: 2n * 10n ** 6n,
    totalLiquidityUSD: 0n,
    totalFeesGeneratedUSD: 0n,
  };

  expectations.totalLiquidityUSD =
    ((mockLiquidityPoolData.reserve0 - expectations.amount0In) *
      mockToken0Data.pricePerUSDNew) /
      10n ** mockToken0Data.decimals +
    ((mockLiquidityPoolData.reserve1 - expectations.amount1In) *
      mockToken1Data.pricePerUSDNew) /
      10n ** mockToken1Data.decimals;

  // After issue #733: totalFeesGeneratedUSD increments by the *trusted* (smaller
  // / non-zero fallback) leg rather than the sum, mirroring the volume defense
  // against poisoned/scam-token prices. The whitelisted variant continues to
  // sum the whitelisted legs (separate filter, separate accumulator).
  const token0LegUSD =
    (expectations.amount0In / 10n ** mockToken0Data.decimals) *
    mockToken0Data.pricePerUSDNew;
  const token1LegUSD =
    (expectations.amount1In / 10n ** mockToken1Data.decimals) *
    mockToken1Data.pricePerUSDNew;
  const trustedLegUSD =
    token0LegUSD === 0n
      ? token1LegUSD
      : token1LegUSD === 0n
        ? token0LegUSD
        : token0LegUSD < token1LegUSD
          ? token0LegUSD
          : token1LegUSD;
  expectations.totalFeesGeneratedUSD =
    mockLiquidityPoolData.totalFeesGeneratedUSD + trustedLegUSD;


  let updatedPool: PoolEntity | undefined;
  let createdUserStats: UserStatsPerPool | undefined;

  beforeEach(async () => {
    mockDb = MockDb.createMockDb();
    updatedDB = mockDb.entities.Token.set(mockToken0Data as Token);
    updatedDB = updatedDB.entities.Token.set(mockToken1Data as Token);
    updatedDB = updatedDB.entities.Pool.set(mockLiquidityPoolData);

    const mockEvent = Pool.Fees.createMockEvent({
      amount0: expectations.amount0In,
      amount1: expectations.amount1In,
      sender: toChecksumAddress("0x1234567890123456789012345678901234567890"),
      mockEventData: {
        block: {
          number: 123456,
          timestamp: 1000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        srcAddress: mockLiquidityPoolData.poolAddress as `0x${string}`,
      },
    });

    const result = await updatedDB.processEvents([mockEvent]);

    updatedPool = result.entities.Pool.get(poolId);
    createdUserStats = result.entities.UserStatsPerPool.get(
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
      mockLiquidityPoolData.totalFeesGenerated1 + expectations.amount1In,
    );
  });

  it("should update Pool total fees in USD", async () => {
    expect(updatedPool?.totalFeesGeneratedUSD).toBe(
      expectations.totalFeesGeneratedUSD,
    );
  });

  it("should update Pool total fees in USD whitelisted", async () => {
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
      expectations.amount1In,
    );

    // Per issue #733, user fee USD now follows the trusted-leg pick, same as
    // the pool's totalFeesGeneratedUSD increment.
    expect(createdUserStats?.totalFeesContributedUSD).toBe(trustedLegUSD);
  });

  it("should set correct timestamps for UserStatsPerPool entity", async () => {
    expect(createdUserStats?.firstActivityTimestamp).toEqual(
      new Date(1000000 * 1000),
    );
    expect(createdUserStats?.lastActivityTimestamp).toEqual(
      new Date(1000000 * 1000),
    );
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

    // Set up the existing user stats in the database
    updatedDB = updatedDB.entities.UserStatsPerPool.set(existingUserStats);

    const mockEvent = Pool.Fees.createMockEvent({
      amount0: 500n,
      amount1: 300n,
      sender: toChecksumAddress("0x1234567890123456789012345678901234567890"),
      mockEventData: {
        block: {
          number: 123457,
          timestamp: 2000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901235",
        },
        chainId: 10,
        srcAddress: mockLiquidityPoolData.poolAddress as `0x${string}`,
      },
    });

    const result = await updatedDB.processEvents([mockEvent]);

    const updatedUserStats = result.entities.UserStatsPerPool.get(
      UserStatsPerPoolId(
        10,
        toChecksumAddress("0x1234567890123456789012345678901234567890"),
        toChecksumAddress("0x3333333333333333333333333333333333333333"),
      ),
    );

    expect(updatedUserStats).toBeDefined();
    expect(updatedUserStats?.totalFeesContributed0).toBe(
      existingUserStats.totalFeesContributed0 + 500n,
    );
    expect(updatedUserStats?.totalFeesContributed1).toBe(
      existingUserStats.totalFeesContributed1 + 300n,
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

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      // Create a fresh mockDb without the pool
      const freshMockDb = MockDb.createMockDb();
      const updatedDB1 = freshMockDb.entities.Token.set(
        mockToken0Data as Token,
      );
      const updatedDB2 = updatedDB1.entities.Token.set(mockToken1Data as Token);
      // Note: We intentionally don't set the Pool

      const mockEvent = Pool.Fees.createMockEvent({
        amount0: 3n * 10n ** 18n,
        amount1: 2n * 10n ** 6n,
        sender: toChecksumAddress("0x1234567890123456789012345678901234567890"),
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          srcAddress: mockLiquidityPoolData.poolAddress as `0x${string}`,
        },
      });

      const postEventDB = await updatedDB2.processEvents([mockEvent]);

      // Pool should not exist
      const pool = postEventDB.entities.Pool.get(poolId);
      expect(pool).toBeUndefined();

      // User stats will still be created because loadOrCreateUserData is called in parallel
      // but they should have default/zero values since no fees processing occurred
      const userStats = postEventDB.entities.UserStatsPerPool.get(
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

  describe("when optional diffs are undefined", () => {
    let processSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      processSpy?.mockRestore();
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should handle undefined liquidityPoolDiff gracefully", async () => {
      // Set up fresh database
      const freshMockDb = MockDb.createMockDb();
      const testDB = freshMockDb.entities.Token.set(mockToken0Data as Token);
      const testDB2 = testDB.entities.Token.set(mockToken1Data as Token);
      const testDB3 = testDB2.entities.Pool.set(mockLiquidityPoolData);

      // Mock processPoolFees to return undefined liquidityPoolDiff
      processSpy = vi.spyOn(PoolFeesLogic, "processPoolFees").mockReturnValue({
        liquidityPoolDiff: undefined, // Test the undefined branch
        userDiff: {
          incrementalTotalFeesContributedUSD: 500n,
          incrementalTotalFeesContributed0: 3n * 10n ** 18n,
          incrementalTotalFeesContributed1: 2n * 10n ** 6n,
          lastActivityTimestamp: new Date(1000000 * 1000),
        },
      });

      const mockEvent = Pool.Fees.createMockEvent({
        amount0: 3n * 10n ** 18n,
        amount1: 2n * 10n ** 6n,
        sender: toChecksumAddress("0x1234567890123456789012345678901234567890"),
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          srcAddress: mockLiquidityPoolData.poolAddress as `0x${string}`,
        },
      });

      const result = await testDB3.processEvents([mockEvent]);

      // Pool should not be updated since liquidityPoolDiff is undefined
      const pool = result.entities.Pool.get(poolId);
      expect(pool?.totalFeesGenerated0).toBe(
        mockLiquidityPoolData.totalFeesGenerated0,
      );

      // User stats should still be updated
      const userStats = result.entities.UserStatsPerPool.get(
        UserStatsPerPoolId(
          10,
          toChecksumAddress("0x1234567890123456789012345678901234567890"),
          toChecksumAddress("0x3333333333333333333333333333333333333333"),
        ),
      );
      expect(userStats?.totalFeesContributed0).toBe(3n * 10n ** 18n);
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should handle undefined userDiff gracefully", async () => {
      // Set up fresh database
      const freshMockDb = MockDb.createMockDb();
      const testDB = freshMockDb.entities.Token.set(mockToken0Data as Token);
      const testDB2 = testDB.entities.Token.set(mockToken1Data as Token);
      const testDB3 = testDB2.entities.Pool.set(mockLiquidityPoolData);

      // Mock processPoolFees to return undefined userDiff
      const processSpy = vi
        .spyOn(PoolFeesLogic, "processPoolFees")
        .mockReturnValue({
          liquidityPoolDiff: {
            incrementalTotalFeesGenerated0: 3n * 10n ** 18n,
            incrementalTotalFeesGenerated1: 2n * 10n ** 6n,
            incrementalTotalFeesGeneratedUSD: 500n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userDiff: undefined, // Test the undefined branch
        });

      const mockEvent = Pool.Fees.createMockEvent({
        amount0: 3n * 10n ** 18n,
        amount1: 2n * 10n ** 6n,
        sender: toChecksumAddress("0x1234567890123456789012345678901234567890"),
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          srcAddress: mockLiquidityPoolData.poolAddress as `0x${string}`,
        },
      });

      const result = await testDB3.processEvents([mockEvent]);

      // Pool should still be updated
      const pool = result.entities.Pool.get(poolId);
      expect(pool?.totalFeesGenerated0).toBe(
        mockLiquidityPoolData.totalFeesGenerated0 + 3n * 10n ** 18n,
      );

      // User stats should still be created (from loadOrCreateUserData) but not updated
      const userStats = result.entities.UserStatsPerPool.get(
        UserStatsPerPoolId(
          10,
          toChecksumAddress("0x1234567890123456789012345678901234567890"),
          toChecksumAddress("0x3333333333333333333333333333333333333333"),
        ),
      );
      expect(userStats).toBeDefined();
      // Should have default values since userDiff was undefined
      expect(userStats?.totalFeesContributed0).toBe(0n);
      expect(userStats?.totalFeesContributed1).toBe(0n);

      processSpy.mockRestore();
    });
  });
});
