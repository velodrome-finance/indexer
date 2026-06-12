import type { Token } from "envio";
import { createTestIndexer } from "envio";
import { TokenId, toChecksumAddress } from "../../../src/Constants";
import * as VotingRewardSharedLogic from "../../../src/EventHandlers/VotingReward/VotingRewardSharedLogic";
import { type MockPool, setupCommon } from "../Pool/common";

describe("BribesVotingReward Events", () => {
  const {
    mockToken0Data,
    mockToken1Data,
    mockLiquidityPoolData,
    createMockPool,
    createMockUserStatsPerPool,
  } = setupCommon();
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const chainId = 10 as const;
  const votingRewardAddress = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );
  const userAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const rewardTokenAddress = toChecksumAddress(
    "0x4444444444444444444444444444444444444444",
  );

  let indexer: ReturnType<typeof createTestIndexer>;
  let liquidityPool: MockPool;
  let userStats: ReturnType<
    ReturnType<typeof setupCommon>["createMockUserStatsPerPool"]
  >;
  let rewardToken: Token;

  beforeEach(() => {
    vi.restoreAllMocks();
    indexer = createTestIndexer();

    // Set up liquidity pool with bribe voting reward address
    liquidityPool = createMockPool({
      bribeVotingRewardAddress: toChecksumAddress(votingRewardAddress),
      feeVotingRewardAddress: "",
    });

    // Set up user stats
    userStats = createMockUserStatsPerPool({
      userAddress: userAddress,
      poolAddress: poolAddress,
      chainId: chainId,
      lastActivityTimestamp: new Date(1000000 * 1000),
    });

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
      // Issue #862: a whitelisted token with a real price has, by construction,
      // had at least one successful oracle write — `lastSuccessfulPriceTimestamp`
      // must be set in lockstep with `lastUpdatedTimestamp` for the throttle to
      // preserve `pricePerUSDNew` (the heal-on-read otherwise bypasses it).
      lastSuccessfulPriceTimestamp: new Date(1000000 * 1000),
    } as Token;

    // Set up entities in test indexer
    indexer.Pool.set(liquidityPool);
    indexer.UserStatsPerPool.set(userStats);
    indexer.Token.set(mockToken0Data as Token);
    indexer.Token.set(mockToken1Data as Token);
    indexer.Token.set(rewardToken);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ClaimRewards Event", () => {
    beforeEach(async () => {
      // Mock the getTokenPriceData effect
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

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "BribesVotingReward",
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
      const updatedPool = await indexer.Pool.get(mockLiquidityPoolData.id);
      expect(updatedPool).toBeDefined();
      // The actual values depend on the price calculation, but should be updated
      expect(updatedPool?.totalBribeClaimedUSD).toBeGreaterThan(0n);
    });

    it("should update user stats with bribe claimed", async () => {
      const updatedUser = await indexer.UserStatsPerPool.get(userStats.id);
      expect(updatedUser).toBeDefined();
      expect(updatedUser?.totalBribeClaimedUSD).toBeGreaterThan(0n);
    });
  });
});
