import "../../eventHandlersRegistration";
import type {
  LiquidityPoolAggregator,
  PoolLauncherPool,
  Token,
} from "generated";
import { MockDb, V2PoolLauncher } from "generated/src/TestHelpers.gen";
import { PoolId, TokenId, toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("V2PoolLauncher Events", () => {
  const { createMockLiquidityPoolAggregator, mockToken0Data, mockToken1Data } =
    setupCommon();
  const mockChainId = 10;
  const mockPoolAddress = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const mockLauncherAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const mockCreator = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );
  const mockPoolLauncherToken = toChecksumAddress(
    "0x4444444444444444444444444444444444444444",
  );
  const mockPairToken = toChecksumAddress(
    "0x5555555555555555555555555555555555555555",
  );
  const mockTimestamp = new Date(1000000 * 1000);

  const mockToken0: Token = {
    ...mockToken0Data,
    id: TokenId(
      mockChainId,
      toChecksumAddress("0x6666666666666666666666666666666666666666"),
    ),
    address: toChecksumAddress("0x6666666666666666666666666666666666666666"),
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
    id: TokenId(
      mockChainId,
      toChecksumAddress("0x7777777777777777777777777777777777777777"),
    ),
    address: toChecksumAddress("0x7777777777777777777777777777777777777777"),
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
    mockLiquidityPoolAggregator = createMockLiquidityPoolAggregator({
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
    });

    mockDb = MockDb.createMockDb();
    mockDb = mockDb.entities.Token.set(mockToken0);
    mockDb = mockDb.entities.Token.set(mockToken1);
    mockDb = mockDb.entities.LiquidityPoolAggregator.set(
      mockLiquidityPoolAggregator,
    );
  });

  describe("V2PoolLauncher.Launch", () => {
    it("should create a new PoolLauncherPool and link to LiquidityPoolAggregator", async () => {
      const mockEvent = V2PoolLauncher.Launch.createMockEvent({
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

      const result = await mockDb.processEvents([mockEvent]);

      // Check that PoolLauncherPool was created
      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeDefined();
      expect(poolLauncherPool?.underlyingPool).toBe(mockPoolAddress);
      expect(poolLauncherPool?.launcher).toBe(mockLauncherAddress);
      expect(poolLauncherPool?.creator).toBe(mockCreator);
      expect(poolLauncherPool?.poolLauncherToken).toBe(mockPoolLauncherToken);
      expect(poolLauncherPool?.pairToken).toBe(mockPairToken);
      expect(poolLauncherPool?.isEmerging).toBe(false);

      // Check that LiquidityPoolAggregator was linked
      const liquidityPoolAggregator =
        result.entities.LiquidityPoolAggregator.get(
          PoolId(mockChainId, mockPoolAddress),
        );
      expect(liquidityPoolAggregator).toBeDefined();
      expect(liquidityPoolAggregator?.poolLauncherPoolId).toBe(
        PoolId(mockChainId, mockPoolAddress),
      );
    });
  });

  describe("V2PoolLauncher.Migrate", () => {
    it("should update existing PoolLauncherPool with migration info and create new one", async () => {
      const underlyingPool = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const newPoolAddress = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const oldLocker = toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      );
      const newLocker = toChecksumAddress(
        "0x4444444444444444444444444444444444444444",
      );

      // Create existing PoolLauncherPool
      const existingPoolLauncherPool: PoolLauncherPool = {
        id: PoolId(mockChainId, underlyingPool),
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

      const mockEvent = V2PoolLauncher.Migrate.createMockEvent({
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

      const result = await mockDb.processEvents([mockEvent]);

      // Check that original PoolLauncherPool was updated with migration info
      const originalPoolLauncherPool = result.entities.PoolLauncherPool.get(
        PoolId(mockChainId, underlyingPool),
      );
      expect(originalPoolLauncherPool).toBeDefined();
      expect(originalPoolLauncherPool?.migratedTo).toBe(newPoolAddress);
      expect(originalPoolLauncherPool?.oldLocker).toBe(oldLocker);
      expect(originalPoolLauncherPool?.newLocker).toBe(newLocker);
      expect(originalPoolLauncherPool?.lastMigratedAt).toEqual(mockTimestamp);

      // Check that new PoolLauncherPool was created
      const newPoolLauncherPool = result.entities.PoolLauncherPool.get(
        PoolId(mockChainId, newPoolAddress),
      );
      expect(newPoolLauncherPool).toBeDefined();
      expect(newPoolLauncherPool?.underlyingPool).toBe(newPoolAddress);
      expect(newPoolLauncherPool?.creator).toBe(mockCreator); // Should keep original creator
      expect(newPoolLauncherPool?.poolLauncherToken).toBe(
        mockPoolLauncherToken,
      );
      expect(newPoolLauncherPool?.pairToken).toBe(mockPairToken);
    });

    it("should handle migration when PoolLauncherPool doesn't exist", async () => {
      const underlyingPool = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const newPoolAddress = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const oldLocker = toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      );
      const newLocker = toChecksumAddress(
        "0x4444444444444444444444444444444444444444",
      );

      const mockEvent = V2PoolLauncher.Migrate.createMockEvent({
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

      const result = await mockDb.processEvents([mockEvent]);

      // Should not create any PoolLauncherPool entities since original doesn't exist
      const originalPoolLauncherPool = result.entities.PoolLauncherPool.get(
        PoolId(mockChainId, underlyingPool),
      );
      expect(originalPoolLauncherPool).toBeUndefined();

      const newPoolLauncherPool = result.entities.PoolLauncherPool.get(
        PoolId(mockChainId, newPoolAddress),
      );
      expect(newPoolLauncherPool).toBeUndefined();
    });
  });

  describe("V2PoolLauncher.EmergingFlagged", () => {
    it("should flag existing PoolLauncherPool as emerging", async () => {
      const existingPoolLauncherPool: PoolLauncherPool = {
        id: PoolId(mockChainId, mockPoolAddress),
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

      const mockEvent = V2PoolLauncher.EmergingFlagged.createMockEvent({
        pool: mockPoolAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeDefined();
      expect(poolLauncherPool?.isEmerging).toBe(true);
      expect(poolLauncherPool?.lastFlagUpdateAt).toEqual(mockTimestamp);
    });

    it("should handle flagging when PoolLauncherPool doesn't exist", async () => {
      const mockEvent = V2PoolLauncher.EmergingFlagged.createMockEvent({
        pool: mockPoolAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      // Should not create any PoolLauncherPool entities
      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeUndefined();
    });
  });

  describe("V2PoolLauncher.EmergingUnflagged", () => {
    it("should unflag existing PoolLauncherPool as emerging", async () => {
      const existingPoolLauncherPool: PoolLauncherPool = {
        id: PoolId(mockChainId, mockPoolAddress),
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

      const mockEvent = V2PoolLauncher.EmergingUnflagged.createMockEvent({
        pool: mockPoolAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeDefined();
      expect(poolLauncherPool?.isEmerging).toBe(false);
      expect(poolLauncherPool?.lastFlagUpdateAt).toEqual(mockTimestamp);
    });

    it("should handle unflagging when PoolLauncherPool doesn't exist", async () => {
      const mockEvent = V2PoolLauncher.EmergingUnflagged.createMockEvent({
        pool: mockPoolAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      // Should not create any PoolLauncherPool entities
      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeUndefined();
    });
  });

  describe("V2PoolLauncher.CreationTimestampSet", () => {
    it("should update creation timestamp for existing PoolLauncherPool", async () => {
      const existingPoolLauncherPool: PoolLauncherPool = {
        id: PoolId(mockChainId, mockPoolAddress),
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
      const mockEvent = V2PoolLauncher.CreationTimestampSet.createMockEvent({
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

      const result = await mockDb.processEvents([mockEvent]);

      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeDefined();
      expect(poolLauncherPool?.createdAt).toEqual(
        new Date(Number(newTimestamp) * 1000),
      );
    });

    it("should handle timestamp update when PoolLauncherPool doesn't exist", async () => {
      const newTimestamp = 1000000n;
      const mockEvent = V2PoolLauncher.CreationTimestampSet.createMockEvent({
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

      const result = await mockDb.processEvents([mockEvent]);

      // Should not create any PoolLauncherPool entities
      const poolLauncherPool = result.entities.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeUndefined();
    });
  });

  describe("V2PoolLauncher.PairableTokenAdded", () => {
    it("should create new PoolLauncherConfig when adding first token", async () => {
      const tokenAddress = toChecksumAddress(
        "0x8888888888888888888888888888888888888888",
      );
      const configId = PoolId(mockChainId, mockLauncherAddress);

      const mockEvent = V2PoolLauncher.PairableTokenAdded.createMockEvent({
        token: tokenAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      // Should create new PoolLauncherConfig
      const config = result.entities.PoolLauncherConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.id).toBe(configId);
      expect(config?.version).toBe("V2");
      expect(config?.pairableTokens).toEqual([tokenAddress]);
    });

    it("should add token to existing PoolLauncherConfig", async () => {
      const existingToken = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const newToken = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const configId = PoolId(mockChainId, mockLauncherAddress);

      // Set up existing config
      const existingConfig = {
        id: configId,
        version: "V2",
        pairableTokens: [existingToken],
      };
      mockDb = mockDb.entities.PoolLauncherConfig.set(existingConfig);

      const mockEvent = V2PoolLauncher.PairableTokenAdded.createMockEvent({
        token: newToken,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      // Should update existing PoolLauncherConfig
      const config = result.entities.PoolLauncherConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.id).toBe(configId);
      expect(config?.version).toBe("V2");
      expect(config?.pairableTokens).toEqual([existingToken, newToken]);
    });

    it("should not add duplicate token to PoolLauncherConfig", async () => {
      const tokenAddress = toChecksumAddress(
        "0x8888888888888888888888888888888888888888",
      );
      const configId = PoolId(mockChainId, mockLauncherAddress);

      // Set up existing config with the same token
      const existingConfig = {
        id: configId,
        version: "V2",
        pairableTokens: [tokenAddress],
      };
      mockDb = mockDb.entities.PoolLauncherConfig.set(existingConfig);

      const mockEvent = V2PoolLauncher.PairableTokenAdded.createMockEvent({
        token: tokenAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      // Should not add duplicate token
      const config = result.entities.PoolLauncherConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.pairableTokens).toEqual([tokenAddress]);
    });
  });

  describe("V2PoolLauncher.PairableTokenRemoved", () => {
    it("should remove token from existing PoolLauncherConfig", async () => {
      const tokenToRemove = toChecksumAddress(
        "0x8888888888888888888888888888888888888888",
      );
      const remainingToken = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const configId = PoolId(mockChainId, mockLauncherAddress);

      // Set up existing config with multiple tokens
      const existingConfig = {
        id: configId,
        version: "V2",
        pairableTokens: [tokenToRemove, remainingToken],
      };
      mockDb = mockDb.entities.PoolLauncherConfig.set(existingConfig);

      const mockEvent = V2PoolLauncher.PairableTokenRemoved.createMockEvent({
        token: tokenToRemove,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      // Should update PoolLauncherConfig by removing the token
      const config = result.entities.PoolLauncherConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.id).toBe(configId);
      expect(config?.version).toBe("V2");
      expect(config?.pairableTokens).toEqual([remainingToken]);
    });

    it("should handle removal when config doesn't exist", async () => {
      const tokenAddress = toChecksumAddress(
        "0x8888888888888888888888888888888888888888",
      );
      const configId = PoolId(mockChainId, mockLauncherAddress);

      const mockEvent = V2PoolLauncher.PairableTokenRemoved.createMockEvent({
        token: tokenAddress,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      // Should not create any config when trying to remove from non-existent config
      const config = result.entities.PoolLauncherConfig.get(configId);
      expect(config).toBeUndefined();
    });

    it("should handle removal of non-existent token gracefully", async () => {
      const existingToken = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const nonExistentToken = toChecksumAddress(
        "0x8888888888888888888888888888888888888888",
      );
      const configId = PoolId(mockChainId, mockLauncherAddress);

      // Set up existing config
      const existingConfig = {
        id: configId,
        version: "V2",
        pairableTokens: [existingToken],
      };
      mockDb = mockDb.entities.PoolLauncherConfig.set(existingConfig);

      const mockEvent = V2PoolLauncher.PairableTokenRemoved.createMockEvent({
        token: nonExistentToken,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      // Should keep existing tokens unchanged
      const config = result.entities.PoolLauncherConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.pairableTokens).toEqual([existingToken]);
    });
  });

  describe("V2PoolLauncher.NewPoolLauncherSet", () => {
    const newPoolLauncher = toChecksumAddress(
      "0x8888888888888888888888888888888888888888",
    );
    const oldConfigId = PoolId(mockChainId, mockLauncherAddress);
    const newConfigId = PoolId(mockChainId, newPoolLauncher);

    it("should update PoolLauncherConfig ID when pool launcher changes", async () => {
      // Set up existing config
      const existingConfig = {
        id: oldConfigId,
        version: "V2",
        pairableTokens: [
          toChecksumAddress("0x1111111111111111111111111111111111111111"),
          toChecksumAddress("0x2222222222222222222222222222222222222222"),
        ],
      };
      mockDb = mockDb.entities.PoolLauncherConfig.set(existingConfig);

      const mockEvent = V2PoolLauncher.NewPoolLauncherSet.createMockEvent({
        newPoolLauncher,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      // Should create new config with updated ID
      const newConfig = result.entities.PoolLauncherConfig.get(newConfigId);
      expect(newConfig).toBeDefined();
      expect(newConfig?.id).toBe(newConfigId);
      expect(newConfig?.version).toBe("V2");
      expect(newConfig?.pairableTokens).toEqual(existingConfig.pairableTokens);

      // Old config should still exist (we're not deleting it)
      const oldConfig = result.entities.PoolLauncherConfig.get(oldConfigId);
      expect(oldConfig).toBeDefined();
    });

    it("should handle pool launcher change when no existing config", async () => {
      const mockEvent = V2PoolLauncher.NewPoolLauncherSet.createMockEvent({
        newPoolLauncher,
        mockEventData: {
          block: {
            timestamp: 1000000,
          },
          srcAddress: mockLauncherAddress,
          chainId: mockChainId,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      // Should not create any config when no existing config exists
      const newConfig = result.entities.PoolLauncherConfig.get(newConfigId);
      expect(newConfig).toBeUndefined();

      const oldConfig = result.entities.PoolLauncherConfig.get(oldConfigId);
      expect(oldConfig).toBeUndefined();
    });
  });
});
