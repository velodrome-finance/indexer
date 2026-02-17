import type { PublicClient } from "viem";
import { MockDb } from "../../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
  handlerContext,
} from "../../../generated/src/Types.gen";
import {
  CHAIN_CONSTANTS,
  TokenIdByChain,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  type GaugeEventData,
  processGaugeClaimRewards,
  processGaugeDeposit,
  processGaugeWithdraw,
} from "../../../src/EventHandlers/Gauges/GaugeSharedLogic";
import { setupCommon } from "../Pool/common";

describe("GaugeSharedLogic", () => {
  const { mockToken0Data, mockToken1Data, createMockLiquidityPoolAggregator } =
    setupCommon();
  const mockChainId = 8453;
  const mockPoolAddress = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const mockGaugeAddress = toChecksumAddress(
    "0x5555555555555555555555555555555555555555",
  );
  const mockUserAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const mockTimestamp = new Date(1000000 * 1000);

  const mockToken0: Token = {
    ...mockToken0Data,
    id: "0x3333333333333333333333333333333333333333-8453",
    address: toChecksumAddress("0x3333333333333333333333333333333333333333"),
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
    address: toChecksumAddress("0x4444444444444444444444444444444444444444"),
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
  let mockRewardToken: Token;
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let updatedDB: ReturnType<typeof MockDb.createMockDb>;
  // biome-ignore lint/suspicious/noExplicitAny: Mock context for testing - complex type intersection would be overly verbose
  let mockContext: any;
  let originalChainConstants: (typeof CHAIN_CONSTANTS)[typeof mockChainId];

  beforeEach(() => {
    // Store original CHAIN_CONSTANTS before mutation to restore in afterEach
    originalChainConstants = CHAIN_CONSTANTS[mockChainId];
    // Mock CHAIN_CONSTANTS for the test
    (
      CHAIN_CONSTANTS as unknown as Record<
        number,
        {
          eth_client?: PublicClient;
          rewardToken?: (blockNumber: number) => string;
          oracle?: {
            getType: (blockNumber: number) => string;
            getAddress: (priceOracleType: string) => string;
            startBlock: number;
            priceConnectors: unknown[];
          };
        }
      >
    )[mockChainId] = {
      rewardToken: () => "0x940181a94A35A4569E4529A3CDfB74e38FD98631", // AERO on Base
      oracle: {
        getType: () => "v3", // Mock oracle type
        getAddress: () => "0x1234567890123456789012345678901234567890", // Mock oracle address
        startBlock: 0, // Mock start block
        priceConnectors: [], // Mock connectors
      },
    };

    mockLiquidityPoolAggregator = createMockLiquidityPoolAggregator({
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      name: "USDC/USDT",
      token0_id: mockToken0.id,
      token1_id: mockToken1.id,
      token0_address: mockToken0.address,
      token1_address: mockToken1.address,
      isStable: true,
      reserve0: 1000000000n, // 1000 tokens (6 decimals) - enough for 100 LP tokens to represent 100 tokens each
      reserve1: 1000000000n, // 1000 tokens (6 decimals)
      totalLiquidityUSD: 2000000000000000000000000n, // 2M USD in 18 decimals
      token0Price: 1000000000000000000n,
      token1Price: 1000000000000000000n,
      gaugeAddress: mockGaugeAddress,
      gaugeIsAlive: true,
      currentLiquidityStaked: 0n,
      currentLiquidityStakedUSD: 0n,
      lastUpdatedTimestamp: mockTimestamp,
      lastSnapshotTimestamp: mockTimestamp,
      isCL: false, // V2 pool
      totalLPTokenSupply: 1000000000000000000000n, // 1000 LP tokens (18 decimals) for V2 staked liquidity USD
    });

    const { createMockUserStatsPerPool } = setupCommon();
    mockUserStatsPerPool = createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      currentLiquidityUSD: 1000000000000000000000n, // 1K USD in 18 decimals
      totalLiquidityAddedUSD: 1000000000000000000000n,
      firstActivityTimestamp: mockTimestamp,
      lastActivityTimestamp: mockTimestamp,
    });

    // Create reward token (AERO on Base)
    const rewardTokenAddress = toChecksumAddress(
      "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    );
    mockRewardToken = {
      id: TokenIdByChain(rewardTokenAddress, mockChainId),
      address: toChecksumAddress(rewardTokenAddress),
      name: "AERO",
      symbol: "AERO",
      chainId: mockChainId,
      decimals: 18n,
      pricePerUSDNew: 1000000000000000000n, // 1 USD in 18 decimals
      lastUpdatedTimestamp: mockTimestamp,
      isWhitelisted: true,
    };

    mockDb = MockDb.createMockDb();
    updatedDB = mockDb.entities.LiquidityPoolAggregator.set(
      mockLiquidityPoolAggregator,
    );
    updatedDB = updatedDB.entities.Token.set(mockToken0);
    updatedDB = updatedDB.entities.Token.set(mockToken1);
    updatedDB = updatedDB.entities.Token.set(mockRewardToken);
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
              const pool = updatedDB.entities.LiquidityPoolAggregator.get(
                mockLiquidityPoolAggregator.id,
              );
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
        set: (entity: any) => {
          updatedDB = updatedDB.entities.Token.set(entity);
          return updatedDB;
        },
      },
      log: {
        error: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
      },
      // biome-ignore lint/suspicious/noExplicitAny: Mock effect function for testing
      effect: async (fn: any, params: any) => {
        // Mock token effects
        if (fn.name === "getTokenPrice") {
          return {
            pricePerUSDNew: 1000000000000000000n, // 1 USD
          };
        }
        // Mock getTokenDetails effect
        if (fn.name === "getTokenDetails") {
          return {
            name: "AERO",
            symbol: "AERO",
            decimals: 18,
          };
        }
        return {};
      },
      NonFungiblePosition: {
        getWhere: {
          tokenId: {
            eq: async (tokenId: bigint) => {
              // Return empty array for V2 pools (no positions)
              return [];
            },
          },
        },
      },
      TokenPriceSnapshot: {
        set: () => {},
      },
      isPreload: false,
    };
  });

  afterEach(() => {
    // Restore original CHAIN_CONSTANTS to prevent test pollution
    (CHAIN_CONSTANTS as Record<number, unknown>)[mockChainId] =
      originalChainConstants;
  });

  describe("processGaugeDeposit", () => {
    it("should process gauge deposit correctly", async () => {
      const depositData: GaugeEventData = {
        gaugeAddress: mockGaugeAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 100000000000000000000n, // 100 LP tokens (18 decimals)
      };

      await processGaugeDeposit(depositData, mockContext, "TestGaugeDeposit");

      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.numberOfGaugeDeposits).toBe(1n);
      expect(updatedPool?.currentLiquidityStaked).toBe(100000000000000000000n);
      // For V2 pools: amount0 = (100 LP * 1000000000 reserve0) / 1000 totalSupply = 100000000 (6 decimals = 100 tokens)
      // amount1 = (100 LP * 1000000000 reserve1) / 1000 totalSupply = 100000000 (6 decimals = 100 tokens)
      // Normalized to 18 decimals: 100000000 * 10^12 = 100000000000000000000n
      // USD for token0: (100000000000000000000n * 1000000000000000000n) / 10^18 = 100000000000000000000n
      // USD for token1: (100000000000000000000n * 1000000000000000000n) / 10^18 = 100000000000000000000n
      // Total: 200000000000000000000n (200 USD in 18 decimals)
      expect(updatedPool?.currentLiquidityStakedUSD).toBe(
        200000000000000000000n,
      );
      expect(updatedUser?.numberOfGaugeDeposits).toBe(1n);
      expect(updatedUser?.currentLiquidityStaked).toBe(100000000000000000000n);
      expect(updatedUser?.currentLiquidityStakedUSD).toBe(
        200000000000000000000n,
      );
    });
  });

  describe("processGaugeWithdraw", () => {
    it("should process gauge withdrawal correctly", async () => {
      const withdrawData: GaugeEventData = {
        gaugeAddress: mockGaugeAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 50000000000000000000n, // 50 LP tokens (18 decimals)
      };

      await processGaugeWithdraw(
        withdrawData,
        mockContext,
        "TestGaugeWithdraw",
      );

      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.numberOfGaugeWithdrawals).toBe(1n);
      expect(updatedPool?.currentLiquidityStaked).toBe(-50000000000000000000n);
      // For V2 pools: amount0 = (50 LP * 1000000000 reserve0) / 1000 totalSupply = 50000000 (6 decimals = 50 tokens)
      // amount1 = (50 LP * 1000000000 reserve1) / 1000 totalSupply = 50000000 (6 decimals = 50 tokens)
      // Normalized to 18 decimals: 50000000 * 10^12 = 50000000000000000000n
      // USD for token0: (50000000000000000000n * 1000000000000000000n) / 10^18 = 50000000000000000000n
      // USD for token1: (50000000000000000000n * 1000000000000000000n) / 10^18 = 50000000000000000000n
      // Total: 100000000000000000000n (100 USD in 18 decimals), negative for withdrawal
      expect(updatedPool?.currentLiquidityStakedUSD).toBe(
        -100000000000000000000n,
      );
      expect(updatedUser?.numberOfGaugeWithdrawals).toBe(1n);
      expect(updatedUser?.currentLiquidityStaked).toBe(-50000000000000000000n);
      expect(updatedUser?.currentLiquidityStakedUSD).toBe(
        -100000000000000000000n,
      );
    });
  });

  describe("processGaugeClaimRewards", () => {
    it("should process gauge reward claim correctly", async () => {
      const claimData: GaugeEventData = {
        gaugeAddress: mockGaugeAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 1000000000000000000000n, // 1000 reward tokens (18 decimals)
      };

      await processGaugeClaimRewards(
        claimData,
        mockContext,
        "TestGaugeClaimRewards",
      );

      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.numberOfGaugeRewardClaims).toBe(1n);
      expect(updatedPool?.totalGaugeRewardsClaimed).toBe(
        1000000000000000000000n,
      );
      // calculateTotalUSD(amount, 0n, rewardToken, undefined)
      // amount = 1000 tokens (18 decimals), price = 1 USD
      // normalized = 1000 * 10^18 / 10^18 = 1000
      // USD = 1000 * 1 USD = 1000000000000000000000 (1000 USD in 18 decimals)
      expect(updatedPool?.totalGaugeRewardsClaimedUSD).toBe(
        1000000000000000000000n,
      );
      expect(updatedUser?.numberOfGaugeRewardClaims).toBe(1n);
      expect(updatedUser?.totalGaugeRewardsClaimed).toBe(
        1000000000000000000000n,
      );
      expect(updatedUser?.totalGaugeRewardsClaimedUSD).toBe(
        1000000000000000000000n,
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle missing pool gracefully", async () => {
      const depositData: GaugeEventData = {
        gaugeAddress: toChecksumAddress(
          "0x9999999999999999999999999999999999999999",
        ), // Non-existent gauge
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 100000000000000000000n,
      };

      // Should not throw, but should log error and return early
      await processGaugeDeposit(depositData, mockContext, "TestGaugeDeposit");

      // Pool and user should remain unchanged
      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.numberOfGaugeDeposits).toBe(0n);
      expect(updatedUser?.numberOfGaugeDeposits).toBe(0n);
    });

    it("should handle missing pool data gracefully in deposit", async () => {
      // Create a context that returns null for pool data
      const mockContextWithNullPool = {
        ...mockContext,
        LiquidityPoolAggregator: {
          ...mockContext.LiquidityPoolAggregator,
          get: () => Promise.resolve(undefined), // Return null to simulate missing pool
        },
      };

      const depositData: GaugeEventData = {
        gaugeAddress: mockGaugeAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 100000000000000000000n,
      };

      // Should not throw, but should log error and return early
      await processGaugeDeposit(
        depositData,
        mockContextWithNullPool as unknown as handlerContext,
        "TestGaugeDeposit",
      );

      // Pool and user should remain unchanged
      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.numberOfGaugeDeposits).toBe(0n);
      expect(updatedUser?.numberOfGaugeDeposits).toBe(0n);
    });

    it("should handle missing pool data gracefully in withdraw", async () => {
      // Create a context that returns null for pool data
      const mockContextWithNullPool = {
        ...mockContext,
        LiquidityPoolAggregator: {
          ...mockContext.LiquidityPoolAggregator,
          get: () => Promise.resolve(undefined), // Return null to simulate missing pool
        },
      };

      const withdrawData: GaugeEventData = {
        gaugeAddress: mockGaugeAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 50000000000000000000n,
      };

      // Should not throw, but should log error and return early
      await processGaugeWithdraw(
        withdrawData,
        mockContextWithNullPool as unknown as handlerContext,
        "TestGaugeWithdraw",
      );

      // Pool and user should remain unchanged
      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.numberOfGaugeWithdrawals).toBe(0n);
      expect(updatedUser?.numberOfGaugeWithdrawals).toBe(0n);
    });

    it("should handle missing pool data gracefully in claim rewards", async () => {
      // Create a context that returns null for pool data
      const mockContextWithNullPool = {
        ...mockContext,
        LiquidityPoolAggregator: {
          ...mockContext.LiquidityPoolAggregator,
          get: () => Promise.resolve(undefined), // Return null to simulate missing pool
        },
      };

      const claimData: GaugeEventData = {
        gaugeAddress: mockGaugeAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 1000000000000000000000n,
      };

      // Should not throw, but should log error and return early
      await processGaugeClaimRewards(
        claimData,
        mockContextWithNullPool as unknown as handlerContext,
        "TestGaugeClaimRewards",
      );

      // Pool and user should remain unchanged
      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.numberOfGaugeRewardClaims).toBe(0n);
      expect(updatedUser?.numberOfGaugeRewardClaims).toBe(0n);
    });

    it("should handle missing reward token gracefully in claim rewards", async () => {
      // Create a context that returns null for reward token
      const mockContextWithNullRewardToken = {
        ...mockContext,
        Token: {
          ...mockContext.Token,
          get: (id: string) => {
            // Return null for reward token, but return other tokens
            if (id === TokenIdByChain(mockRewardToken.address, mockChainId)) {
              return Promise.resolve(undefined);
            }
            return updatedDB.entities.Token.get(id);
          },
        },
      };

      const claimData: GaugeEventData = {
        gaugeAddress: mockGaugeAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 1000000000000000000000n,
      };

      // Should not throw, but should log error and return early
      await processGaugeClaimRewards(
        claimData,
        mockContextWithNullRewardToken as unknown as handlerContext,
        "TestGaugeClaimRewards",
      );

      // Pool and user should remain unchanged
      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.numberOfGaugeRewardClaims).toBe(0n);
      expect(updatedUser?.numberOfGaugeRewardClaims).toBe(0n);
    });
  });
});
