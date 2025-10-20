import { expect } from "chai";
import { CLGauge, MockDb } from "../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
} from "../../generated/src/Types.gen";

describe("CLGauge Events", () => {
  const mockChainId = 10;
  const mockPoolAddress = "0x1111111111111111111111111111111111111111";
  const mockUserAddress = "0x2222222222222222222222222222222222222222";
  const mockTimestamp = new Date(1000000 * 1000);

  const mockToken0: Token = {
    id: "0x3333333333333333333333333333333333333333-10",
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
    id: "0x4444444444444444444444444444444444444444-10",
    address: "0x4444444444444444444444444444444444444444",
    symbol: "USDT",
    name: "Tether USD",
    chainId: mockChainId,
    decimals: 6n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD in 18 decimals
    lastUpdatedTimestamp: mockTimestamp,
    isWhitelisted: true,
  };

  let mockLiquidityPoolAggregator: LiquidityPoolAggregator = {
    id: mockPoolAddress,
    chainId: mockChainId,
    name: "USDC/USDT",
    token0_id: mockToken0.id,
    token1_id: mockToken1.id,
    token0_address: mockToken0.address,
    token1_address: mockToken1.address,
    isStable: true,
    isCL: true,
    reserve0: 1000000n,
    reserve1: 1000000n,
    totalLiquidityUSD: 2000000000000000000000000n, // 2M USD in 18 decimals
    totalVolume0: 0n,
    totalVolume1: 0n,
    totalVolumeUSD: 0n,
    totalVolumeUSDWhitelisted: 0n,
    gaugeFees0CurrentEpoch: 0n,
    gaugeFees1CurrentEpoch: 0n,
    totalFees0: 0n,
    totalFees1: 0n,
    totalFeesUSD: 0n,
    totalFeesUSDWhitelisted: 0n,
    numberOfSwaps: 0n,
    token0Price: 1000000000000000000n,
    token1Price: 1000000000000000000n,
    totalVotesDeposited: 0n,
    totalVotesDepositedUSD: 0n,
    totalEmissions: 0n,
    totalEmissionsUSD: 0n,
    totalBribesUSD: 0n,
    gaugeIsAlive: true,
    token0IsWhitelisted: true,
    token1IsWhitelisted: true,
    lastUpdatedTimestamp: mockTimestamp,
    lastSnapshotTimestamp: mockTimestamp,
    feeProtocol0: 0n,
    feeProtocol1: 0n,
    observationCardinalityNext: 0n,
    totalFlashLoanFees0: 0n,
    totalFlashLoanFees1: 0n,
    totalFlashLoanFeesUSD: 0n,
    totalFlashLoanVolumeUSD: 0n,
    numberOfFlashLoans: 0n,
    // Gauge fields
    numberOfGaugeDeposits: 0n,
    numberOfGaugeWithdrawals: 0n,
    numberOfGaugeRewardClaims: 0n,
    totalGaugeRewardsClaimedUSD: 0n,
    currentLiquidityStakedUSD: 0n,
    // Pool Launcher relationship
    poolLauncherPoolId: undefined,
    // Voting fields
    gaugeAddress: "",
    numberOfVotes: 0n,
    currentVotingPower: 0n,
  };

  let mockUserStatsPerPool: UserStatsPerPool;
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let updatedDB: ReturnType<typeof MockDb.createMockDb>;

  beforeEach(() => {
    mockUserStatsPerPool = {
      id: `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
      userAddress: mockUserAddress.toLowerCase(),
      poolAddress: mockPoolAddress.toLowerCase(),
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
      currentLiquidityStakedUSD: 0n,
      firstActivityTimestamp: mockTimestamp,
      lastActivityTimestamp: mockTimestamp,
      currentVotingPower: 0n,
      numberOfVotes: 0n,
    };

    mockDb = MockDb.createMockDb();
    updatedDB = mockDb.entities.LiquidityPoolAggregator.set(
      mockLiquidityPoolAggregator,
    );
    updatedDB = updatedDB.entities.Token.set(mockToken0);
    updatedDB = updatedDB.entities.Token.set(mockToken1);
    updatedDB = updatedDB.entities.UserStatsPerPool.set(mockUserStatsPerPool);
  });

  describe("CLGauge.Deposit", () => {
    it("should update user stats with gauge deposit", async () => {
      const mockEvent = CLGauge.Deposit.createMockEvent({
        tokenId: 1n,
        user: mockUserAddress,
        liquidityToStake: 100000000000000000000n, // 100 USD in 18 decimals
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
          chainId: mockChainId,
          srcAddress: mockPoolAddress,
        },
      });

      const result = await CLGauge.Deposit.processEvent({
        event: mockEvent,
        mockDb: updatedDB,
      });

      const updatedUserStats = result.entities.UserStatsPerPool.get(
        `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
      );
      const updatedPoolAggregator =
        result.entities.LiquidityPoolAggregator.get(mockPoolAddress);

      expect(updatedUserStats).to.not.be.undefined;
      expect(updatedUserStats?.numberOfGaugeDeposits).to.equal(1n);
      expect(updatedUserStats?.currentLiquidityStakedUSD).to.equal(
        100000000000000000000n,
      );

      expect(updatedPoolAggregator).to.not.be.undefined;
      expect(updatedPoolAggregator?.numberOfGaugeDeposits).to.equal(1n);
      expect(updatedPoolAggregator?.currentLiquidityStakedUSD).to.equal(
        100000000000000000000n,
      );
    });

    it("should accumulate multiple gauge deposits", async () => {
      // First deposit
      const mockEvent1 = CLGauge.Deposit.createMockEvent({
        tokenId: 1n,
        user: mockUserAddress,
        liquidityToStake: 100000000000000000000n, // 100 USD
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          },
          chainId: mockChainId,
          srcAddress: mockPoolAddress,
        },
      });

      const result1 = await CLGauge.Deposit.processEvent({
        event: mockEvent1,
        mockDb: updatedDB,
      });

      // Update the mock to reflect the first deposit
      mockUserStatsPerPool = {
        ...mockUserStatsPerPool,
        numberOfGaugeDeposits: 1n,
        currentLiquidityStakedUSD: 100000000000000000000n,
      };
      updatedDB = result1.entities.UserStatsPerPool.set(mockUserStatsPerPool);

      // Second deposit
      const mockEvent2 = CLGauge.Deposit.createMockEvent({
        tokenId: 1n,
        user: mockUserAddress,
        liquidityToStake: 50000000000000000000n, // 50 USD
        mockEventData: {
          block: {
            number: 123457,
            timestamp: 1000001,
            hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          },
          chainId: mockChainId,
          srcAddress: mockPoolAddress,
        },
      });

      const result2 = await CLGauge.Deposit.processEvent({
        event: mockEvent2,
        mockDb: updatedDB,
      });

      const updatedUserStats = result2.entities.UserStatsPerPool.get(
        `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
      );
      const updatedPoolAggregator =
        result2.entities.LiquidityPoolAggregator.get(mockPoolAddress);

      expect(updatedUserStats?.numberOfGaugeDeposits).to.equal(2n);
      expect(updatedUserStats?.currentLiquidityStakedUSD).to.equal(
        150000000000000000000n,
      ); // 100 + 50

      expect(updatedPoolAggregator?.numberOfGaugeDeposits).to.equal(2n);
      expect(updatedPoolAggregator?.currentLiquidityStakedUSD).to.equal(
        150000000000000000000n,
      ); // 100 + 50
    });
  });

  describe("CLGauge.Withdraw", () => {
    it("should update user stats with gauge withdrawal", async () => {
      // First set up some staked liquidity in both user and pool
      mockUserStatsPerPool = {
        ...mockUserStatsPerPool,
        numberOfGaugeDeposits: 2n,
        currentLiquidityStakedUSD: 200000000000000000000n, // 200 USD staked
      };
      mockLiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        numberOfGaugeDeposits: 2n,
        currentLiquidityStakedUSD: 200000000000000000000n, // 200 USD staked
      };
      updatedDB = updatedDB.entities.UserStatsPerPool.set(mockUserStatsPerPool);
      updatedDB = updatedDB.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );

      const mockEvent = CLGauge.Withdraw.createMockEvent({
        tokenId: 1n,
        user: mockUserAddress,
        liquidityToStake: 50000000000000000000n, // 50 USD withdrawal
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
          chainId: mockChainId,
          srcAddress: mockPoolAddress,
        },
      });

      const result = await CLGauge.Withdraw.processEvent({
        event: mockEvent,
        mockDb: updatedDB,
      });

      const updatedUserStats = result.entities.UserStatsPerPool.get(
        `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
      );
      const updatedPoolAggregator =
        result.entities.LiquidityPoolAggregator.get(mockPoolAddress);

      expect(updatedUserStats).to.not.be.undefined;
      expect(updatedUserStats?.numberOfGaugeWithdrawals).to.equal(1n);
      expect(updatedUserStats?.currentLiquidityStakedUSD).to.equal(
        150000000000000000000n,
      ); // 200 - 50

      expect(updatedPoolAggregator).to.not.be.undefined;
      expect(updatedPoolAggregator?.numberOfGaugeWithdrawals).to.equal(1n);
      expect(updatedPoolAggregator?.currentLiquidityStakedUSD).to.equal(
        150000000000000000000n,
      ); // 200 - 50
    });

    it("should handle multiple gauge withdrawals", async () => {
      // Set up initial staked liquidity in both user and pool
      mockUserStatsPerPool = {
        ...mockUserStatsPerPool,
        numberOfGaugeDeposits: 3n,
        currentLiquidityStakedUSD: 300000000000000000000n, // 300 USD staked
      };
      mockLiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        numberOfGaugeDeposits: 3n,
        currentLiquidityStakedUSD: 300000000000000000000n, // 300 USD staked
      };
      updatedDB = updatedDB.entities.UserStatsPerPool.set(mockUserStatsPerPool);
      updatedDB = updatedDB.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );

      // First withdrawal
      const mockEvent1 = CLGauge.Withdraw.createMockEvent({
        tokenId: 1n,
        user: mockUserAddress,
        liquidityToStake: 100000000000000000000n, // 100 USD
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          },
          chainId: mockChainId,
          srcAddress: mockPoolAddress,
        },
      });

      const result1 = await CLGauge.Withdraw.processEvent({
        event: mockEvent1,
        mockDb: updatedDB,
      });

      // Update mock to reflect first withdrawal
      mockUserStatsPerPool = {
        ...mockUserStatsPerPool,
        numberOfGaugeWithdrawals: 1n,
        currentLiquidityStakedUSD: 200000000000000000000n, // 300 - 100
      };
      updatedDB = result1.entities.UserStatsPerPool.set(mockUserStatsPerPool);

      // Second withdrawal
      const mockEvent2 = CLGauge.Withdraw.createMockEvent({
        tokenId: 1n,
        user: mockUserAddress,
        liquidityToStake: 50000000000000000000n, // 50 USD
        mockEventData: {
          block: {
            number: 123457,
            timestamp: 1000001,
            hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          },
          chainId: mockChainId,
          srcAddress: mockPoolAddress,
        },
      });

      const result2 = await CLGauge.Withdraw.processEvent({
        event: mockEvent2,
        mockDb: updatedDB,
      });

      const updatedUserStats = result2.entities.UserStatsPerPool.get(
        `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
      );
      const updatedPoolAggregator =
        result2.entities.LiquidityPoolAggregator.get(mockPoolAddress);

      expect(updatedUserStats?.numberOfGaugeWithdrawals).to.equal(2n);
      expect(updatedUserStats?.currentLiquidityStakedUSD).to.equal(
        150000000000000000000n,
      ); // 200 - 50

      expect(updatedPoolAggregator?.numberOfGaugeWithdrawals).to.equal(2n);
      expect(updatedPoolAggregator?.currentLiquidityStakedUSD).to.equal(
        150000000000000000000n,
      ); // 200 - 50
    });
  });

  describe("CLGauge.ClaimRewards", () => {
    it("should update user stats with gauge reward claim", async () => {
      const mockEvent = CLGauge.ClaimRewards.createMockEvent({
        from: mockUserAddress,
        amount: 25000000000000000000n, // 25 USD in 18 decimals
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
          chainId: mockChainId,
          srcAddress: mockPoolAddress,
        },
      });

      const result = await CLGauge.ClaimRewards.processEvent({
        event: mockEvent,
        mockDb: updatedDB,
      });

      const updatedUserStats = result.entities.UserStatsPerPool.get(
        `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
      );
      const updatedPoolAggregator =
        result.entities.LiquidityPoolAggregator.get(mockPoolAddress);

      expect(updatedUserStats).to.not.be.undefined;
      expect(updatedUserStats?.numberOfGaugeRewardClaims).to.equal(1n);
      expect(updatedUserStats?.totalGaugeRewardsClaimedUSD).to.equal(
        25000000000000000000n,
      );

      expect(updatedPoolAggregator).to.not.be.undefined;
      expect(updatedPoolAggregator?.numberOfGaugeRewardClaims).to.equal(1n);
      expect(updatedPoolAggregator?.totalGaugeRewardsClaimedUSD).to.equal(
        25000000000000000000n,
      );
    });

    it("should accumulate multiple gauge reward claims", async () => {
      // First claim
      const mockEvent1 = CLGauge.ClaimRewards.createMockEvent({
        from: mockUserAddress,
        amount: 10000000000000000000n, // 10 USD
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          },
          chainId: mockChainId,
          srcAddress: mockPoolAddress,
        },
      });

      const result1 = await CLGauge.ClaimRewards.processEvent({
        event: mockEvent1,
        mockDb: updatedDB,
      });

      // Update mock to reflect first claim
      mockUserStatsPerPool = {
        ...mockUserStatsPerPool,
        numberOfGaugeRewardClaims: 1n,
        totalGaugeRewardsClaimedUSD: 10000000000000000000n,
      };
      updatedDB = result1.entities.UserStatsPerPool.set(mockUserStatsPerPool);

      // Second claim
      const mockEvent2 = CLGauge.ClaimRewards.createMockEvent({
        from: mockUserAddress,
        amount: 15000000000000000000n, // 15 USD
        mockEventData: {
          block: {
            number: 123457,
            timestamp: 1000001,
            hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          },
          chainId: mockChainId,
          srcAddress: mockPoolAddress,
        },
      });

      const result2 = await CLGauge.ClaimRewards.processEvent({
        event: mockEvent2,
        mockDb: updatedDB,
      });

      const updatedUserStats = result2.entities.UserStatsPerPool.get(
        `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
      );
      const updatedPoolAggregator =
        result2.entities.LiquidityPoolAggregator.get(mockPoolAddress);

      expect(updatedUserStats?.numberOfGaugeRewardClaims).to.equal(2n);
      expect(updatedUserStats?.totalGaugeRewardsClaimedUSD).to.equal(
        25000000000000000000n,
      ); // 10 + 15

      expect(updatedPoolAggregator?.numberOfGaugeRewardClaims).to.equal(2n);
      expect(updatedPoolAggregator?.totalGaugeRewardsClaimedUSD).to.equal(
        25000000000000000000n,
      ); // 10 + 15
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero amounts correctly", async () => {
      // Reset the pool aggregator to initial state for this test
      mockLiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        numberOfGaugeDeposits: 0n,
        currentLiquidityStakedUSD: 0n,
      };
      updatedDB = updatedDB.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );

      const mockEvent = CLGauge.Deposit.createMockEvent({
        tokenId: 1n,
        user: mockUserAddress,
        liquidityToStake: 0n,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
          chainId: mockChainId,
          srcAddress: mockPoolAddress,
        },
      });

      const result = await CLGauge.Deposit.processEvent({
        event: mockEvent,
        mockDb: updatedDB,
      });

      const updatedUserStats = result.entities.UserStatsPerPool.get(
        `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
      );
      const updatedPoolAggregator =
        result.entities.LiquidityPoolAggregator.get(mockPoolAddress);

      expect(updatedUserStats?.numberOfGaugeDeposits).to.equal(1n);
      expect(updatedUserStats?.currentLiquidityStakedUSD).to.equal(0n);

      expect(updatedPoolAggregator?.numberOfGaugeDeposits).to.equal(1n);
      expect(updatedPoolAggregator?.currentLiquidityStakedUSD).to.equal(0n);
    });

    it("should handle very large amounts correctly", async () => {
      // Reset the pool aggregator to initial state for this test
      mockLiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        numberOfGaugeDeposits: 0n,
        currentLiquidityStakedUSD: 0n,
      };
      updatedDB = updatedDB.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );

      const largeAmount = 1000000000000000000000000n; // 1M USD in 18 decimals

      const mockEvent = CLGauge.Deposit.createMockEvent({
        tokenId: 1n,
        user: mockUserAddress,
        liquidityToStake: largeAmount,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
          chainId: mockChainId,
          srcAddress: mockPoolAddress,
        },
      });

      const result = await CLGauge.Deposit.processEvent({
        event: mockEvent,
        mockDb: updatedDB,
      });

      const updatedUserStats = result.entities.UserStatsPerPool.get(
        `${mockUserAddress.toLowerCase()}_${mockPoolAddress.toLowerCase()}_${mockChainId}`,
      );
      const updatedPoolAggregator =
        result.entities.LiquidityPoolAggregator.get(mockPoolAddress);

      expect(updatedUserStats?.currentLiquidityStakedUSD).to.equal(largeAmount);
      expect(updatedPoolAggregator?.currentLiquidityStakedUSD).to.equal(
        largeAmount,
      );
    });
  });
});
