import type { PoolLauncherPool, Token } from "envio";
import { createTestIndexer } from "envio";
import { PoolId, TokenId, toChecksumAddress } from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { type MockPool, setupCommon } from "../Pool/common";

describe("CLPoolLauncher Events", () => {
  const { createMockPool, mockToken0Data, mockToken1Data } = setupCommon();

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

  let mockPool: MockPool;
  let indexer: ReturnType<typeof createTestIndexer>;

  beforeEach(() => {
    mockPool = createMockPool({
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
    });

    indexer = createTestIndexer();
    indexer.Token.set(mockToken0);
    indexer.Token.set(mockToken1);
    indexer.Pool.set(mockPool);
  });

  describe("CLPoolLauncher.Launch", () => {
    it("should create a new PoolLauncherPool and link to Pool", async () => {
      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "Launch",
        params: {
          pool: mockPoolAddress,
          sender: mockCreator,
          poolLauncherToken: mockPoolLauncherToken,
          poolLauncherPool: [
            1000000n,
            mockPairToken,
            mockPoolLauncherToken,
            mockPoolAddress,
          ],
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Check that PoolLauncherPool was created
      const poolLauncherPool = await indexer.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeDefined();
      expect(poolLauncherPool?.underlyingPool).toBe(mockPoolAddress);
      expect(poolLauncherPool?.launcher).toBe(mockLauncherAddress);
      expect(poolLauncherPool?.creator).toBe(mockCreator);
      expect(poolLauncherPool?.poolLauncherToken).toBe(mockPoolLauncherToken);
      expect(poolLauncherPool?.pairToken).toBe(mockPairToken);
      expect(poolLauncherPool?.isEmerging).toBe(false);

      // Check that Pool was linked
      const liquidityPoolAggregator = await indexer.Pool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(liquidityPoolAggregator).toBeDefined();
      expect(liquidityPoolAggregator?.poolLauncherPoolId).toBe(
        PoolId(mockChainId, mockPoolAddress),
      );
    });
  });

  describe("CLPoolLauncher.Migrate", () => {
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

      indexer.PoolLauncherPool.set(existingPoolLauncherPool);

      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "Migrate",
        params: {
          underlyingPool,
          locker: oldLocker,
          newLocker,
          newPoolLauncherPool: [
            1000000n,
            mockPairToken,
            mockPoolLauncherToken,
            newPoolAddress,
          ],
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Check that original PoolLauncherPool was updated with migration info
      const originalPoolLauncherPool = await indexer.PoolLauncherPool.get(
        PoolId(mockChainId, underlyingPool),
      );
      expect(originalPoolLauncherPool).toBeDefined();
      expect(originalPoolLauncherPool?.migratedTo).toBe(newPoolAddress);
      expect(originalPoolLauncherPool?.oldLocker).toBe(oldLocker);
      expect(originalPoolLauncherPool?.newLocker).toBe(newLocker);
      expect(
        new Date(
          originalPoolLauncherPool?.lastMigratedAt as unknown as string,
        ).getTime(),
      ).toBe(mockTimestamp.getTime());

      // Check that new PoolLauncherPool was created
      const newPoolLauncherPool = await indexer.PoolLauncherPool.get(
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

      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "Migrate",
        params: {
          underlyingPool,
          locker: oldLocker,
          newLocker,
          newPoolLauncherPool: [
            1000000n,
            mockPairToken,
            mockPoolLauncherToken,
            newPoolAddress,
          ],
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Should not create any PoolLauncherPool entities since original doesn't exist
      const originalPoolLauncherPool = await indexer.PoolLauncherPool.get(
        PoolId(mockChainId, underlyingPool),
      );
      expect(originalPoolLauncherPool).toBeUndefined();

      const newPoolLauncherPool = await indexer.PoolLauncherPool.get(
        PoolId(mockChainId, newPoolAddress),
      );
      expect(newPoolLauncherPool).toBeUndefined();
    });
  });

  describe("CLPoolLauncher.EmergingFlagged", () => {
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

      indexer.PoolLauncherPool.set(existingPoolLauncherPool);

      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "EmergingFlagged",
        params: {
          pool: mockPoolAddress,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      const poolLauncherPool = await indexer.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeDefined();
      expect(poolLauncherPool?.isEmerging).toBe(true);
      expect(
        new Date(
          poolLauncherPool?.lastFlagUpdateAt as unknown as string,
        ).getTime(),
      ).toBe(mockTimestamp.getTime());
    });

    it("should handle flagging when PoolLauncherPool doesn't exist", async () => {
      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "EmergingFlagged",
        params: {
          pool: mockPoolAddress,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Should not create any PoolLauncherPool entities
      const poolLauncherPool = await indexer.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeUndefined();
    });
  });

  describe("CLPoolLauncher.EmergingUnflagged", () => {
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

      indexer.PoolLauncherPool.set(existingPoolLauncherPool);

      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "EmergingUnflagged",
        params: {
          pool: mockPoolAddress,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      const poolLauncherPool = await indexer.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeDefined();
      expect(poolLauncherPool?.isEmerging).toBe(false);
      expect(
        new Date(
          poolLauncherPool?.lastFlagUpdateAt as unknown as string,
        ).getTime(),
      ).toBe(mockTimestamp.getTime());
    });

    it("should handle unflagging when PoolLauncherPool doesn't exist", async () => {
      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "EmergingUnflagged",
        params: {
          pool: mockPoolAddress,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Should not create any PoolLauncherPool entities
      const poolLauncherPool = await indexer.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeUndefined();
    });
  });

  describe("CLPoolLauncher.CreationTimestampSet", () => {
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

      indexer.PoolLauncherPool.set(existingPoolLauncherPool);

      const newTimestamp = 1000000n;
      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "CreationTimestampSet",
        params: {
          pool: mockPoolAddress,
          createdAt: newTimestamp,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      const poolLauncherPool = await indexer.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeDefined();
      expect(
        new Date(poolLauncherPool?.createdAt as unknown as string).getTime(),
      ).toBe(new Date(Number(newTimestamp) * 1000).getTime());
    });

    it("should handle timestamp update when PoolLauncherPool doesn't exist", async () => {
      const newTimestamp = 1000000n;
      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "CreationTimestampSet",
        params: {
          pool: mockPoolAddress,
          createdAt: newTimestamp,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Should not create any PoolLauncherPool entities
      const poolLauncherPool = await indexer.PoolLauncherPool.get(
        PoolId(mockChainId, mockPoolAddress),
      );
      expect(poolLauncherPool).toBeUndefined();
    });
  });

  describe("CLPoolLauncher.PairableTokenAdded", () => {
    it("should create new PoolLauncherConfig when adding first token", async () => {
      const tokenAddress = toChecksumAddress(
        "0x8888888888888888888888888888888888888888",
      );
      const configId = PoolId(mockChainId, mockLauncherAddress);

      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "PairableTokenAdded",
        params: {
          token: tokenAddress,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Should create new PoolLauncherConfig
      const config = await indexer.PoolLauncherConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.id).toBe(configId);
      expect(config?.version).toBe("CL");
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
        version: "CL",
        pairableTokens: [existingToken],
      };
      indexer.PoolLauncherConfig.set(existingConfig);

      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "PairableTokenAdded",
        params: {
          token: newToken,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Should update existing PoolLauncherConfig
      const config = await indexer.PoolLauncherConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.id).toBe(configId);
      expect(config?.version).toBe("CL");
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
        version: "CL",
        pairableTokens: [tokenAddress],
      };
      indexer.PoolLauncherConfig.set(existingConfig);

      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "PairableTokenAdded",
        params: {
          token: tokenAddress,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Should not add duplicate token
      const config = await indexer.PoolLauncherConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.pairableTokens).toEqual([tokenAddress]);
    });
  });

  describe("CLPoolLauncher.PairableTokenRemoved", () => {
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
        version: "CL",
        pairableTokens: [tokenToRemove, remainingToken],
      };
      indexer.PoolLauncherConfig.set(existingConfig);

      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "PairableTokenRemoved",
        params: {
          token: tokenToRemove,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Should update PoolLauncherConfig by removing the token
      const config = await indexer.PoolLauncherConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.id).toBe(configId);
      expect(config?.version).toBe("CL");
      expect(config?.pairableTokens).toEqual([remainingToken]);
    });

    it("should handle removal when config doesn't exist", async () => {
      const tokenAddress = toChecksumAddress(
        "0x8888888888888888888888888888888888888888",
      );
      const configId = PoolId(mockChainId, mockLauncherAddress);

      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "PairableTokenRemoved",
        params: {
          token: tokenAddress,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Should not create any config when trying to remove from non-existent config
      const config = await indexer.PoolLauncherConfig.get(configId);
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
        version: "CL",
        pairableTokens: [existingToken],
      };
      indexer.PoolLauncherConfig.set(existingConfig);

      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "PairableTokenRemoved",
        params: {
          token: nonExistentToken,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Should keep existing tokens unchanged
      const config = await indexer.PoolLauncherConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.pairableTokens).toEqual([existingToken]);
    });
  });

  describe("CLPoolLauncher.NewPoolLauncherSet", () => {
    const newPoolLauncher = toChecksumAddress(
      "0x8888888888888888888888888888888888888888",
    );
    const oldConfigId = PoolId(mockChainId, mockLauncherAddress);
    const newConfigId = PoolId(mockChainId, newPoolLauncher);

    it("should update PoolLauncherConfig ID when pool launcher changes", async () => {
      // Set up existing config
      const existingConfig = {
        id: oldConfigId,
        version: "CL",
        pairableTokens: [
          toChecksumAddress("0x1111111111111111111111111111111111111111"),
          toChecksumAddress("0x2222222222222222222222222222222222222222"),
        ],
      };
      indexer.PoolLauncherConfig.set(existingConfig);

      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "NewPoolLauncherSet",
        params: {
          newPoolLauncher,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Should create new config with updated ID
      const newConfig = await indexer.PoolLauncherConfig.get(newConfigId);
      expect(newConfig).toBeDefined();
      expect(newConfig?.id).toBe(newConfigId);
      expect(newConfig?.version).toBe("CL");
      expect(newConfig?.pairableTokens).toEqual(existingConfig.pairableTokens);

      // Old config should still exist (we're not deleting it)
      const oldConfig = await indexer.PoolLauncherConfig.get(oldConfigId);
      expect(oldConfig).toBeDefined();
    });

    it("should handle pool launcher change when no existing config", async () => {
      await simulateEvent(indexer, mockChainId, {
        contract: "CLPoolLauncher",
        event: "NewPoolLauncherSet",
        params: {
          newPoolLauncher,
        },
        block: {
          timestamp: 1000000,
          number: 1,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        srcAddress: mockLauncherAddress,
      });

      // Should not create any config when no existing config exists
      const newConfig = await indexer.PoolLauncherConfig.get(newConfigId);
      expect(newConfig).toBeUndefined();

      const oldConfig = await indexer.PoolLauncherConfig.get(oldConfigId);
      expect(oldConfig).toBeUndefined();
    });
  });
});
