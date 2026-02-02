import {
  BribesVotingReward,
  MockDb,
} from "../../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
} from "../../../generated/src/Types.gen";
import { TokenIdByChain, toChecksumAddress } from "../../../src/Constants";
import * as VotingRewardSharedLogic from "../../../src/EventHandlers/VotingReward/VotingRewardSharedLogic";
import { setupCommon } from "../Pool/common";

describe("BribesVotingReward Events", () => {
  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } =
    setupCommon();
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const chainId = 10;
  const votingRewardAddress = "0x3333333333333333333333333333333333333333";
  const userAddress = "0x2222222222222222222222222222222222222222";
  const rewardTokenAddress = "0x4444444444444444444444444444444444444444";

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let liquidityPool: LiquidityPoolAggregator;
  let userStats: UserStatsPerPool;
  let rewardToken: Token;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = MockDb.createMockDb();

    // Set up liquidity pool with bribe voting reward address
    liquidityPool = {
      ...mockLiquidityPoolData,
      bribeVotingRewardAddress: toChecksumAddress(votingRewardAddress),
      feeVotingRewardAddress: "",
    } as LiquidityPoolAggregator;

    // Set up user stats
    const { createMockUserStatsPerPool } = setupCommon();
    userStats = createMockUserStatsPerPool({
      userAddress: userAddress,
      poolAddress: poolAddress,
      chainId: chainId,
      lastActivityTimestamp: new Date(1000000 * 1000),
    });

    // Set up reward token
    rewardToken = {
      id: TokenIdByChain(rewardTokenAddress, chainId),
      address: rewardTokenAddress,
      symbol: "REWARD",
      name: "Reward Token",
      chainId: chainId,
      decimals: 18n,
      pricePerUSDNew: 1n * 10n ** 18n, // 1 USD
      isWhitelisted: true,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
    } as Token;

    // Set up entities in mock DB
    mockDb = mockDb.entities.LiquidityPoolAggregator.set(liquidityPool);
    mockDb = mockDb.entities.UserStatsPerPool.set(userStats);
    mockDb = mockDb.entities.Token.set(mockToken0Data as Token);
    mockDb = mockDb.entities.Token.set(mockToken1Data as Token);
    mockDb = mockDb.entities.Token.set(rewardToken);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("ClaimRewards Event", () => {
    let mockEvent: ReturnType<
      typeof BribesVotingReward.ClaimRewards.createMockEvent
    >;
    let resultDB: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(async () => {
      // Mock the getTokenPriceData effect
      jest
        .spyOn(VotingRewardSharedLogic, "loadVotingRewardData")
        .mockResolvedValue({
          pool: liquidityPool,
          poolData: {
            liquidityPoolAggregator: liquidityPool,
          },
          userData: userStats,
        });

      mockEvent = BribesVotingReward.ClaimRewards.createMockEvent({
        from: userAddress,
        reward: rewardTokenAddress,
        amount: 1000000n, // 1 token with 18 decimals
        mockEventData: {
          srcAddress: votingRewardAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });

      resultDB = await BribesVotingReward.ClaimRewards.processEvent({
        event: mockEvent,
        mockDb,
      });
    });

    it("should update pool aggregator with bribe claimed", () => {
      const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolData.id,
      );
      expect(updatedPool).toBeDefined();
      // The actual values depend on the price calculation, but should be updated
      expect(updatedPool?.totalBribeClaimed).toBeGreaterThan(0n);
    });

    it("should update user stats with bribe claimed", () => {
      const updatedUser = resultDB.entities.UserStatsPerPool.get(userStats.id);
      expect(updatedUser).toBeDefined();
      expect(updatedUser?.totalBribeClaimed).toBeGreaterThan(0n);
    });
  });
});
