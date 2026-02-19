import "../../eventHandlersRegistration";
import type {
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
  VeNFTState,
} from "generated";
import {
  MockDb,
  SuperchainIncentiveVotingReward,
} from "../../../generated/src/TestHelpers.gen";
import { TokenId, VeNFTId, toChecksumAddress } from "../../../src/Constants";
import * as VotingRewardSharedLogic from "../../../src/EventHandlers/VotingReward/VotingRewardSharedLogic";
import { setupCommon } from "../Pool/common";

describe("SuperchainIncentiveVotingReward Events", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  const chainId = 252;
  const votingRewardAddress = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );
  const userAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const rewardTokenAddress = toChecksumAddress(
    "0x4444444444444444444444444444444444444444",
  );
  const tokenId = 1n;

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let liquidityPool: LiquidityPoolAggregator;
  let userStats: UserStatsPerPool;
  let rewardToken: Token;
  let veNFT: VeNFTState;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
    const { createMockUserStatsPerPool, createMockLiquidityPoolAggregator } =
      setupCommon();

    // Set up liquidity pool with bribe voting reward address
    liquidityPool = createMockLiquidityPoolAggregator({
      chainId: chainId,
      bribeVotingRewardAddress: votingRewardAddress,
      feeVotingRewardAddress: "",
      veNFTamountStaked: 1000n, // Initial staked amount
    });

    // Set up user stats

    userStats = createMockUserStatsPerPool({
      userAddress: userAddress,
      poolAddress: liquidityPool.poolAddress,
      chainId: chainId,
      lastActivityTimestamp: new Date(1000000 * 1000),
      veNFTamountStaked: 500n, // Initial staked amount
    });

    // Set up VeNFT
    veNFT = {
      id: VeNFTId(chainId, tokenId),
      chainId: chainId,
      tokenId: tokenId,
      owner: userAddress,
      locktime: 1000000n,
      totalValueLocked: 10000n,
      isAlive: true,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
    } as VeNFTState;

    // Set up reward token
    rewardToken = {
      id: TokenId(chainId, rewardTokenAddress),
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
    mockDb = mockDb.entities.VeNFTState.set(veNFT);
    mockDb = mockDb.entities.Token.set(mockToken0Data as Token);
    mockDb = mockDb.entities.Token.set(mockToken1Data as Token);
    mockDb = mockDb.entities.Token.set(rewardToken);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ClaimRewards Event", () => {
    let mockEvent: ReturnType<
      typeof SuperchainIncentiveVotingReward.ClaimRewards.createMockEvent
    >;
    let resultDB: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(async () => {
      // Mock the loadVotingRewardData function
      vi.spyOn(
        VotingRewardSharedLogic,
        "loadVotingRewardData",
      ).mockResolvedValue({
        pool: liquidityPool,
        poolData: {
          liquidityPoolAggregator: liquidityPool,
        },
        userData: userStats,
      });

      // Mock the processVotingRewardClaimRewards function
      vi.spyOn(
        VotingRewardSharedLogic,
        "processVotingRewardClaimRewards",
      ).mockResolvedValue({
        poolDiff: {
          incrementalTotalBribeClaimed: 1000000n,
          incrementalTotalBribeClaimedUSD: 1000000n,
        },
        userDiff: {
          incrementalTotalBribeClaimed: 1000000n,
          incrementalTotalBribeClaimedUSD: 1000000n,
        },
      });

      mockEvent = SuperchainIncentiveVotingReward.ClaimRewards.createMockEvent({
        _sender: userAddress,
        _reward: rewardTokenAddress,
        _amount: 1000000n, // 1 token with 18 decimals
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

      resultDB = await mockDb.processEvents([mockEvent]);
    });

    it("should update pool aggregator with bribe claimed", () => {
      const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
        liquidityPool.id,
      );
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.totalBribeClaimed).toBe(1000000n);
      expect(updatedPool?.totalBribeClaimedUSD).toBe(1000000n);
    });

    it("should update user stats with bribe claimed", () => {
      const updatedUser = resultDB.entities.UserStatsPerPool.get(userStats.id);
      expect(updatedUser).toBeDefined();
      expect(updatedUser?.totalBribeClaimed).toBe(1000000n);
      expect(updatedUser?.totalBribeClaimedUSD).toBe(1000000n);
    });

    describe("when loadVotingRewardData returns null", () => {
      let freshMockDb: ReturnType<typeof MockDb.createMockDb>;

      beforeEach(async () => {
        vi.restoreAllMocks();
        vi.spyOn(
          VotingRewardSharedLogic,
          "loadVotingRewardData",
        ).mockResolvedValue(null);

        // Create fresh mockDb with initial entities to avoid interference from parent's processEvents
        freshMockDb = MockDb.createMockDb();
        freshMockDb =
          freshMockDb.entities.LiquidityPoolAggregator.set(liquidityPool);
        freshMockDb = freshMockDb.entities.UserStatsPerPool.set(userStats);
        freshMockDb = freshMockDb.entities.Token.set(rewardToken);
        resultDB = await freshMockDb.processEvents([mockEvent]);
      });

      it("should not update pool or user stats", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          liquidityPool.id,
        );
        expect(updatedPool?.totalBribeClaimed).toBe(
          liquidityPool.totalBribeClaimed,
        );

        const updatedUser = resultDB.entities.UserStatsPerPool.get(
          userStats.id,
        );
        expect(updatedUser?.totalBribeClaimed).toBe(
          userStats.totalBribeClaimed,
        );
      });
    });
  });
});
