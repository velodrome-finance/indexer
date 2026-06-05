import type { Token, VeNFTState } from "envio";
import { createTestIndexer } from "envio";
import { TokenId, VeNFTId, toChecksumAddress } from "../../../src/Constants";
import * as VotingRewardSharedLogic from "../../../src/EventHandlers/VotingReward/VotingRewardSharedLogic";
import { type MockPool, setupCommon } from "../Pool/common";

describe("SuperchainIncentiveVotingReward Events", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  const chainId = 252 as const;
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

    // Set up entities in test indexer
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

  describe("ClaimRewards Event", () => {
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
          incrementalTotalBribeClaimedUSD: 1000000n,
        },
        userDiff: {
          incrementalTotalBribeClaimedUSD: 1000000n,
        },
      });

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "SuperchainIncentiveVotingReward",
                event: "ClaimRewards",
                srcAddress: votingRewardAddress,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  from: userAddress,
                  reward: rewardTokenAddress,
                  amount: 1000000n, // 1 token with 18 decimals
                },
              },
            ],
          },
        },
      });
    });

    it("should update pool aggregator with bribe claimed", async () => {
      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.totalBribeClaimedUSD).toBe(1000000n);
    });

    it("should update user stats with bribe claimed", async () => {
      const updatedUser = await indexer.UserStatsPerPool.get(userStats.id);
      expect(updatedUser).toBeDefined();
      expect(updatedUser?.totalBribeClaimedUSD).toBe(1000000n);
    });

    describe("when loadVotingRewardData returns null", () => {
      it("should not update pool or user stats", async () => {
        vi.restoreAllMocks();
        vi.spyOn(
          VotingRewardSharedLogic,
          "loadVotingRewardData",
        ).mockResolvedValue(null);

        // Create fresh indexer with initial entities to avoid interference from parent's processEvents
        const freshIndexer = createTestIndexer();
        freshIndexer.Pool.set(liquidityPool);
        freshIndexer.UserStatsPerPool.set(userStats);
        freshIndexer.Token.set(rewardToken);

        await freshIndexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "SuperchainIncentiveVotingReward",
                  event: "ClaimRewards",
                  srcAddress: votingRewardAddress,
                  logIndex: 1,
                  block: {
                    number: 1000000,
                    timestamp: 1000000,
                    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                  },
                  params: {
                    from: userAddress,
                    reward: rewardTokenAddress,
                    amount: 1000000n,
                  },
                },
              ],
            },
          },
        });

        const updatedPool = await freshIndexer.Pool.get(liquidityPool.id);
        expect(updatedPool?.totalBribeClaimedUSD).toBe(
          liquidityPool.totalBribeClaimedUSD,
        );

        const updatedUser = await freshIndexer.UserStatsPerPool.get(
          userStats.id,
        );
        expect(updatedUser?.totalBribeClaimedUSD).toBe(
          userStats.totalBribeClaimedUSD,
        );
      });
    });
  });

  // Issue #844: envio 3.1.0's native decoder dedupes shared-signature param
  // names first-contract-wins, so `ClaimRewards(address,address,uint256)` logs
  // emitted by SuperchainIncentiveVotingReward arrive named after
  // FeesVotingReward (`from/reward/amount`). The handler must read those
  // canonical names — reading `_reward` yielded `undefined` →
  // `{chainId}-undefined` → a null-address Token write that crashed the deploy.
  // This block runs the real shared logic (only the pool/user lookup is mocked;
  // the reward token is pre-seeded so no RPC / createTokenEntity fires).
  describe("ClaimRewards Event — issue #844 param-name regression", () => {
    beforeEach(() => {
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
    });

    it("attributes USD against token id {chainId}-{rewardAddress}, never {chainId}-undefined", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "SuperchainIncentiveVotingReward",
                event: "ClaimRewards",
                srcAddress: votingRewardAddress,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  from: userAddress,
                  reward: rewardTokenAddress,
                  amount: 1000000n, // 1 token with 18 decimals
                },
              },
            ],
          },
        },
      });

      // USD is attributed to the pool and the user (1e18 price × 1 token = 1e6
      // in 1e18-base, matching getTrustedUSD on the pre-seeded reward token).
      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool?.totalBribeClaimedUSD).toBe(1000000n);

      const updatedUser = await indexer.UserStatsPerPool.get(userStats.id);
      expect(updatedUser?.totalBribeClaimedUSD).toBe(1000000n);

      // The reward token is resolved by its real id; the null-address row the
      // pre-fix handler produced (reading the now-absent `_reward`) is absent.
      const rewardTokenEntity = await indexer.Token.get(
        TokenId(chainId, rewardTokenAddress),
      );
      expect(rewardTokenEntity).toBeDefined();

      const undefinedToken = await indexer.Token.get(`${chainId}-undefined`);
      expect(undefinedToken).toBeUndefined();
    });
  });
});
