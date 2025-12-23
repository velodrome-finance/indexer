import { MockDb, Pool } from "../../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
} from "../../../generated/src/Types.gen";
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
    totalFeesUSDWhitelisted: 0n,
    totalUnstakedFeesCollectedUSD: 0n,
  };

  expectations.totalLiquidityUSD =
    ((mockLiquidityPoolData.reserve0 - expectations.amount0In) *
      mockToken0Data.pricePerUSDNew) /
      10n ** mockToken0Data.decimals +
    ((mockLiquidityPoolData.reserve1 - expectations.amount1In) *
      mockToken1Data.pricePerUSDNew) /
      10n ** mockToken1Data.decimals;

  expectations.totalUnstakedFeesCollectedUSD =
    mockLiquidityPoolData.totalUnstakedFeesCollectedUSD +
    (expectations.amount0In / 10n ** mockToken0Data.decimals) *
      mockToken0Data.pricePerUSDNew +
    (expectations.amount1In / 10n ** mockToken1Data.decimals) *
      mockToken1Data.pricePerUSDNew;

  expectations.totalFeesUSDWhitelisted =
    expectations.totalUnstakedFeesCollectedUSD;

  let updatedPool: LiquidityPoolAggregator | undefined;
  let createdUserStats: UserStatsPerPool | undefined;

  beforeEach(async () => {
    mockDb = MockDb.createMockDb();
    updatedDB = mockDb.entities.Token.set(mockToken0Data as Token);
    updatedDB = updatedDB.entities.Token.set(mockToken1Data as Token);
    updatedDB = updatedDB.entities.LiquidityPoolAggregator.set(
      mockLiquidityPoolData,
    );

    const mockEvent = Pool.Fees.createMockEvent({
      amount0: expectations.amount0In,
      amount1: expectations.amount1In,
      sender: "0x1234567890123456789012345678901234567890",
      mockEventData: {
        block: {
          number: 123456,
          timestamp: 1000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        srcAddress: poolId,
      },
    });

    const result = await Pool.Fees.processEvent({
      event: mockEvent,
      mockDb: updatedDB,
    });

    updatedPool = result.entities.LiquidityPoolAggregator.get(poolId);
    createdUserStats = result.entities.UserStatsPerPool.get(
      "0x1234567890123456789012345678901234567890_0x3333333333333333333333333333333333333333_10",
    );
  });

  it("should update LiquidityPoolAggregator", async () => {
    expect(updatedPool).toBeDefined();
    expect(updatedPool?.lastUpdatedTimestamp).toEqual(new Date(1000000 * 1000));
  });

  it("should update LiquidityPoolAggregator nominal fees", async () => {
    // For regular pools, fees are tracked as unstaked fees
    expect(updatedPool?.totalUnstakedFeesCollected0).toBe(
      mockLiquidityPoolData.totalUnstakedFeesCollected0 +
        expectations.amount0In,
    );
    expect(updatedPool?.totalUnstakedFeesCollected1).toBe(
      mockLiquidityPoolData.totalUnstakedFeesCollected1 +
        expectations.amount1In,
    );
  });

  it("should update LiquidityPoolAggregator total fees in USD", async () => {
    expect(updatedPool?.totalUnstakedFeesCollectedUSD).toBe(
      expectations.totalUnstakedFeesCollectedUSD,
    );
  });

  it("should update LiquidityPoolAggregator total fees in USD whitelisted", async () => {
    expect(updatedPool?.totalFeesUSDWhitelisted).toBe(
      expectations.totalFeesUSDWhitelisted,
    );
  });

  it("should create a new UserStatsPerPool entity", async () => {
    expect(createdUserStats).toBeDefined();
    expect(createdUserStats?.id).toBe(
      "0x1234567890123456789012345678901234567890_0x3333333333333333333333333333333333333333_10",
    );
    expect(createdUserStats?.userAddress).toBe(
      "0x1234567890123456789012345678901234567890",
    );
    expect(createdUserStats?.poolAddress).toBe(
      "0x3333333333333333333333333333333333333333",
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

    const expectedUserFeesUSD =
      (expectations.amount0In / 10n ** mockToken0Data.decimals) *
        mockToken0Data.pricePerUSDNew +
      (expectations.amount1In / 10n ** mockToken1Data.decimals) *
        mockToken1Data.pricePerUSDNew;
    expect(createdUserStats?.totalFeesContributedUSD).toBe(expectedUserFeesUSD);
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
      userAddress: "0x1234567890123456789012345678901234567890",
      poolAddress: "0x3333333333333333333333333333333333333333",
      chainId: 10,
      currentLiquidityUSD: 2000n,
      currentLiquidityToken0: 1000n,
      currentLiquidityToken1: 1000n,
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
      sender: "0x1234567890123456789012345678901234567890",
      mockEventData: {
        block: {
          number: 123457,
          timestamp: 2000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901235",
        },
        chainId: 10,
        srcAddress: poolId,
      },
    });

    const result = await Pool.Fees.processEvent({
      event: mockEvent,
      mockDb: updatedDB,
    });

    const updatedUserStats = result.entities.UserStatsPerPool.get(
      "0x1234567890123456789012345678901234567890_0x3333333333333333333333333333333333333333_10",
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
});
