import type { Token, VeNFTState } from "envio";
import { createTestIndexer } from "envio";
import { TokenId, VeNFTId, toChecksumAddress } from "../../../src/Constants";
import * as VotingRewardSharedLogic from "../../../src/EventHandlers/VotingReward/VotingRewardSharedLogic";
import { simulateEvent } from "../../testHelpers";
import { type MockPool, setupCommon } from "../Pool/common";

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

  let indexer: ReturnType<typeof createTestIndexer>;
  let liquidityPool: MockPool;
  let userStats: ReturnType<
    ReturnType<typeof setupCommon>["createMockUserStatsPerPool"]
  >;
  let rewardToken: Token;
  let veNFT: VeNFTState;

  beforeEach(() => {
    indexer = createTestIndexer();
    const { createMockUserStatsPerPool, createMockPool } = setupCommon();

    // Set up liquidity pool with bribe voting reward address
    liquidityPool = createMockPool({
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

    // Set up entities in indexer
    indexer.Pool.set(liquidityPool);
    indexer.UserStatsPerPool.set(userStats);
    indexer.VeNFTState.set(veNFT);
    indexer.Token.set(mockToken0Data as Token);
    indexer.Token.set(mockToken1Data as Token);
    indexer.Token.set(rewardToken);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TODO: vi.spyOn is silently no-op'd under indexer.process() (V3 Quirk 3 — handler
  // runtime tsx-loads modules fresh so module-level spies don't intercept handler calls).
  describe.skip("ClaimRewards Event", () => {
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

      await simulateEvent(indexer, chainId, {
        contract: "SuperchainIncentiveVotingReward",
        event: "ClaimRewards",
        params: {
          _sender: userAddress,
          _reward: rewardTokenAddress,
          _amount: 1000000n, // 1 token with 18 decimals
        },
        block: {
          number: 1000000,
          timestamp: 1000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        srcAddress: votingRewardAddress,
        logIndex: 1,
      });
    });

    it("should update pool aggregator with bribe claimed", async () => {
      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.totalBribeClaimed).toBe(1000000n);
      expect(updatedPool?.totalBribeClaimedUSD).toBe(1000000n);
    });

    it("should update user stats with bribe claimed", async () => {
      const updatedUser = await indexer.UserStatsPerPool.get(userStats.id);
      expect(updatedUser).toBeDefined();
      expect(updatedUser?.totalBribeClaimed).toBe(1000000n);
      expect(updatedUser?.totalBribeClaimedUSD).toBe(1000000n);
    });

    describe("when loadVotingRewardData returns null", () => {
      beforeEach(async () => {
        vi.restoreAllMocks();
        vi.spyOn(
          VotingRewardSharedLogic,
          "loadVotingRewardData",
        ).mockResolvedValue(null);

        // Create fresh indexer with initial entities to avoid interference from parent's process
        indexer = createTestIndexer();
        indexer.Pool.set(liquidityPool);
        indexer.UserStatsPerPool.set(userStats);
        indexer.Token.set(rewardToken);

        await simulateEvent(indexer, chainId, {
          contract: "SuperchainIncentiveVotingReward",
          event: "ClaimRewards",
          params: {
            _sender: userAddress,
            _reward: rewardTokenAddress,
            _amount: 1000000n,
          },
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          srcAddress: votingRewardAddress,
          logIndex: 1,
        });
      });

      it("should not update pool or user stats", async () => {
        const updatedPool = await indexer.Pool.get(liquidityPool.id);
        expect(updatedPool?.totalBribeClaimed).toBe(
          liquidityPool.totalBribeClaimed,
        );

        const updatedUser = await indexer.UserStatsPerPool.get(userStats.id);
        expect(updatedUser?.totalBribeClaimed).toBe(
          userStats.totalBribeClaimed,
        );
      });
    });
  });
});
