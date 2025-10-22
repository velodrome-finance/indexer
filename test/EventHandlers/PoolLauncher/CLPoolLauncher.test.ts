import { expect } from "chai";
import { CLPoolLauncher, MockDb } from "generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  PoolLauncherPool,
  Token,
} from "generated/src/Types.gen";

describe("CLPoolLauncher Events", () => {
  const mockChainId = 10;
  const mockPoolAddress = "0x1111111111111111111111111111111111111111";
  const mockLauncherAddress = "0x2222222222222222222222222222222222222222";
  const mockCreator = "0x3333333333333333333333333333333333333333";
  const mockPoolLauncherToken = "0x4444444444444444444444444444444444444444";
  const mockPairToken = "0x5555555555555555555555555555555555555555";
  const mockTimestamp = new Date(1000000 * 1000);

  const mockToken0: Token = {
    id: "0x6666666666666666666666666666666666666666-10",
    address: "0x6666666666666666666666666666666666666666",
    symbol: "USDC",
    name: "USD Coin",
    chainId: mockChainId,
    decimals: 6n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD in 18 decimals
    lastUpdatedTimestamp: mockTimestamp,
    isWhitelisted: true,
  };

  const mockToken1: Token = {
    id: "0x7777777777777777777777777777777777777777-10",
    address: "0x7777777777777777777777777777777777777777",
    symbol: "USDT",
    name: "Tether USD",
    chainId: mockChainId,
    decimals: 6n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD in 18 decimals
    lastUpdatedTimestamp: mockTimestamp,
    isWhitelisted: true,
  };

  let mockLiquidityPoolAggregator: LiquidityPoolAggregator;
  let mockDb: ReturnType<typeof MockDb.createMockDb>;

  beforeEach(() => {
    mockLiquidityPoolAggregator = {
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
      totalLiquidityUSD: 2000000000000000000000n, // $2000 in 18 decimals
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
      gaugeIsAlive: false,
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
      totalGaugeRewardsClaimed: 0n,
      currentLiquidityStakedUSD: 0n,
      poolLauncherPoolId: undefined,
      // Voting fields
      gaugeAddress: "",
      numberOfVotes: 0n,
      currentVotingPower: 0n,
    };

    mockDb = MockDb.createMockDb();
    mockDb = mockDb.entities.Token.set(mockToken0);
    mockDb = mockDb.entities.Token.set(mockToken1);
    mockDb = mockDb.entities.LiquidityPoolAggregator.set(
      mockLiquidityPoolAggregator,
    );
  });

  describe("CLPoolLauncher.Launch", () => {
    it("should create a new PoolLauncherPool and link to LiquidityPoolAggregator", async () => {
      const mockEvent = CLPoolLauncher.Launch.createMockEvent({
        pool: mockPoolAddress,
        sender: mockCreator,
        poolLauncherToken: mockPoolLauncherToken,
        poolLauncherPool: [
          1000000n,
          mockPairToken,
          mockPoolLauncherToken,
          mockPoolAddress,
        ],
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.Launch.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Check that PoolLauncherPool was created
      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        `${mockChainId}-${mockPoolAddress}`,
      );
      expect(poolLauncherPool).to.not.be.undefined;
      expect(poolLauncherPool?.underlyingPool).to.equal(mockPoolAddress);
      expect(poolLauncherPool?.launcher).to.equal(
        mockLauncherAddress.toLowerCase(),
      );
      expect(poolLauncherPool?.creator).to.equal(mockCreator.toLowerCase());
      expect(poolLauncherPool?.poolLauncherToken).to.equal(
        mockPoolLauncherToken.toLowerCase(),
      );
      expect(poolLauncherPool?.pairToken).to.equal(mockPairToken.toLowerCase());
      expect(poolLauncherPool?.isEmerging).to.be.false;

      // Check that LiquidityPoolAggregator was linked
      const liquidityPoolAggregator =
        result.entities.LiquidityPoolAggregator.get(mockPoolAddress);
      expect(liquidityPoolAggregator).to.not.be.undefined;
      expect(liquidityPoolAggregator?.poolLauncherPoolId).to.equal(
        `${mockChainId}-${mockPoolAddress}`,
      );
    });
  });

  describe("CLPoolLauncher.Migrate", () => {
    it("should update existing PoolLauncherPool with migration info and create new one", async () => {
      const underlyingPool = "0x1111111111111111111111111111111111111111";
      const newPoolAddress = "0x2222222222222222222222222222222222222222";
      const oldLocker = "0x3333333333333333333333333333333333333333";
      const newLocker = "0x4444444444444444444444444444444444444444";

      // Create existing PoolLauncherPool
      const existingPoolLauncherPool: PoolLauncherPool = {
        id: `${mockChainId}-${underlyingPool}`,
        underlyingPool,
        launcher: mockLauncherAddress,
        creator: mockCreator,
        poolLauncherToken: mockPoolLauncherToken,
        pairToken: mockPairToken,
        isEmerging: false,
        createdAt: mockTimestamp,
        lastMigratedAt: new Date(0),
        migratedFrom: "",
        migratedTo: "",
        oldLocker: "",
        newLocker: "",
        lastFlagUpdateAt: new Date(0),
        chainId: mockChainId,
      };

      mockDb = mockDb.entities.PoolLauncherPool.set(existingPoolLauncherPool);

      const mockEvent = CLPoolLauncher.Migrate.createMockEvent({
        underlyingPool,
        locker: oldLocker,
        newLocker,
        newPoolLauncherPool: [
          1000000n,
          mockPairToken,
          mockPoolLauncherToken,
          newPoolAddress,
        ],
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.Migrate.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Check that original PoolLauncherPool was updated with migration info
      const originalPoolLauncherPool = result.entities.PoolLauncherPool.get(
        `${mockChainId}-${underlyingPool}`,
      );
      expect(originalPoolLauncherPool).to.not.be.undefined;
      expect(originalPoolLauncherPool?.migratedTo).to.equal(newPoolAddress);
      expect(originalPoolLauncherPool?.oldLocker).to.equal(
        oldLocker.toLowerCase(),
      );
      expect(originalPoolLauncherPool?.newLocker).to.equal(
        newLocker.toLowerCase(),
      );
      expect(originalPoolLauncherPool?.lastMigratedAt).to.deep.equal(
        mockTimestamp,
      );

      // Check that new PoolLauncherPool was created
      const newPoolLauncherPool = result.entities.PoolLauncherPool.get(
        `${mockChainId}-${newPoolAddress}`,
      );
      expect(newPoolLauncherPool).to.not.be.undefined;
      expect(newPoolLauncherPool?.underlyingPool).to.equal(newPoolAddress);
      expect(newPoolLauncherPool?.creator).to.equal(mockCreator); // Should keep original creator
      expect(newPoolLauncherPool?.poolLauncherToken).to.equal(
        mockPoolLauncherToken.toLowerCase(),
      );
      expect(newPoolLauncherPool?.pairToken).to.equal(
        mockPairToken.toLowerCase(),
      );
    });

    it("should handle migration when PoolLauncherPool doesn't exist", async () => {
      const underlyingPool = "0x1111111111111111111111111111111111111111";
      const newPoolAddress = "0x2222222222222222222222222222222222222222";
      const oldLocker = "0x3333333333333333333333333333333333333333";
      const newLocker = "0x4444444444444444444444444444444444444444";

      const mockEvent = CLPoolLauncher.Migrate.createMockEvent({
        underlyingPool,
        locker: oldLocker,
        newLocker,
        newPoolLauncherPool: [
          1000000n,
          mockPairToken,
          mockPoolLauncherToken,
          newPoolAddress,
        ],
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.Migrate.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should not create any PoolLauncherPool entities since original doesn't exist
      const originalPoolLauncherPool = result.entities.PoolLauncherPool.get(
        `${mockChainId}-${underlyingPool}`,
      );
      expect(originalPoolLauncherPool).to.be.undefined;

      const newPoolLauncherPool = result.entities.PoolLauncherPool.get(
        `${mockChainId}-${newPoolAddress}`,
      );
      expect(newPoolLauncherPool).to.be.undefined;
    });
  });

  describe("CLPoolLauncher.EmergingFlagged", () => {
    it("should flag existing PoolLauncherPool as emerging", async () => {
      const existingPoolLauncherPool: PoolLauncherPool = {
        id: `${mockChainId}-${mockPoolAddress}`,
        underlyingPool: mockPoolAddress,
        launcher: mockLauncherAddress,
        creator: mockCreator,
        poolLauncherToken: mockPoolLauncherToken,
        pairToken: mockPairToken,
        isEmerging: false,
        createdAt: mockTimestamp,
        lastMigratedAt: new Date(0),
        migratedFrom: "",
        migratedTo: "",
        oldLocker: "",
        newLocker: "",
        lastFlagUpdateAt: new Date(0),
        chainId: mockChainId,
      };

      mockDb = mockDb.entities.PoolLauncherPool.set(existingPoolLauncherPool);

      const mockEvent = CLPoolLauncher.EmergingFlagged.createMockEvent({
        pool: mockPoolAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.EmergingFlagged.processEvent({
        event: mockEvent,
        mockDb,
      });

      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        `${mockChainId}-${mockPoolAddress}`,
      );
      expect(poolLauncherPool).to.not.be.undefined;
      expect(poolLauncherPool?.isEmerging).to.be.true;
      expect(poolLauncherPool?.lastFlagUpdateAt).to.deep.equal(mockTimestamp);
    });

    it("should handle flagging when PoolLauncherPool doesn't exist", async () => {
      const mockEvent = CLPoolLauncher.EmergingFlagged.createMockEvent({
        pool: mockPoolAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.EmergingFlagged.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should not create any PoolLauncherPool entities
      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        `${mockChainId}-${mockPoolAddress}`,
      );
      expect(poolLauncherPool).to.be.undefined;
    });
  });

  describe("CLPoolLauncher.EmergingUnflagged", () => {
    it("should unflag existing PoolLauncherPool as emerging", async () => {
      const existingPoolLauncherPool: PoolLauncherPool = {
        id: `${mockChainId}-${mockPoolAddress}`,
        underlyingPool: mockPoolAddress,
        launcher: mockLauncherAddress,
        creator: mockCreator,
        poolLauncherToken: mockPoolLauncherToken,
        pairToken: mockPairToken,
        isEmerging: true,
        createdAt: mockTimestamp,
        lastMigratedAt: new Date(0),
        migratedFrom: "",
        migratedTo: "",
        oldLocker: "",
        newLocker: "",
        lastFlagUpdateAt: new Date(500000 * 1000),
        chainId: mockChainId,
      };

      mockDb = mockDb.entities.PoolLauncherPool.set(existingPoolLauncherPool);

      const mockEvent = CLPoolLauncher.EmergingUnflagged.createMockEvent({
        pool: mockPoolAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.EmergingUnflagged.processEvent({
        event: mockEvent,
        mockDb,
      });

      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        `${mockChainId}-${mockPoolAddress}`,
      );
      expect(poolLauncherPool).to.not.be.undefined;
      expect(poolLauncherPool?.isEmerging).to.be.false;
      expect(poolLauncherPool?.lastFlagUpdateAt).to.deep.equal(mockTimestamp);
    });

    it("should handle unflagging when PoolLauncherPool doesn't exist", async () => {
      const mockEvent = CLPoolLauncher.EmergingUnflagged.createMockEvent({
        pool: mockPoolAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.EmergingUnflagged.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should not create any PoolLauncherPool entities
      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        `${mockChainId}-${mockPoolAddress}`,
      );
      expect(poolLauncherPool).to.be.undefined;
    });
  });

  describe("CLPoolLauncher.CreationTimestampSet", () => {
    it("should update creation timestamp for existing PoolLauncherPool", async () => {
      const existingPoolLauncherPool: PoolLauncherPool = {
        id: `${mockChainId}-${mockPoolAddress}`,
        underlyingPool: mockPoolAddress,
        launcher: mockLauncherAddress,
        creator: mockCreator,
        poolLauncherToken: mockPoolLauncherToken,
        pairToken: mockPairToken,
        isEmerging: false,
        createdAt: new Date(500000 * 1000), // Old timestamp
        lastMigratedAt: new Date(0),
        migratedFrom: "",
        migratedTo: "",
        oldLocker: "",
        newLocker: "",
        lastFlagUpdateAt: new Date(0),
        chainId: mockChainId,
      };

      mockDb = mockDb.entities.PoolLauncherPool.set(existingPoolLauncherPool);

      const newTimestamp = 1000000n;
      const mockEvent = CLPoolLauncher.CreationTimestampSet.createMockEvent({
        pool: mockPoolAddress,
        createdAt: newTimestamp,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.CreationTimestampSet.processEvent({
        event: mockEvent,
        mockDb,
      });

      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        `${mockChainId}-${mockPoolAddress}`,
      );
      expect(poolLauncherPool).to.not.be.undefined;
      expect(poolLauncherPool?.createdAt).to.deep.equal(
        new Date(Number(newTimestamp) * 1000),
      );
    });

    it("should handle timestamp update when PoolLauncherPool doesn't exist", async () => {
      const newTimestamp = 1000000n;
      const mockEvent = CLPoolLauncher.CreationTimestampSet.createMockEvent({
        pool: mockPoolAddress,
        createdAt: newTimestamp,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.CreationTimestampSet.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should not create any PoolLauncherPool entities
      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        `${mockChainId}-${mockPoolAddress}`,
      );
      expect(poolLauncherPool).to.be.undefined;
    });
  });

  describe("CLPoolLauncher.PairableTokenAdded", () => {
    it("should create new PoolLauncherConfig when adding first token", async () => {
      const tokenAddress = "0x8888888888888888888888888888888888888888";
      const configId = `${mockChainId}-${mockLauncherAddress}`;

      const mockEvent = CLPoolLauncher.PairableTokenAdded.createMockEvent({
        token: tokenAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.PairableTokenAdded.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should create new PoolLauncherConfig
      const config = result.entities.PoolLauncherConfig.get(configId);
      expect(config).to.not.be.undefined;
      expect(config?.id).to.equal(configId);
      expect(config?.version).to.equal("CL");
      expect(config?.pairableTokens).to.deep.equal([tokenAddress]);
    });

    it("should add token to existing PoolLauncherConfig", async () => {
      const existingToken = "0x1111111111111111111111111111111111111111";
      const newToken = "0x2222222222222222222222222222222222222222";
      const configId = `${mockChainId}-${mockLauncherAddress}`;

      // Set up existing config
      const existingConfig = {
        id: configId,
        version: "CL",
        pairableTokens: [existingToken],
      };
      mockDb = mockDb.entities.PoolLauncherConfig.set(existingConfig);

      const mockEvent = CLPoolLauncher.PairableTokenAdded.createMockEvent({
        token: newToken,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.PairableTokenAdded.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should update existing PoolLauncherConfig
      const config = result.entities.PoolLauncherConfig.get(configId);
      expect(config).to.not.be.undefined;
      expect(config?.id).to.equal(configId);
      expect(config?.version).to.equal("CL");
      expect(config?.pairableTokens).to.deep.equal([existingToken, newToken]);
    });

    it("should not add duplicate token to PoolLauncherConfig", async () => {
      const tokenAddress = "0x8888888888888888888888888888888888888888";
      const configId = `${mockChainId}-${mockLauncherAddress}`;

      // Set up existing config with the same token
      const existingConfig = {
        id: configId,
        version: "CL",
        pairableTokens: [tokenAddress],
      };
      mockDb = mockDb.entities.PoolLauncherConfig.set(existingConfig);

      const mockEvent = CLPoolLauncher.PairableTokenAdded.createMockEvent({
        token: tokenAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.PairableTokenAdded.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should not add duplicate token
      const config = result.entities.PoolLauncherConfig.get(configId);
      expect(config).to.not.be.undefined;
      expect(config?.pairableTokens).to.deep.equal([tokenAddress]);
    });
  });

  describe("CLPoolLauncher.PairableTokenRemoved", () => {
    it("should remove token from existing PoolLauncherConfig", async () => {
      const tokenToRemove = "0x8888888888888888888888888888888888888888";
      const remainingToken = "0x1111111111111111111111111111111111111111";
      const configId = `${mockChainId}-${mockLauncherAddress}`;

      // Set up existing config with multiple tokens
      const existingConfig = {
        id: configId,
        version: "CL",
        pairableTokens: [tokenToRemove, remainingToken],
      };
      mockDb = mockDb.entities.PoolLauncherConfig.set(existingConfig);

      const mockEvent = CLPoolLauncher.PairableTokenRemoved.createMockEvent({
        token: tokenToRemove,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.PairableTokenRemoved.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should update PoolLauncherConfig by removing the token
      const config = result.entities.PoolLauncherConfig.get(configId);
      expect(config).to.not.be.undefined;
      expect(config?.id).to.equal(configId);
      expect(config?.version).to.equal("CL");
      expect(config?.pairableTokens).to.deep.equal([remainingToken]);
    });

    it("should handle removal when config doesn't exist", async () => {
      const tokenAddress = "0x8888888888888888888888888888888888888888";
      const configId = `${mockChainId}-${mockLauncherAddress}`;

      const mockEvent = CLPoolLauncher.PairableTokenRemoved.createMockEvent({
        token: tokenAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.PairableTokenRemoved.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should not create any config when trying to remove from non-existent config
      const config = result.entities.PoolLauncherConfig.get(configId);
      expect(config).to.be.undefined;
    });

    it("should handle removal of non-existent token gracefully", async () => {
      const existingToken = "0x1111111111111111111111111111111111111111";
      const nonExistentToken = "0x8888888888888888888888888888888888888888";
      const configId = `${mockChainId}-${mockLauncherAddress}`;

      // Set up existing config
      const existingConfig = {
        id: configId,
        version: "CL",
        pairableTokens: [existingToken],
      };
      mockDb = mockDb.entities.PoolLauncherConfig.set(existingConfig);

      const mockEvent = CLPoolLauncher.PairableTokenRemoved.createMockEvent({
        token: nonExistentToken,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.PairableTokenRemoved.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should keep existing tokens unchanged
      const config = result.entities.PoolLauncherConfig.get(configId);
      expect(config).to.not.be.undefined;
      expect(config?.pairableTokens).to.deep.equal([existingToken]);
    });
  });

  describe("CLPoolLauncher.NewPoolLauncherSet", () => {
    it("should update PoolLauncherConfig ID when pool launcher changes", async () => {
      const newPoolLauncher = "0x8888888888888888888888888888888888888888";
      const oldConfigId = `${mockChainId}-${mockLauncherAddress}`;
      const newConfigId = `${mockChainId}-${newPoolLauncher}`;

      // Set up existing config
      const existingConfig = {
        id: oldConfigId,
        version: "CL",
        pairableTokens: [
          "0x1111111111111111111111111111111111111111",
          "0x2222222222222222222222222222222222222222",
        ],
      };
      mockDb = mockDb.entities.PoolLauncherConfig.set(existingConfig);

      const mockEvent = CLPoolLauncher.NewPoolLauncherSet.createMockEvent({
        newPoolLauncher,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.NewPoolLauncherSet.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should create new config with updated ID
      const newConfig = result.entities.PoolLauncherConfig.get(newConfigId);
      expect(newConfig).to.not.be.undefined;
      expect(newConfig?.id).to.equal(newConfigId);
      expect(newConfig?.version).to.equal("CL");
      expect(newConfig?.pairableTokens).to.deep.equal(
        existingConfig.pairableTokens,
      );

      // Old config should still exist (we're not deleting it)
      const oldConfig = result.entities.PoolLauncherConfig.get(oldConfigId);
      expect(oldConfig).to.not.be.undefined;
    });

    it("should handle pool launcher change when no existing config", async () => {
      const newPoolLauncher = "0x8888888888888888888888888888888888888888";
      const oldConfigId = `${mockChainId}-${mockLauncherAddress}`;
      const newConfigId = `${mockChainId}-${newPoolLauncher}`;

      const mockEvent = CLPoolLauncher.NewPoolLauncherSet.createMockEvent({
        newPoolLauncher,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await CLPoolLauncher.NewPoolLauncherSet.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should not create any config when no existing config exists
      const newConfig = result.entities.PoolLauncherConfig.get(newConfigId);
      expect(newConfig).to.be.undefined;

      const oldConfig = result.entities.PoolLauncherConfig.get(oldConfigId);
      expect(oldConfig).to.be.undefined;
    });
  });
});
