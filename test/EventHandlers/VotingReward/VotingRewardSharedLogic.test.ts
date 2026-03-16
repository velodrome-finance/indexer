import type { Token } from "generated";
import * as LiquidityPoolAggregatorModule from "../../../src/Aggregators/LiquidityPoolAggregator";
import { PoolAddressField } from "../../../src/Aggregators/LiquidityPoolAggregator";
import { toChecksumAddress } from "../../../src/Constants";
import {
  type VotingRewardClaimRewardsData,
  loadVotingRewardData,
  processVotingRewardClaimRewards,
} from "../../../src/EventHandlers/VotingReward/VotingRewardSharedLogic";
import { setupCommon } from "../Pool/common";

describe("VotingRewardSharedLogic", () => {
  const mockChainId = 8453;
  const mockUserAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const mockVotingRewardAddress = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );
  const mockRewardTokenAddress = toChecksumAddress(
    "0x4444444444444444444444444444444444444444",
  );
  const mockTimestamp = new Date("2024-01-01T00:00:00Z");

  // biome-ignore lint/suspicious/noExplicitAny: Mock context for testing - complex type intersection would be overly verbose
  let mockContext: any;

  beforeEach(() => {
    // Mock token storage
    const tokenStorage = new Map<string, Token>();

    mockContext = {
      log: {
        error: () => {},
        warn: () => {},
        info: () => {},
      },
      Token: {
        get: async (id: string) => tokenStorage.get(id),
        set: (token: Token) => {
          tokenStorage.set(token.id, token);
        },
      },
      effect: async (fn: { name: string }, params: unknown) => {
        // Mock token effects
        if (fn.name === "getTokenPrice") {
          return {
            pricePerUSDNew: 1000000000000000000n, // 1 USD
            priceOracleType: "v3",
          };
        }
        // Mock getTokenDetails effect
        if (fn.name === "getTokenDetails") {
          return {
            name: "Test Token",
            symbol: "TEST",
            decimals: 6,
          };
        }
        return {};
      },
      TokenPriceSnapshot: {
        set: () => {},
      },
      isPreload: false,
    };
  });

  describe("processVotingRewardClaimRewards", () => {
    it("should calculate USD values correctly for bribe rewards", async () => {
      const data: VotingRewardClaimRewardsData = {
        votingRewardAddress: mockVotingRewardAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 12345,
        timestamp: Math.floor(mockTimestamp.getTime() / 1000),
        reward: mockRewardTokenAddress,
        amount: 1000000n, // 1 USDC (6 decimals)
      };

      const result = await processVotingRewardClaimRewards(
        data,
        mockContext,
        PoolAddressField.BRIBE_VOTING_REWARD_ADDRESS,
      );

      // For bribe rewards, should populate bribe fields
      expect(result.poolDiff).toMatchObject({
        incrementalTotalBribeClaimed: 1000000n,
        incrementalTotalBribeClaimedUSD: 1000000000000000000n, // 1 USD in 18 decimals
        incrementalTotalFeeRewardClaimed: 0n,
        incrementalTotalFeeRewardClaimedUSD: 0n,
        lastUpdatedTimestamp: mockTimestamp,
      });
    });

    it("should distinguish between bribe and fee rewards", async () => {
      const data: VotingRewardClaimRewardsData = {
        votingRewardAddress: mockVotingRewardAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 12345,
        timestamp: Math.floor(mockTimestamp.getTime() / 1000),
        reward: mockRewardTokenAddress,
        amount: 2000000n, // 2 USDC
      };

      const result = await processVotingRewardClaimRewards(
        data,
        mockContext,
        PoolAddressField.FEE_VOTING_REWARD_ADDRESS,
      );

      // For fee rewards, should populate fee fields
      expect(result.poolDiff).toMatchObject({
        incrementalTotalBribeClaimed: 0n,
        incrementalTotalBribeClaimedUSD: 0n,
        incrementalTotalFeeRewardClaimed: 2000000n,
        incrementalTotalFeeRewardClaimedUSD: 2000000000000000000n, // 2 USD in 18 decimals
        lastUpdatedTimestamp: mockTimestamp,
      });
    });

    it("should handle different token decimals correctly", async () => {
      // Mock a token with 18 decimals
      mockContext.effect = async (fn: { name: string }, params: unknown) => {
        if (fn.name === "getTokenPrice") {
          return {
            pricePerUSDNew: 1000000000000000000n, // 1 USD
            priceOracleType: "v3",
          };
        }
        // Mock getTokenDetails effect for token creation
        if (fn.name === "getTokenDetails") {
          return {
            name: "Test Token",
            symbol: "TEST",
            decimals: 18,
          };
        }
        return {};
      };

      const data: VotingRewardClaimRewardsData = {
        votingRewardAddress: mockVotingRewardAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 12345,
        timestamp: Math.floor(mockTimestamp.getTime() / 1000),
        reward: mockRewardTokenAddress,
        amount: 1000000000000000000n, // 1 token with 18 decimals
      };

      const result = await processVotingRewardClaimRewards(
        data,
        mockContext,
        PoolAddressField.BRIBE_VOTING_REWARD_ADDRESS,
      );

      expect(result.poolDiff?.incrementalTotalBribeClaimedUSD).toBe(
        1000000000000000000n,
      );
    });
  });

  describe("loadVotingRewardData", () => {
    it("should call loadPoolData with pool.poolAddress not pool.id", async () => {
      const common = setupCommon();
      const {
        mockToken0Data,
        mockToken1Data,
        createMockLiquidityPoolAggregator,
      } = common;

      const chainId = 10;
      const pool = createMockLiquidityPoolAggregator({
        chainId,
        bribeVotingRewardAddress: mockVotingRewardAddress,
      });

      const loadPoolDataSpy = vi.spyOn(
        LiquidityPoolAggregatorModule,
        "loadPoolData",
      );

      const context = {
        log: { error: () => {}, warn: () => {}, info: () => {} },
        LiquidityPoolAggregator: {
          getWhere: async (q: {
            bribeVotingRewardAddress?: { _eq: string };
          }) =>
            q.bribeVotingRewardAddress?._eq === mockVotingRewardAddress
              ? [pool]
              : [],
          get: async (poolId: string) =>
            poolId === pool.id ? pool : undefined,
        },
        Token: {
          get: async (id: string) =>
            id === pool.token0_id
              ? mockToken0Data
              : id === pool.token1_id
                ? mockToken1Data
                : undefined,
        },
      } as unknown as import("generated").handlerContext;

      const data = {
        votingRewardAddress: mockVotingRewardAddress,
        userAddress: mockUserAddress,
        chainId,
        blockNumber: 12345,
        timestamp: Math.floor(mockTimestamp.getTime() / 1000),
      };

      const result = await loadVotingRewardData(
        data,
        context,
        "BribesVotingReward.ClaimRewards",
        PoolAddressField.BRIBE_VOTING_REWARD_ADDRESS,
      );

      expect(result).not.toBeNull();
      expect(loadPoolDataSpy).toHaveBeenCalledTimes(1);
      expect(loadPoolDataSpy).toHaveBeenCalledWith(
        pool.poolAddress,
        chainId,
        context,
      );

      loadPoolDataSpy.mockRestore();
    });
  });
});
