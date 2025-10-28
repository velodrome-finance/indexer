import { expect } from "chai";
import { MockDb } from "../../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
  handlerContext,
} from "../../../generated/src/Types.gen";
import { toChecksumAddress } from "../../../src/Constants";
import {
  type GaugeClaimRewardsData,
  type GaugeDepositData,
  type GaugeWithdrawData,
  processGaugeClaimRewards,
  processGaugeDeposit,
  processGaugeWithdraw,
} from "../../../src/EventHandlers/Gauges/GaugeSharedLogic";
import { setupCommon } from "../Pool/common";

describe("GaugeSharedLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const mockChainId = 8453;
  const mockPoolAddress = "0x1111111111111111111111111111111111111111";
  const mockGaugeAddress = "0x5555555555555555555555555555555555555555";
  const mockUserAddress = "0x2222222222222222222222222222222222222222";
  const mockTimestamp = new Date(1000000 * 1000);

  const mockToken0: Token = {
    ...mockToken0Data,
    id: "0x3333333333333333333333333333333333333333-8453",
    address: "0x3333333333333333333333333333333333333333",
    symbol: "USDC",
    name: "USD Coin",
    chainId: mockChainId,
    decimals: 6n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD in 18 decimals
    lastUpdatedTimestamp: mockTimestamp,
    isWhitelisted: true,
  };

  const mockToken1: Token = {
    ...mockToken1Data,
    id: "0x4444444444444444444444444444444444444444-8453",
    address: "0x4444444444444444444444444444444444444444",
    symbol: "USDT",
    name: "Tether USD",
    chainId: mockChainId,
    decimals: 6n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD in 18 decimals
    lastUpdatedTimestamp: mockTimestamp,
    isWhitelisted: true,
  };

  let mockLiquidityPoolAggregator: LiquidityPoolAggregator;
  let mockUserStatsPerPool: UserStatsPerPool;
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let updatedDB: ReturnType<typeof MockDb.createMockDb>;
  // biome-ignore lint/suspicious/noExplicitAny: Mock context for testing - complex type intersection would be overly verbose
  let mockContext: any;

  beforeEach(() => {
    mockLiquidityPoolAggregator = {
      ...mockLiquidityPoolData,
      id: mockPoolAddress,
      chainId: mockChainId,
      name: "USDC/USDT",
      token0_id: mockToken0.id,
      token1_id: mockToken1.id,
      token0_address: mockToken0.address,
      token1_address: mockToken1.address,
      isStable: true,
      reserve0: 1000000n,
      reserve1: 1000000n,
      totalLiquidityUSD: 2000000000000000000000000n, // 2M USD in 18 decimals
      token0Price: 1000000000000000000n,
      token1Price: 1000000000000000000n,
      gaugeAddress: mockGaugeAddress,
      gaugeIsAlive: true,
      token0IsWhitelisted: true,
      token1IsWhitelisted: true,
      lastUpdatedTimestamp: mockTimestamp,
      lastSnapshotTimestamp: mockTimestamp,
    };

    mockUserStatsPerPool = {
      id: `${toChecksumAddress(mockUserAddress)}_${toChecksumAddress(mockPoolAddress)}_${mockChainId}`,
      userAddress: toChecksumAddress(mockUserAddress),
      poolAddress: toChecksumAddress(mockPoolAddress),
      chainId: mockChainId,
      currentLiquidityUSD: 1000000000000000000000n, // 1K USD in 18 decimals
      currentLiquidityToken0: 500000000n, // 500 USDC (6 decimals)
      currentLiquidityToken1: 500000000n, // 500 USDT (6 decimals)
      totalLiquidityAddedUSD: 1000000000000000000000n,
      totalLiquidityRemovedUSD: 0n,
      totalFeesContributedUSD: 0n,
      totalFeesContributed0: 0n,
      totalFeesContributed1: 0n,
      numberOfSwaps: 0n,
      totalSwapVolumeUSD: 0n,
      numberOfFlashLoans: 0n,
      totalFlashLoanVolumeUSD: 0n,
      numberOfGaugeDeposits: 0n,
      numberOfGaugeWithdrawals: 0n,
      numberOfGaugeRewardClaims: 0n,
      totalGaugeRewardsClaimedUSD: 0n,
      totalGaugeRewardsClaimed: 0n,
      currentLiquidityStakedUSD: 0n,
      numberOfVotes: 0n,
      currentVotingPower: 0n,

      // Voting Reward Claims
      totalBribeClaimed: 0n,
      totalBribeClaimedUSD: 0n,
      totalFeeRewardClaimed: 0n,
      totalFeeRewardClaimedUSD: 0n,
      veNFTamountStaked: 0n,

      firstActivityTimestamp: mockTimestamp,
      lastActivityTimestamp: mockTimestamp,
    };

    mockDb = MockDb.createMockDb();
    updatedDB = mockDb.entities.LiquidityPoolAggregator.set(
      mockLiquidityPoolAggregator,
    );
    updatedDB = updatedDB.entities.Token.set(mockToken0);
    updatedDB = updatedDB.entities.Token.set(mockToken1);
    updatedDB = updatedDB.entities.UserStatsPerPool.set(mockUserStatsPerPool);

    // Create a proper mock context
    mockContext = {
      LiquidityPoolAggregator: {
        get: (id: string) => updatedDB.entities.LiquidityPoolAggregator.get(id),
        // biome-ignore lint/suspicious/noExplicitAny: Mock entity for testing
        set: (entity: any) => {
          updatedDB = updatedDB.entities.LiquidityPoolAggregator.set(entity);
          return updatedDB;
        },
        getWhere: {
          gaugeAddress: {
            eq: async (gaugeAddress: string) => {
              // Find pools with matching gauge address
              const pool =
                updatedDB.entities.LiquidityPoolAggregator.get(mockPoolAddress);
              return pool && pool.gaugeAddress === gaugeAddress ? [pool] : [];
            },
          },
        },
      },
      UserStatsPerPool: {
        get: (id: string) => updatedDB.entities.UserStatsPerPool.get(id),
        // biome-ignore lint/suspicious/noExplicitAny: Mock entity for testing
        set: (entity: any) => {
          updatedDB = updatedDB.entities.UserStatsPerPool.set(entity);
          return updatedDB;
        },
        getWhere: {
          userAddress: {
            eq: async (userAddress: string) => {
              const userStats = updatedDB.entities.UserStatsPerPool.get(
                mockUserStatsPerPool.id,
              );
              return userStats && userStats.userAddress === userAddress
                ? [userStats]
                : [];
            },
          },
        },
      },
      Token: {
        get: (id: string) => updatedDB.entities.Token.get(id),
        // biome-ignore lint/suspicious/noExplicitAny: Mock entity for testing
        set: (entity: any) => updatedDB.entities.Token.set(entity),
      },
      log: {
        error: () => {},
        debug: () => {},
        info: () => {},
      },
      // biome-ignore lint/suspicious/noExplicitAny: Mock effect function for testing
      effect: async (fn: any, params: any) => {
        // Mock the getTokenPriceData effect
        if (fn.name === "getTokenPriceData") {
          return {
            decimals: 18n,
            pricePerUSDNew: 1000000000000000000n, // 1 USD
          };
        }
        return {};
      },
      isPreload: false,
    };
  });

  describe("processGaugeDeposit", () => {
    it("should process gauge deposit correctly", async () => {
      const depositData: GaugeDepositData = {
        gaugeAddress: mockGaugeAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 100000000000000000000n, // 100 USD
      };

      await processGaugeDeposit(depositData, mockContext, "TestGaugeDeposit");

      const updatedPool =
        updatedDB.entities.LiquidityPoolAggregator.get(mockPoolAddress);
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.numberOfGaugeDeposits).to.equal(1n);
      expect(updatedPool?.currentLiquidityStakedUSD).to.equal(
        100000000000000000000n,
      );
      expect(updatedUser?.numberOfGaugeDeposits).to.equal(1n);
      expect(updatedUser?.currentLiquidityStakedUSD).to.equal(
        100000000000000000000n,
      );
    });
  });

  describe("processGaugeWithdraw", () => {
    it("should process gauge withdrawal correctly", async () => {
      const withdrawData: GaugeWithdrawData = {
        gaugeAddress: mockGaugeAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 50000000000000000000n, // 50 USD
      };

      await processGaugeWithdraw(
        withdrawData,
        mockContext,
        "TestGaugeWithdraw",
      );

      const updatedPool =
        updatedDB.entities.LiquidityPoolAggregator.get(mockPoolAddress);
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.numberOfGaugeWithdrawals).to.equal(1n);
      expect(updatedPool?.currentLiquidityStakedUSD).to.equal(
        -50000000000000000000n,
      );
      expect(updatedUser?.numberOfGaugeWithdrawals).to.equal(1n);
      expect(updatedUser?.currentLiquidityStakedUSD).to.equal(
        -50000000000000000000n,
      );
    });
  });

  describe("processGaugeClaimRewards", () => {
    it("should process gauge reward claim correctly", async () => {
      const claimData: GaugeClaimRewardsData = {
        gaugeAddress: mockGaugeAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 1000000000000000000000n, // 1000 reward tokens
      };

      await processGaugeClaimRewards(
        claimData,
        mockContext,
        "TestGaugeClaimRewards",
      );

      const updatedPool =
        updatedDB.entities.LiquidityPoolAggregator.get(mockPoolAddress);
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.numberOfGaugeRewardClaims).to.equal(1n);
      expect(updatedPool?.totalGaugeRewardsClaimed).to.equal(
        1000000000000000000000n,
      );
      expect(updatedUser?.numberOfGaugeRewardClaims).to.equal(1n);
      expect(updatedUser?.totalGaugeRewardsClaimed).to.equal(
        1000000000000000000000n,
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle missing pool gracefully", async () => {
      const depositData: GaugeDepositData = {
        gaugeAddress: "0x9999999999999999999999999999999999999999", // Non-existent gauge
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 100000000000000000000n,
      };

      // Should not throw, but should log error and return early
      await processGaugeDeposit(depositData, mockContext, "TestGaugeDeposit");

      // Pool and user should remain unchanged
      const updatedPool =
        updatedDB.entities.LiquidityPoolAggregator.get(mockPoolAddress);
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.numberOfGaugeDeposits).to.equal(0n);
      expect(updatedUser?.numberOfGaugeDeposits).to.equal(0n);
    });
  });
});
