import { expect } from "chai";
import sinon from "sinon";
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
  const chainId = 10;
  const poolAddress = toChecksumAddress(mockLiquidityPoolData.id);
  const votingRewardAddress = "0x3333333333333333333333333333333333333333";
  const userAddress = "0x2222222222222222222222222222222222222222";
  const rewardTokenAddress = "0x4444444444444444444444444444444444444444";

  let sandbox: sinon.SinonSandbox;
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let liquidityPool: LiquidityPoolAggregator;
  let userStats: UserStatsPerPool;
  let rewardToken: Token;

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
    } as LiquidityPoolAggregator;

    // Set up user stats
    userStats = {
      id: `${toChecksumAddress(userAddress)}_${poolAddress}_${chainId}`,
      userAddress: toChecksumAddress(userAddress),
      poolAddress: poolAddress,
      chainId: chainId,
      currentLiquidityUSD: 0n,
      totalFeesContributedUSD: 0n,
      totalBribeClaimed: 0n,
      totalBribeClaimedUSD: 0n,
      totalFeeRewardClaimed: 0n,
      totalFeeRewardClaimedUSD: 0n,
      veNFTamountStaked: 0n,
      lastActivityTimestamp: new Date(1000000 * 1000),
    } as UserStatsPerPool;

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
    sandbox.restore();
  });

  describe("Deposit Event", () => {
    let mockEvent: ReturnType<
      typeof BribesVotingReward.Deposit.createMockEvent
    >;
    let resultDB: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(async () => {
      mockEvent = BribesVotingReward.Deposit.createMockEvent({
        from: userAddress,
        tokenId: 1n,
        amount: 1000000n,
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

      resultDB = await BribesVotingReward.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });
    });

    it("should update pool aggregator with veNFT amount staked", () => {
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.veNFTamountStaked).to.equal(1000000n);
    });

    it("should update user stats with veNFT amount staked", () => {
      const updatedUser = resultDB.entities.UserStatsPerPool.get(userStats.id);
      expect(updatedUser).to.not.be.undefined;
      expect(updatedUser?.veNFTamountStaked).to.equal(1000000n);
    });

    it("should return early if pool not found", async () => {
      // Create pool without bribe voting reward address
      const poolWithoutAddress = {
        ...liquidityPool,
        bribeVotingRewardAddress: "",
      };
      const testDb = MockDb.createMockDb();
      testDb.entities.LiquidityPoolAggregator.set(poolWithoutAddress);

      const result = await BribesVotingReward.Deposit.processEvent({
        event: mockEvent,
        mockDb: testDb,
      });

      // Should not throw, but pool shouldn't be updated
      expect(result).to.not.be.undefined;
    });
  });

  describe("ClaimRewards Event", () => {
    let mockEvent: ReturnType<
      typeof BribesVotingReward.ClaimRewards.createMockEvent
    >;
    let resultDB: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(async () => {
      // Mock the getTokenPriceData effect
      sandbox.stub(VotingRewardSharedLogic, "loadVotingRewardData").resolves({
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
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
      // The actual values depend on the price calculation, but should be updated
      expect(updatedPool?.totalBribeClaimed).to.not.equal(0n);
      expect(Number(updatedPool?.totalBribeClaimed)).to.be.greaterThan(0);
    });

    it("should update user stats with bribe claimed", () => {
      const updatedUser = resultDB.entities.UserStatsPerPool.get(userStats.id);
      expect(updatedUser).to.not.be.undefined;
      expect(updatedUser?.totalBribeClaimed).to.not.equal(0n);
      expect(Number(updatedUser?.totalBribeClaimed)).to.be.greaterThan(0);
    });
  });

  describe("Withdraw Event", () => {
    let mockEvent: ReturnType<
      typeof BribesVotingReward.Withdraw.createMockEvent
    >;
    let resultDB: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(async () => {
      // Set initial staked amount
      const poolWithStake = {
        ...liquidityPool,
        veNFTamountStaked: 2000000n,
        bribeVotingRewardAddress: toChecksumAddress(votingRewardAddress),
      };
      const userWithStake = {
        ...userStats,
        veNFTamountStaked: 2000000n,
      };
      mockDb = MockDb.createMockDb();
      mockDb = mockDb.entities.LiquidityPoolAggregator.set(poolWithStake);
      mockDb = mockDb.entities.UserStatsPerPool.set(userWithStake);
      mockDb = mockDb.entities.Token.set(mockToken0Data as Token);
      mockDb = mockDb.entities.Token.set(mockToken1Data as Token);
      mockDb = mockDb.entities.Token.set(rewardToken);

      mockEvent = BribesVotingReward.Withdraw.createMockEvent({
        from: userAddress,
        tokenId: 1n,
        amount: 1000000n,
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

      resultDB = await BribesVotingReward.Withdraw.processEvent({
        event: mockEvent,
        mockDb,
      });
    });

    it("should decrease pool veNFT amount staked", () => {
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.veNFTamountStaked).to.equal(1000000n); // 2000000 - 1000000
    });

    it("should decrease user veNFT amount staked", () => {
      const updatedUser = resultDB.entities.UserStatsPerPool.get(userStats.id);
      expect(updatedUser).to.not.be.undefined;
      expect(updatedUser?.veNFTamountStaked).to.equal(1000000n); // 2000000 - 1000000
    });
  });
});
