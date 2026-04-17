import { TickMath } from "@uniswap/v3-sdk";
import type { LiquidityPoolAggregator, Token, handlerContext } from "generated";
import type { PublicClient } from "viem";
import { MockDb } from "../../../generated/src/TestHelpers.gen";
import {
  CHAIN_CONSTANTS,
  NonFungiblePositionId,
  TokenId,
  UserStatsPerPoolId,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  type GaugeEventData,
  findPoolOrSkipRootGauge,
  isRootGauge,
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
  let mockUserStatsPerPool: ReturnType<
    ReturnType<typeof setupCommon>["createMockUserStatsPerPool"]
  >;
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
      id: TokenId(mockChainId, rewardTokenAddress),
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
        // biome-ignore lint/suspicious/noExplicitAny: Mock entity for testing
        getWhere: async (params: any) => {
          if (params.gaugeAddress?._eq) {
            const pool = updatedDB.entities.LiquidityPoolAggregator.get(
              mockLiquidityPoolAggregator.id,
            );
            return pool && pool.gaugeAddress === params.gaugeAddress._eq
              ? [pool]
              : [];
          }
          return [];
        },
      },
      UserStatsPerPool: {
        get: (id: string) => updatedDB.entities.UserStatsPerPool.get(id),
        // biome-ignore lint/suspicious/noExplicitAny: Mock entity for testing
        set: (entity: any) => {
          updatedDB = updatedDB.entities.UserStatsPerPool.set(entity);
          return updatedDB;
        },
        // biome-ignore lint/suspicious/noExplicitAny: Mock entity for testing
        getWhere: async (params: any) => {
          if (params.userAddress?._eq) {
            const userStats = updatedDB.entities.UserStatsPerPool.get(
              mockUserStatsPerPool.id,
            );
            return userStats && userStats.userAddress === params.userAddress._eq
              ? [userStats]
              : [];
          }
          return [];
        },
      },
      UserStatsPerPoolSnapshot: { set: () => {} },
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
        getWhere: async () => [],
      },
      TokenPriceSnapshot: {
        set: () => {},
      },
      RootGauge_RootPool: {
        getWhere: async () => [],
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
      // User staked USD is computed at snapshot time (non-CL pro-rata)
      expect(updatedUser?.currentLiquidityStakedUSD).toBe(
        200000000000000000000n,
      );
    });

    it("should preserve existing pool staked USD when non-CL valuation is unavailable", async () => {
      mockLiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        currentLiquidityStakedUSD: 777000000000000000000n,
        totalLPTokenSupply: 0n,
      };
      mockUserStatsPerPool = {
        ...mockUserStatsPerPool,
        currentLiquidityStakedUSD: 333000000000000000000n,
      };

      updatedDB = updatedDB.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );
      updatedDB = updatedDB.entities.UserStatsPerPool.set(mockUserStatsPerPool);

      const depositData: GaugeEventData = {
        gaugeAddress: mockGaugeAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 100000000000000000000n,
      };

      await processGaugeDeposit(depositData, mockContext, "TestGaugeDeposit");

      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      // Pool staked USD is preserved (undefined from event → keeps old value)
      expect(updatedPool?.currentLiquidityStaked).toBe(100000000000000000000n);
      expect(updatedPool?.currentLiquidityStakedUSD).toBe(
        777000000000000000000n,
      );
      // User staked USD is recomputed at snapshot time; totalSupply=0 → returns 0
      expect(updatedUser?.currentLiquidityStaked).toBe(100000000000000000000n);
      expect(updatedUser?.currentLiquidityStakedUSD).toBe(0n);
    });
  });

  describe("processGaugeWithdraw", () => {
    it("should process gauge withdrawal correctly", async () => {
      await processGaugeDeposit(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 99,
          timestamp: 999999,
          amount: 100000000000000000000n, // 100 LP
        },
        mockContext,
        "TestGaugeDeposit",
      );

      await processGaugeWithdraw(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 100,
          timestamp: 1000000,
          amount: 50000000000000000000n, // 50 LP tokens (18 decimals)
        },
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
      expect(updatedPool?.currentLiquidityStaked).toBe(50000000000000000000n); // 100 - 50
      // Derived USD: 50 LP at reserves 1e9/1e9, totalSupply 1000e18, 1 USD each → 100e18
      expect(updatedPool?.currentLiquidityStakedUSD).toBe(
        100000000000000000000n,
      );
      expect(updatedUser?.numberOfGaugeWithdrawals).toBe(1n);
      expect(updatedUser?.currentLiquidityStaked).toBe(50000000000000000000n);
      // User staked USD was set to 200 at deposit snapshot; withdraw is in the same
      // epoch so no new snapshot fires — value stays at deposit-time snapshot value
      expect(updatedUser?.currentLiquidityStakedUSD).toBe(
        200000000000000000000n,
      );
    });

    it("should overwrite staked USD with 0 on full withdraw when valuation succeeds", async () => {
      await processGaugeDeposit(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 99,
          timestamp: 999999,
          amount: 100000000000000000000n,
        },
        mockContext,
        "TestGaugeDeposit",
      );

      await processGaugeWithdraw(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 100,
          timestamp: 1000000,
          amount: 100000000000000000000n,
        },
        mockContext,
        "TestGaugeWithdraw",
      );

      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );

      expect(updatedPool?.currentLiquidityStaked).toBe(0n);
      expect(updatedPool?.currentLiquidityStakedUSD).toBe(0n);
      expect(updatedUser?.currentLiquidityStaked).toBe(0n);
      // User staked USD was set to 200 at deposit snapshot; withdraw is in the same
      // epoch so no new snapshot fires — value stays at deposit-time snapshot value
      expect(updatedUser?.currentLiquidityStakedUSD).toBe(
        200000000000000000000n,
      );
    });

    it("should derive non-negative currentLiquidityStakedUSD after deposit then partial withdraw", async () => {
      await processGaugeDeposit(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 100,
          timestamp: 1000000,
          amount: 100000000000000000000n, // 100 LP
        },
        mockContext,
        "TestGaugeDeposit",
      );
      await processGaugeWithdraw(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 101,
          timestamp: 1000001,
          amount: 50000000000000000000n, // 50 LP
        },
        mockContext,
        "TestGaugeWithdraw",
      );
      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );
      expect(updatedPool?.currentLiquidityStaked).toBe(50000000000000000000n); // 100 - 50
      // Derived USD: 50 LP at current reserves/prices = 100 USD (18 decimals)
      expect(updatedPool?.currentLiquidityStakedUSD).toBe(
        100000000000000000000n,
      );
      expect(updatedUser?.currentLiquidityStaked).toBe(50000000000000000000n);
      // User staked USD was set to 200 at deposit snapshot; withdraw is in the same
      // epoch so no new snapshot fires — value stays at deposit-time snapshot value
      expect(updatedUser?.currentLiquidityStakedUSD).toBe(
        200000000000000000000n,
      );
    });

    describe("withdraw exceeds current stake (issue #604)", () => {
      it("clamps to zero and records withdrawal when user has no prior indexed stake", async () => {
        // Simulate a missed Deposit attribution: user issues a Withdraw event for an
        // amount the indexer never saw deposited. Prior to the fix, this branch
        // silently skipped the update, leaving aggregates stuck forever.
        const logWarnSpy = vi.fn();
        const logErrorSpy = vi.fn();
        const ctx = {
          ...mockContext,
          log: {
            ...mockContext.log,
            warn: logWarnSpy,
            error: logErrorSpy,
          },
        };

        await processGaugeWithdraw(
          {
            gaugeAddress: mockGaugeAddress,
            userAddress: mockUserAddress,
            chainId: mockChainId,
            blockNumber: 100,
            timestamp: 1000000,
            amount: 50000000000000000000n,
          },
          ctx,
          "TestGaugeWithdraw",
        );

        const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
          mockLiquidityPoolAggregator.id,
        );
        const updatedUser = updatedDB.entities.UserStatsPerPool.get(
          mockUserStatsPerPool.id,
        );

        // Pool and user staked counters are clamped to zero (not left at a
        // dangling inflated value and not made negative).
        expect(updatedPool?.currentLiquidityStaked).toBe(0n);
        expect(updatedUser?.currentLiquidityStaked).toBe(0n);
        // The withdrawal itself is recorded so downstream counters stay honest.
        expect(updatedPool?.numberOfGaugeWithdrawals).toBe(1n);
        expect(updatedUser?.numberOfGaugeWithdrawals).toBe(1n);
        // Visibility: one warning, no error — event is handled, not skipped.
        expect(logWarnSpy).toHaveBeenCalledTimes(1);
        expect(logErrorSpy).not.toHaveBeenCalled();
      });

      it("clamps pool counter when pool is short but user has prior stake", async () => {
        // User has stake recorded but pool aggregate is behind — simulates a
        // partial-attribution inconsistency across the two aggregates.
        mockUserStatsPerPool = {
          ...mockUserStatsPerPool,
          currentLiquidityStaked: 100000000000000000000n,
        };
        updatedDB =
          updatedDB.entities.UserStatsPerPool.set(mockUserStatsPerPool);

        const logWarnSpy = vi.fn();
        const ctx = {
          ...mockContext,
          log: { ...mockContext.log, warn: logWarnSpy },
        };

        await processGaugeWithdraw(
          {
            gaugeAddress: mockGaugeAddress,
            userAddress: mockUserAddress,
            chainId: mockChainId,
            blockNumber: 100,
            timestamp: 1000000,
            amount: 50000000000000000000n,
          },
          ctx,
          "TestGaugeWithdraw",
        );

        const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
          mockLiquidityPoolAggregator.id,
        );
        const updatedUser = updatedDB.entities.UserStatsPerPool.get(
          mockUserStatsPerPool.id,
        );

        // Pool counter was 0 — clamped to 0 (can't go below).
        expect(updatedPool?.currentLiquidityStaked).toBe(0n);
        // User counter debits only what the pool can actually absorb so the
        // two aggregates stay consistent after clamping.
        expect(updatedUser?.currentLiquidityStaked).toBe(50000000000000000000n);
        expect(updatedPool?.numberOfGaugeWithdrawals).toBe(1n);
        expect(logWarnSpy).toHaveBeenCalledTimes(1);
      });
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

  describe("isRootGauge", () => {
    it("returns true when RootGauge_RootPool has a row for the gauge address", async () => {
      const rootGaugeAddress = toChecksumAddress(
        "0x923EC7E98706153Ce2c984DD802230476D4722B4",
      );
      const contextWithRootGauge = {
        ...mockContext,
        RootGauge_RootPool: {
          getWhere: async (params: { rootGaugeAddress?: { _eq: string } }) =>
            params.rootGaugeAddress?._eq === rootGaugeAddress
              ? [
                  {
                    id: "10-".concat(rootGaugeAddress),
                    rootChainId: 10,
                    rootGaugeAddress,
                    rootPoolAddress: "0x",
                  },
                ]
              : [],
        },
      };

      const result = await isRootGauge(
        rootGaugeAddress,
        contextWithRootGauge as unknown as handlerContext,
      );
      expect(result).toBe(true);
    });

    it("returns false when RootGauge_RootPool has no row for the gauge address", async () => {
      const unknownGauge = toChecksumAddress(
        "0x9999999999999999999999999999999999999999",
      );
      const result = await isRootGauge(
        unknownGauge,
        mockContext as unknown as handlerContext,
      );
      expect(result).toBe(false);
    });
  });

  describe("findPoolOrSkipRootGauge", () => {
    it("returns { pool } when pool exists for gauge address", async () => {
      const result = await findPoolOrSkipRootGauge(
        mockGaugeAddress,
        mockChainId,
        mockContext as unknown as handlerContext,
        "TestHandler",
      );
      expect(result).not.toBeNull();
      expect(result?.pool.id).toBe(mockLiquidityPoolAggregator.id);
      expect(result?.pool.poolAddress).toBe(mockPoolAddress);
    });

    it("returns null without logging when gauge is root gauge", async () => {
      const rootGaugeAddress = toChecksumAddress(
        "0x923EC7E98706153Ce2c984DD802230476D4722B4",
      );
      const ctx = {
        ...mockContext,
        RootGauge_RootPool: {
          getWhere: async (params: { rootGaugeAddress?: { _eq: string } }) =>
            params.rootGaugeAddress?._eq === rootGaugeAddress
              ? [
                  {
                    id: "10-".concat(rootGaugeAddress),
                    rootChainId: 10,
                    rootGaugeAddress,
                    rootPoolAddress:
                      "0x0000000000000000000000000000000000000001",
                  },
                ]
              : [],
        },
        log: { ...mockContext.log, error: vi.fn() },
      } as unknown as handlerContext;

      const result = await findPoolOrSkipRootGauge(
        rootGaugeAddress,
        mockChainId,
        ctx,
        "TestHandler",
      );
      expect(result).toBeNull();
      expect(ctx.log.error).not.toHaveBeenCalled();
    });

    it("returns null and logs when pool missing and not root gauge", async () => {
      const unknownGauge = toChecksumAddress(
        "0x9999999999999999999999999999999999999999",
      );
      const logErrorSpy = vi.fn();
      const ctx = {
        ...mockContext,
        log: { ...mockContext.log, error: logErrorSpy },
      } as unknown as handlerContext;

      const result = await findPoolOrSkipRootGauge(
        unknownGauge,
        mockChainId,
        ctx,
        "TestHandler",
      );
      expect(result).toBeNull();
      expect(logErrorSpy).toHaveBeenCalledTimes(1);
      expect(logErrorSpy).toHaveBeenCalledWith(
        `TestHandler: Pool not found for gauge address ${unknownGauge} on chain ${mockChainId}`,
      );
    });
  });

  describe("Root gauge skip", () => {
    const rootGaugeAddress = toChecksumAddress(
      "0x923EC7E98706153Ce2c984DD802230476D4722B4",
    );

    function createContextWithRootGauge() {
      return {
        ...mockContext,
        RootGauge_RootPool: {
          getWhere: async (params: { rootGaugeAddress?: { _eq: string } }) =>
            params.rootGaugeAddress?._eq === rootGaugeAddress
              ? [
                  {
                    id: "10-".concat(rootGaugeAddress),
                    rootChainId: 10,
                    rootGaugeAddress,
                    rootPoolAddress:
                      "0x0000000000000000000000000000000000000001",
                  },
                ]
              : [],
        },
      } as unknown as handlerContext;
    }

    it("should skip deposit without error when gauge is root gauge", async () => {
      const logErrorSpy = vi.fn();
      const baseCtx = createContextWithRootGauge();
      const ctx = {
        ...baseCtx,
        log: { ...baseCtx.log, error: logErrorSpy },
      };

      await processGaugeDeposit(
        {
          gaugeAddress: rootGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 100,
          timestamp: 1000000,
          amount: 100000000000000000000n,
        },
        ctx,
        "TestGaugeDeposit",
      );

      expect(logErrorSpy).not.toHaveBeenCalled();
      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool?.numberOfGaugeDeposits).toBe(0n);
    });

    it("should skip withdraw without error when gauge is root gauge", async () => {
      const logErrorSpy = vi.fn();
      const baseCtx = createContextWithRootGauge();
      const ctx = {
        ...baseCtx,
        log: { ...baseCtx.log, error: logErrorSpy },
      };

      await processGaugeWithdraw(
        {
          gaugeAddress: rootGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 100,
          timestamp: 1000000,
          amount: 50000000000000000000n,
        },
        ctx,
        "TestGaugeWithdraw",
      );

      expect(logErrorSpy).not.toHaveBeenCalled();
      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool?.numberOfGaugeWithdrawals).toBe(0n);
    });

    it("should skip claim rewards without error when gauge is root gauge", async () => {
      const logErrorSpy = vi.fn();
      const baseCtx = createContextWithRootGauge();
      const ctx = {
        ...baseCtx,
        log: { ...baseCtx.log, error: logErrorSpy },
      };

      await processGaugeClaimRewards(
        {
          gaugeAddress: rootGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 100,
          timestamp: 1000000,
          amount: 1000000000000000000000n,
        },
        ctx,
        "TestGaugeClaimRewards",
      );

      expect(logErrorSpy).not.toHaveBeenCalled();
      const updatedPool = updatedDB.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool?.numberOfGaugeRewardClaims).toBe(0n);
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
            if (id === TokenId(mockChainId, mockRewardToken.address)) {
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

  describe("CL pool stakedCLPositionTokenIds maintenance", () => {
    const sqrtPriceX96AtTick0 = BigInt(
      TickMath.getSqrtRatioAtTick(0).toString(),
    );

    let clPool: LiquidityPoolAggregator;
    let clMockContext: typeof mockContext;

    const mockTokenId1 = 42n;
    const mockTokenId2 = 99n;

    beforeEach(() => {
      const {
        createMockLiquidityPoolAggregator,
        createMockNonFungiblePosition,
      } = setupCommon();

      clPool = createMockLiquidityPoolAggregator({
        poolAddress: mockPoolAddress,
        chainId: mockChainId,
        isCL: true,
        sqrtPriceX96: sqrtPriceX96AtTick0,
        tick: 0n,
        token0_id: mockToken0.id,
        token1_id: mockToken1.id,
        token0_address: mockToken0.address,
        token1_address: mockToken1.address,
        gaugeAddress: mockGaugeAddress,
        gaugeIsAlive: true,
        currentLiquidityStaked: 0n,
        currentLiquidityStakedUSD: 0n,
        lastUpdatedTimestamp: mockTimestamp,
        lastSnapshotTimestamp: mockTimestamp,
      });

      const pos1 = createMockNonFungiblePosition({
        chainId: mockChainId,
        pool: mockPoolAddress,
        tokenId: mockTokenId1,
        owner: mockUserAddress,
        liquidity: 5000n,
        tickLower: -1000n,
        tickUpper: 1000n,
        isStakedInGauge: false,
      });
      const pos2 = createMockNonFungiblePosition({
        chainId: mockChainId,
        pool: mockPoolAddress,
        tokenId: mockTokenId2,
        owner: mockUserAddress,
        liquidity: 3000n,
        tickLower: -500n,
        tickUpper: 500n,
        isStakedInGauge: false,
      });

      const positionMap = new Map([
        [pos1.id, pos1],
        [pos2.id, pos2],
      ]);

      updatedDB = updatedDB.entities.LiquidityPoolAggregator.set(clPool);

      clMockContext = {
        ...mockContext,
        LiquidityPoolAggregator: {
          ...mockContext.LiquidityPoolAggregator,
          // biome-ignore lint/suspicious/noExplicitAny: Mock entity for testing
          getWhere: async (params: any) => {
            if (params.gaugeAddress?._eq) {
              const pool = updatedDB.entities.LiquidityPoolAggregator.get(
                clPool.id,
              );
              return pool && pool.gaugeAddress === params.gaugeAddress._eq
                ? [pool]
                : [];
            }
            return [];
          },
        },
        NonFungiblePosition: {
          get: async (id: string) => positionMap.get(id),
          getWhere: async () => [],
        },
        CLTickStaked: {
          get: async () => undefined,
          set: () => {},
        },
        LiquidityPoolAggregatorSnapshot: {
          set: () => {},
        },
      };
    });

    it("should append tokenId to stakedCLPositionTokenIds on CL deposit", async () => {
      const depositData: GaugeEventData = {
        gaugeAddress: mockGaugeAddress,
        userAddress: mockUserAddress,
        chainId: mockChainId,
        blockNumber: 100,
        timestamp: 1000000,
        amount: 5000n,
        tokenId: mockTokenId1,
      };

      await processGaugeDeposit(depositData, clMockContext, "CLGauge.Deposit");

      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );
      expect(updatedUser?.stakedCLPositionTokenIds).toEqual([mockTokenId1]);
      expect(updatedUser?.currentLiquidityStaked).toBe(5000n);
    });

    it("should accumulate tokenIds on multiple CL deposits", async () => {
      // First deposit
      await processGaugeDeposit(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 100,
          timestamp: 1000000,
          amount: 5000n,
          tokenId: mockTokenId1,
        },
        clMockContext,
        "CLGauge.Deposit",
      );

      // Second deposit
      await processGaugeDeposit(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 101,
          timestamp: 1000000,
          amount: 3000n,
          tokenId: mockTokenId2,
        },
        clMockContext,
        "CLGauge.Deposit",
      );

      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );
      expect(updatedUser?.stakedCLPositionTokenIds).toEqual([
        mockTokenId1,
        mockTokenId2,
      ]);
      expect(updatedUser?.currentLiquidityStaked).toBe(8000n);
    });

    it("should remove tokenId from stakedCLPositionTokenIds on CL withdraw", async () => {
      // Setup: deposit two positions first
      await processGaugeDeposit(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 100,
          timestamp: 1000000,
          amount: 5000n,
          tokenId: mockTokenId1,
        },
        clMockContext,
        "CLGauge.Deposit",
      );
      await processGaugeDeposit(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 101,
          timestamp: 1000000,
          amount: 3000n,
          tokenId: mockTokenId2,
        },
        clMockContext,
        "CLGauge.Deposit",
      );

      // Withdraw first position
      await processGaugeWithdraw(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 102,
          timestamp: 1000000,
          amount: 5000n,
          tokenId: mockTokenId1,
        },
        clMockContext,
        "CLGauge.Withdraw",
      );

      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );
      expect(updatedUser?.stakedCLPositionTokenIds).toEqual([mockTokenId2]);
      expect(updatedUser?.currentLiquidityStaked).toBe(3000n);
    });

    it("should produce empty list after withdrawing all positions", async () => {
      // Deposit one position
      await processGaugeDeposit(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 100,
          timestamp: 1000000,
          amount: 5000n,
          tokenId: mockTokenId1,
        },
        clMockContext,
        "CLGauge.Deposit",
      );

      // Withdraw it
      await processGaugeWithdraw(
        {
          gaugeAddress: mockGaugeAddress,
          userAddress: mockUserAddress,
          chainId: mockChainId,
          blockNumber: 101,
          timestamp: 1000000,
          amount: 5000n,
          tokenId: mockTokenId1,
        },
        clMockContext,
        "CLGauge.Withdraw",
      );

      const updatedUser = updatedDB.entities.UserStatsPerPool.get(
        mockUserStatsPerPool.id,
      );
      expect(updatedUser?.stakedCLPositionTokenIds).toEqual([]);
      expect(updatedUser?.currentLiquidityStaked).toBe(0n);
    });
  });
});
