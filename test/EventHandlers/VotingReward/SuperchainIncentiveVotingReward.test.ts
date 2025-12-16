import { expect } from "chai";
import sinon from "sinon";
import {
  MockDb,
  SuperchainIncentiveVotingReward,
} from "../../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
  VeNFTAggregator,
} from "../../../generated/src/Types.gen";
import { VeNFTId } from "../../../src/Aggregators/VeNFTAggregator";
import { TokenIdByChain, toChecksumAddress } from "../../../src/Constants";
import * as VotingRewardSharedLogic from "../../../src/EventHandlers/VotingReward/VotingRewardSharedLogic";
import { setupCommon } from "../Pool/common";

describe("SuperchainIncentiveVotingReward Events", () => {
  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } =
    setupCommon();
  const chainId = 252;
  const poolAddress = toChecksumAddress(mockLiquidityPoolData.id);
  const votingRewardAddress = "0x3333333333333333333333333333333333333333";
  const userAddress = "0x2222222222222222222222222222222222222222";
  const rewardTokenAddress = "0x4444444444444444444444444444444444444444";
  const tokenId = 1n;

  let sandbox: sinon.SinonSandbox;
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let liquidityPool: LiquidityPoolAggregator;
  let userStats: UserStatsPerPool;
  let rewardToken: Token;
  let veNFT: VeNFTAggregator;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockDb = MockDb.createMockDb();

    // Set up liquidity pool with bribe voting reward address
    liquidityPool = {
      ...mockLiquidityPoolData,
      id: poolAddress,
      chainId: chainId,
      bribeVotingRewardAddress: toChecksumAddress(votingRewardAddress),
      feeVotingRewardAddress: "",
      veNFTamountStaked: 1000n, // Initial staked amount
    } as LiquidityPoolAggregator;

    // Set up user stats
    const { createMockUserStatsPerPool } = setupCommon();
    userStats = createMockUserStatsPerPool({
      userAddress: userAddress,
      poolAddress: poolAddress,
      chainId: chainId,
      lastActivityTimestamp: new Date(1000000 * 1000),
      veNFTamountStaked: 500n, // Initial staked amount
    });

    // Set up VeNFT
    veNFT = {
      id: VeNFTId(chainId, tokenId),
      chainId: chainId,
      tokenId: tokenId,
      owner: toChecksumAddress(userAddress),
      locktime: 1000000n,
      totalValueLocked: 10000n,
      isAlive: true,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
    } as VeNFTAggregator;

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
    mockDb = mockDb.entities.VeNFTAggregator.set(veNFT);
    mockDb = mockDb.entities.Token.set(mockToken0Data as Token);
    mockDb = mockDb.entities.Token.set(mockToken1Data as Token);
    mockDb = mockDb.entities.Token.set(rewardToken);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("ClaimRewards Event", () => {
    let mockEvent: ReturnType<
      typeof SuperchainIncentiveVotingReward.ClaimRewards.createMockEvent
    >;
    let resultDB: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(async () => {
      // Mock the loadVotingRewardData function
      sandbox.stub(VotingRewardSharedLogic, "loadVotingRewardData").resolves({
        pool: liquidityPool,
        poolData: {
          liquidityPoolAggregator: liquidityPool,
        },
        userData: userStats,
      });

      // Mock the processVotingRewardClaimRewards function
      sandbox
        .stub(VotingRewardSharedLogic, "processVotingRewardClaimRewards")
        .resolves({
          poolDiff: {
            totalBribeClaimed: 1000000n,
            totalBribeClaimedUSD: 1000000n,
          },
          userDiff: {
            totalBribeClaimed: 1000000n,
            totalBribeClaimedUSD: 1000000n,
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

      resultDB =
        await SuperchainIncentiveVotingReward.ClaimRewards.processEvent({
          event: mockEvent,
          mockDb,
        });
    });

    it("should update pool aggregator with bribe claimed", () => {
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.totalBribeClaimed).to.equal(1000000n);
      expect(updatedPool?.totalBribeClaimedUSD).to.equal(1000000n);
    });

    it("should update user stats with bribe claimed", () => {
      const updatedUser = resultDB.entities.UserStatsPerPool.get(userStats.id);
      expect(updatedUser).to.not.be.undefined;
      expect(updatedUser?.totalBribeClaimed).to.equal(1000000n);
      expect(updatedUser?.totalBribeClaimedUSD).to.equal(1000000n);
    });

    describe("when loadVotingRewardData returns null", () => {
      beforeEach(async () => {
        sandbox.restore();
        sandbox = sinon.createSandbox();
        sandbox
          .stub(VotingRewardSharedLogic, "loadVotingRewardData")
          .resolves(null);

        resultDB =
          await SuperchainIncentiveVotingReward.ClaimRewards.processEvent({
            event: mockEvent,
            mockDb,
          });
      });

      it("should not update pool or user stats", () => {
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
        expect(updatedPool?.totalBribeClaimed).to.equal(
          liquidityPool.totalBribeClaimed,
        );

        const updatedUser = resultDB.entities.UserStatsPerPool.get(
          userStats.id,
        );
        expect(updatedUser?.totalBribeClaimed).to.equal(
          userStats.totalBribeClaimed,
        );
      });
    });
  });
});
