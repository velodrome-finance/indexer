import type {
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "../../generated/src/Types.gen";
import {
  loadPoolData,
  loadPoolDataOrRootCLPool,
  setLiquidityPoolAggregatorSnapshot,
  updateDynamicFeePools,
  updateLiquidityPoolAggregator,
} from "../../src/Aggregators/LiquidityPoolAggregator";
import type { CHAIN_CONSTANTS } from "../../src/Constants";
import { getCurrentFee } from "../../src/Effects/DynamicFee";
import { setupCommon } from "../EventHandlers/Pool/common";

// Type for the simulateContract method
type SimulateContractMethod =
  (typeof CHAIN_CONSTANTS)[10]["eth_client"]["simulateContract"];

describe("LiquidityPoolAggregator Functions", () => {
  let mockContext: Partial<handlerContext>;
  let liquidityPoolAggregator: Partial<LiquidityPoolAggregator>;
  let timestamp: Date;
  let mockContract: jest.Mock;
  const blockNumber = 131536921;
  const { createMockLiquidityPoolAggregator } = setupCommon();

  beforeEach(() => {
    mockContext = {
      LiquidityPoolAggregatorSnapshot: {
        set: jest.fn(),
        get: jest.fn(),
        getOrThrow: jest.fn(),
        getOrCreate: jest.fn(),
        deleteUnsafe: jest.fn(),
        getWhere: {
          gaugeAddress: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
          bribeVotingRewardAddress: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
          feeVotingRewardAddress: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
        },
      },
      LiquidityPoolAggregator: {
        set: jest.fn(),
        get: jest.fn(),
        getOrThrow: jest.fn(),
        getOrCreate: jest.fn(),
        deleteUnsafe: jest.fn(),
        getWhere: {
          gaugeAddress: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
          poolLauncherPoolId: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
          bribeVotingRewardAddress: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
          feeVotingRewardAddress: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
          rootPoolMatchingHash: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
        },
      },
      Token: {
        set: jest.fn(),
        get: jest.fn(),
        getOrThrow: jest.fn(),
        getOrCreate: jest.fn(),
        deleteUnsafe: jest.fn(),
        getWhere: {
          address: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
          chainId: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
        },
      },
      TokenPriceSnapshot: {
        set: jest.fn(),
        get: jest.fn(),
        getOrThrow: jest.fn(),
        getOrCreate: jest.fn(),
        deleteUnsafe: jest.fn(),
        getWhere: {
          address: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
          lastUpdatedTimestamp: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
        },
      },
      RootPool_LeafPool: {
        set: jest.fn(),
        get: jest.fn(),
        getOrThrow: jest.fn(),
        getOrCreate: jest.fn(),
        deleteUnsafe: jest.fn(),
        getWhere: {
          rootPoolAddress: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
        },
      },
      DynamicFeeGlobalConfig: {
        set: jest.fn(),
        get: jest.fn(),
        getOrThrow: jest.fn(),
        getOrCreate: jest.fn(),
        deleteUnsafe: jest.fn(),
        getWhere: {
          chainId: {
            eq: jest.fn().mockReturnValue([]),
            gt: jest.fn(),
            lt: jest.fn(),
          },
        },
      },
      log: {
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      },
      effect: jest.fn().mockImplementation(async (effectFn, input) => {
        // Mock the effect calls for testing
        if (effectFn.name === "getDynamicFeeConfig") {
          return {
            baseFee: 400n,
            feeCap: 2000n,
            scalingFactor: 10000000n,
          };
        }
        if (effectFn.name === "getCurrentFee") {
          return 1900n;
        }
        return {};
      }),
    };
    liquidityPoolAggregator = createMockLiquidityPoolAggregator({
      id: "0x1234567890123456789012345678901234567890",
      name: "Test Pool",
      token0_id: "token0",
      token1_id: "token1",
      token0_address: "0x1111111111111111111111111111111111111111",
      token1_address: "0x2222222222222222222222222222222222222222",
      isStable: false,
      isCL: false,
      reserve0: 0n,
      reserve1: 0n,
      totalLiquidityUSD: 0n,
      totalVolume0: 0n,
      totalVolume1: 0n,
      totalVolumeUSD: 0n,
      totalVolumeUSDWhitelisted: 0n,
      totalUnstakedFeesCollected0: 0n,
      totalUnstakedFeesCollected1: 0n,
      totalStakedFeesCollected0: 0n,
      totalStakedFeesCollected1: 0n,
      totalUnstakedFeesCollectedUSD: 0n,
      totalStakedFeesCollectedUSD: 0n,
      totalFeesUSDWhitelisted: 0n,
      numberOfSwaps: 0n,
      token0Price: 0n,
      token1Price: 0n,
      totalVotesDeposited: 0n,
      totalVotesDepositedUSD: 0n,
      totalEmissions: 0n,
      totalEmissionsUSD: 0n,
      totalBribesUSD: 0n,
      gaugeIsAlive: false,
      lastUpdatedTimestamp: new Date(),
      lastSnapshotTimestamp: new Date(),
    });
    timestamp = new Date();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("updateDynamicFeePools", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Mock for testing
    let dynamicFeeConfigMock: any;

    beforeEach(() => {
      // Add DynamicFeeGlobalConfig mock
      dynamicFeeConfigMock = {
        getWhere: {
          chainId: {
            eq: jest.fn().mockReturnValue([
              {
                id: "0xd9eE4FBeE92970509ec795062cA759F8B52d6720",
                chainId: 10,
              },
            ]),
            gt: jest.fn(),
            lt: jest.fn(),
          },
        },
      };
      (
        mockContext as unknown as {
          DynamicFeeGlobalConfig: typeof dynamicFeeConfigMock;
        }
      ).DynamicFeeGlobalConfig = dynamicFeeConfigMock;
    });

    it("should update the pool with current dynamic fee", async () => {
      const updatedPool = await updateDynamicFeePools(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        mockContext as handlerContext,
        blockNumber,
      );

      // Verify that the pool was updated with the current fee
      expect(updatedPool.currentFee).toBe(1900n); // From the mocked effect
    });

    it("should handle missing config gracefully", async () => {
      // Mock no config found
      jest.mocked(dynamicFeeConfigMock.getWhere.chainId.eq).mockReturnValue([]);

      await updateDynamicFeePools(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        mockContext as handlerContext,
        blockNumber,
      );

      // Should log a warning but not crash
      expect(jest.mocked(mockContext.log?.warn)).toHaveBeenCalled();
    });

    it("should handle effect errors gracefully", async () => {
      // Mock effect to return undefined (error case)
      expect(mockContext.effect).toBeDefined();
      jest
        // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
        .mocked(mockContext.effect!)
        .mockResolvedValue(undefined);

      // Should complete without throwing and skip update
      await updateDynamicFeePools(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        mockContext as handlerContext,
        blockNumber,
      );

      // Should log a warning
      expect(jest.mocked(mockContext.log?.warn)).toHaveBeenCalled();

      // Verify that the effect was called with the expected arguments
      // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
      const effectMock = jest.mocked(mockContext.effect!);
      expect(effectMock).toHaveBeenCalledWith(getCurrentFee, {
        poolAddress: liquidityPoolAggregator.id,
        dynamicFeeModuleAddress: "0xd9eE4FBeE92970509ec795062cA759F8B52d6720",
        chainId: liquidityPoolAggregator.chainId,
        blockNumber,
      });
    });
  });

  describe("Snapshot Creation", () => {
    beforeEach(() => {
      setLiquidityPoolAggregatorSnapshot(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        timestamp,
        mockContext as handlerContext,
      );
    });

    it("should create a snapshot of the liquidity pool aggregator", () => {
      const mockSet = jest.mocked(
        mockContext.LiquidityPoolAggregatorSnapshot?.set,
      );
      expect(mockSet).toHaveBeenCalledTimes(1);
      const snapshot = mockSet?.mock.calls[0]?.[0];
      expect(snapshot).toBeDefined();
      expect(snapshot?.id).toBe(
        `${liquidityPoolAggregator.chainId}-${
          liquidityPoolAggregator.id
        }_${timestamp.getTime()}`,
      );
      expect(snapshot?.pool).toBe(liquidityPoolAggregator.id);
    });
  });

  describe("Updating the Liquidity Pool Aggregator", () => {
    let diff = {
      incrementalTotalVolume0: 0n,
      incrementalTotalVolume1: 0n,
      incrementalTotalVolumeUSD: 0n,
      incrementalNumberOfSwaps: 0n,
      incrementalTotalVolumeUSDWhitelisted: 0n,
      incrementalTotalFeesUSDWhitelisted: 0n,
      totalVotesDeposited: 0n,
      totalVotesDepositedUSD: 0n,
      incrementalTotalEmissions: 0n,
    };
    beforeEach(async () => {
      diff = {
        incrementalTotalVolume0: 5000n,
        incrementalTotalVolume1: 6000n,
        incrementalTotalVolumeUSD: 7000n,
        incrementalNumberOfSwaps: 11n,
        incrementalTotalVolumeUSDWhitelisted: 8000n,
        incrementalTotalFeesUSDWhitelisted: 9000n,
        totalVotesDeposited: 2000n,
        totalVotesDepositedUSD: 3000n,
        incrementalTotalEmissions: 4000n,
      };
      await updateLiquidityPoolAggregator(
        diff,
        liquidityPoolAggregator as LiquidityPoolAggregator,
        timestamp,
        mockContext as handlerContext,
        blockNumber,
      );
    });

    it("should update the liquidity pool aggregator", () => {
      const mockSet = jest.mocked(mockContext.LiquidityPoolAggregator?.set);
      const updatedAggregator = mockSet?.mock
        .calls[0]?.[0] as LiquidityPoolAggregator;
      expect(updatedAggregator.totalVolume0).toBe(diff.incrementalTotalVolume0);
      expect(updatedAggregator.totalVolume1).toBe(diff.incrementalTotalVolume1);
      expect(updatedAggregator.numberOfSwaps).toBe(
        diff.incrementalNumberOfSwaps,
      );
      expect(updatedAggregator.totalVolumeUSDWhitelisted).toBe(
        diff.incrementalTotalVolumeUSDWhitelisted,
      );
      expect(updatedAggregator.totalFeesUSDWhitelisted).toBe(
        diff.incrementalTotalFeesUSDWhitelisted,
      );
    });

    it("should create a snapshot if the last update was more than 1 hour ago", async () => {
      // Set up a scenario where the last snapshot was more than 1 hour ago
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const currentTimestamp = new Date();

      const liquidityPoolWithOldSnapshot = {
        ...liquidityPoolAggregator,
        lastSnapshotTimestamp: oldTimestamp,
      };

      await updateLiquidityPoolAggregator(
        diff,
        liquidityPoolWithOldSnapshot as LiquidityPoolAggregator,
        currentTimestamp,
        mockContext as handlerContext,
        blockNumber,
      );

      const mockSet = jest.mocked(
        mockContext.LiquidityPoolAggregatorSnapshot?.set,
      );
      const snapshot = mockSet?.mock.calls[0]?.[0];
      expect(snapshot).toBeDefined();
    });
  });

  describe("loadPoolData", () => {
    let token0: Token;
    let token1: Token;
    const poolAddress = "0x1234567890123456789012345678901234567890";
    const chainId = 10;

    beforeEach(() => {
      token0 = {
        id: "token0",
        address: "0x1111111111111111111111111111111111111111",
        symbol: "TOKEN0",
        name: "Token 0",
        chainId: 10,
        decimals: 18n,
        pricePerUSDNew: 1000000n, // $1.00
        lastUpdatedTimestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        isWhitelisted: false,
      } as Token;

      token1 = {
        id: "token1",
        address: "0x2222222222222222222222222222222222222222",
        symbol: "TOKEN1",
        name: "Token 1",
        chainId: 10,
        decimals: 18n,
        pricePerUSDNew: 2000000n, // $2.00
        lastUpdatedTimestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        isWhitelisted: false,
      } as Token;

      const mockLiquidityPoolGet = jest.mocked(
        mockContext.LiquidityPoolAggregator?.get,
      );
      mockLiquidityPoolGet?.mockResolvedValue(
        liquidityPoolAggregator as unknown as LiquidityPoolAggregator,
      );

      const mockTokenGet = jest.mocked(mockContext.Token?.get);
      mockTokenGet?.mockImplementation((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const mockTokenSet = jest.mocked(mockContext.Token?.set);
      mockTokenSet?.mockClear();

      const mockSnapshotSet = jest.mocked(mockContext.TokenPriceSnapshot?.set);
      mockSnapshotSet?.mockClear();
    });

    it("should load pool data without refreshing prices when block data is not provided", async () => {
      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result).not.toBeNull();
      expect(result?.liquidityPoolAggregator).toBe(liquidityPoolAggregator);
      expect(result?.token0Instance).toBe(token0);
      expect(result?.token1Instance).toBe(token1);

      // Token.set should not be called (no price refresh)
      const mockTokenSet = jest.mocked(mockContext.Token?.set);
      expect(mockTokenSet).not.toHaveBeenCalled();
    });

    it("should refresh token prices when block data is provided and prices are stale", async () => {
      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000); // Current time
      const newPrice0 = 1500000n; // $1.50
      const newPrice1 = 2500000n; // $2.50

      // Mock effect to return new prices and token details
      expect(mockContext.effect).toBeDefined();
      jest
        // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
        .mocked(mockContext.effect!)
        // biome-ignore lint/suspicious/noExplicitAny: effect mock implementation needs flexible types
        .mockImplementation(async (effectFn: any, input: any) => {
          if (effectFn.name === "getTokenPrice") {
            if (
              input.tokenAddress.toLowerCase() === token0.address.toLowerCase()
            ) {
              return {
                pricePerUSDNew: newPrice0,
              };
            }
            if (
              input.tokenAddress.toLowerCase() === token1.address.toLowerCase()
            ) {
              return {
                pricePerUSDNew: newPrice1,
              };
            }
          }
          if (effectFn.name === "getTokenDetails") {
            if (
              input.contractAddress.toLowerCase() ===
              token0.address.toLowerCase()
            ) {
              return {
                name: token0.name,
                symbol: token0.symbol,
                decimals: Number(token0.decimals),
              };
            }
            if (
              input.contractAddress.toLowerCase() ===
              token1.address.toLowerCase()
            ) {
              return {
                name: token1.name,
                symbol: token1.symbol,
                decimals: Number(token1.decimals),
              };
            }
          }
          return {};
        });

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).not.toBeNull();
      expect(result?.token0Instance.pricePerUSDNew).toBe(newPrice0);
      expect(result?.token1Instance.pricePerUSDNew).toBe(newPrice1);
      expect(result?.token0Instance.lastUpdatedTimestamp).toBeInstanceOf(Date);
      expect(result?.token1Instance.lastUpdatedTimestamp).toBeInstanceOf(Date);

      // Token.set should be called for both tokens
      const mockTokenSet = jest.mocked(mockContext.Token?.set);
      expect(mockTokenSet).toHaveBeenCalledTimes(2);

      // TokenPriceSnapshot.set should be called for both tokens
      const mockSnapshotSet = jest.mocked(mockContext.TokenPriceSnapshot?.set);
      expect(mockSnapshotSet).toHaveBeenCalledTimes(2);
    });

    it("should not refresh token prices when they are recent (less than 1 hour)", async () => {
      const recentTimestamp = new Date(); // Just now
      token0 = { ...token0, lastUpdatedTimestamp: recentTimestamp };
      token1 = { ...token1, lastUpdatedTimestamp: recentTimestamp };

      // Update the mock to return the updated tokens
      const mockTokenGet = jest.mocked(mockContext.Token?.get);
      mockTokenGet?.mockImplementation((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000);

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).not.toBeNull();
      // Prices should remain unchanged
      expect(result?.token0Instance.pricePerUSDNew).toBe(token0.pricePerUSDNew);
      expect(result?.token1Instance.pricePerUSDNew).toBe(token1.pricePerUSDNew);

      // Token.set should not be called (no refresh needed)
      const mockTokenSet = jest.mocked(mockContext.Token?.set);
      expect(mockTokenSet).not.toHaveBeenCalled();
    });

    it("should always refresh token prices when pricePerUSDNew is 0", async () => {
      const recentTimestamp = new Date(); // Recent timestamp
      token0 = {
        ...token0,
        pricePerUSDNew: 0n,
        lastUpdatedTimestamp: recentTimestamp,
      };
      // Ensure token1 has recent timestamp so it won't be refreshed
      token1 = {
        ...token1,
        lastUpdatedTimestamp: recentTimestamp,
      };

      // Update the mock to return the updated tokens
      const mockTokenGet = jest.mocked(mockContext.Token?.get);
      mockTokenGet?.mockImplementation((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000);
      const newPrice0 = 1000000n; // $1.00

      // Mock effect to return new price and token details
      expect(mockContext.effect).toBeDefined();
      jest
        // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
        .mocked(mockContext.effect!)
        // biome-ignore lint/suspicious/noExplicitAny: effect mock implementation needs flexible types
        .mockImplementation(async (effectFn: any, input: any) => {
          if (effectFn.name === "getTokenPrice") {
            if (
              input.tokenAddress.toLowerCase() === token0.address.toLowerCase()
            ) {
              return {
                pricePerUSDNew: newPrice0,
              };
            }
            if (
              input.tokenAddress.toLowerCase() === token1.address.toLowerCase()
            ) {
              return {
                pricePerUSDNew: token1.pricePerUSDNew,
              };
            }
          }
          if (effectFn.name === "getTokenDetails") {
            if (
              input.contractAddress.toLowerCase() ===
              token0.address.toLowerCase()
            ) {
              return {
                name: token0.name,
                symbol: token0.symbol,
                decimals: Number(token0.decimals),
              };
            }
            if (
              input.contractAddress.toLowerCase() ===
              token1.address.toLowerCase()
            ) {
              return {
                name: token1.name,
                symbol: token1.symbol,
                decimals: Number(token1.decimals),
              };
            }
          }
          return {};
        });

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).not.toBeNull();
      // token0 should be refreshed even though timestamp is recent
      expect(result?.token0Instance.pricePerUSDNew).toBe(newPrice0);
      // token1 should not be refreshed (recent timestamp and non-zero price)
      expect(result?.token1Instance.pricePerUSDNew).toBe(token1.pricePerUSDNew);

      // Token.set should be called only for token0
      const mockTokenSet = jest.mocked(mockContext.Token?.set);
      expect(mockTokenSet).toHaveBeenCalledTimes(1);
    });

    it("should handle price refresh errors gracefully", async () => {
      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000);

      // Mock effect to throw error for token0, return price for token1
      expect(mockContext.effect).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
      const effectMock = jest.mocked(mockContext.effect!);
      // biome-ignore lint/suspicious/noExplicitAny: effect mock implementation needs flexible types
      effectMock.mockImplementation(async (effectFn: any, input: any) => {
        if (effectFn.name === "getTokenPrice") {
          if (
            input.tokenAddress.toLowerCase() === token0.address.toLowerCase()
          ) {
            throw new Error("Price fetch failed");
          }
          if (
            input.tokenAddress.toLowerCase() === token1.address.toLowerCase()
          ) {
            return {
              pricePerUSDNew: 3000000n,
            };
          }
        }
        if (effectFn.name === "getTokenDetails") {
          if (
            input.contractAddress.toLowerCase() === token0.address.toLowerCase()
          ) {
            return {
              name: token0.name,
              symbol: token0.symbol,
              decimals: Number(token0.decimals),
            };
          }
          if (
            input.contractAddress.toLowerCase() === token1.address.toLowerCase()
          ) {
            return {
              name: token1.name,
              symbol: token1.symbol,
              decimals: Number(token1.decimals),
            };
          }
        }
        return {};
      });

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).not.toBeNull();
      // token0 should remain unchanged (error handled)
      expect(result?.token0Instance.pricePerUSDNew).toBe(token0.pricePerUSDNew);
      // token1 should be refreshed successfully
      expect(result?.token1Instance.pricePerUSDNew).toBe(3000000n);

      // Error should be logged
      const mockErrorLog = jest.mocked(mockContext.log?.error);
      expect(mockErrorLog).toHaveBeenCalled();
    });

    it("should return null when pool is not found", async () => {
      const mockLiquidityPoolGet = jest.mocked(
        mockContext.LiquidityPoolAggregator?.get,
      );
      mockLiquidityPoolGet?.mockResolvedValue(undefined);

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result).toBeNull();
      const mockErrorLog = jest.mocked(mockContext.log?.error);
      expect(mockErrorLog).toHaveBeenCalled();
    });

    it("should return null when tokens are not found", async () => {
      const mockTokenGet = jest.mocked(mockContext.Token?.get);
      mockTokenGet?.mockResolvedValue(undefined);

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result).toBeNull();
      const mockErrorLog = jest.mocked(mockContext.log?.error);
      expect(mockErrorLog).toHaveBeenCalled();
    });
  });

  describe("loadPoolDataOrRootCLPool", () => {
    let token0: Token;
    let token1: Token;
    const rootPoolAddress = "0x1111111111111111111111111111111111111111";
    const leafPoolAddress = "0x2222222222222222222222222222222222222222";
    const chainId = 10;

    beforeEach(() => {
      token0 = {
        id: "token0",
        address: "0x3333333333333333333333333333333333333333",
        symbol: "TOKEN0",
        name: "Token 0",
        chainId: 10,
        decimals: 18n,
        pricePerUSDNew: 1000000n,
        lastUpdatedTimestamp: new Date(),
        isWhitelisted: false,
      } as Token;

      token1 = {
        id: "token1",
        address: "0x4444444444444444444444444444444444444444",
        symbol: "TOKEN1",
        name: "Token 1",
        chainId: 10,
        decimals: 18n,
        pricePerUSDNew: 2000000n,
        lastUpdatedTimestamp: new Date(),
        isWhitelisted: false,
      } as Token;
    });

    it("should return pool data directly when pool exists", async () => {
      const rootPool = createMockLiquidityPoolAggregator({
        id: rootPoolAddress,
        chainId: chainId,
        token0_id: "token0",
        token1_id: "token1",
        token0_address: token0.address,
        token1_address: token1.address,
      });

      const mockLiquidityPoolGet = jest.mocked(
        mockContext.LiquidityPoolAggregator?.get,
      );
      mockLiquidityPoolGet?.mockImplementation((address: string) => {
        if (address === rootPoolAddress) return Promise.resolve(rootPool);
        return Promise.resolve(undefined);
      });

      const mockTokenGet = jest.mocked(mockContext.Token?.get);
      mockTokenGet?.mockImplementation((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result).not.toBeNull();
      expect(result?.liquidityPoolAggregator.id).toBe(rootPoolAddress);
      expect(result?.token0Instance).toBe(token0);
      expect(result?.token1Instance).toBe(token1);

      // Should not query RootPool_LeafPool when pool exists directly
      const mockRootPoolLeafPoolGetWhere = jest.mocked(
        mockContext.RootPool_LeafPool?.getWhere?.rootPoolAddress?.eq,
      );
      expect(mockRootPoolLeafPoolGetWhere).not.toHaveBeenCalled();
    });

    it("should load leaf pool data when root pool is not found but RootPool_LeafPool exists", async () => {
      const leafChainId = 252;
      const leafPool = createMockLiquidityPoolAggregator({
        id: leafPoolAddress,
        chainId: leafChainId,
        token0_id: "token0",
        token1_id: "token1",
        token0_address: token0.address,
        token1_address: token1.address,
      });

      const rootPoolLeafPool = {
        id: `${rootPoolAddress}_${chainId}_${leafPoolAddress}_${leafChainId}`,
        rootChainId: chainId,
        rootPoolAddress: rootPoolAddress,
        leafChainId: leafChainId,
        leafPoolAddress: leafPoolAddress,
      };

      const mockLiquidityPoolGet = jest.mocked(
        mockContext.LiquidityPoolAggregator?.get,
      );
      mockLiquidityPoolGet?.mockImplementation((address: string) => {
        if (address === rootPoolAddress) return Promise.resolve(undefined);
        if (address === leafPoolAddress) return Promise.resolve(leafPool);
        return Promise.resolve(undefined);
      });

      const mockTokenGet = jest.mocked(mockContext.Token?.get);
      mockTokenGet?.mockImplementation((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const mockRootPoolLeafPoolGetWhere = jest.mocked(
        mockContext.RootPool_LeafPool?.getWhere?.rootPoolAddress?.eq,
      );
      mockRootPoolLeafPoolGetWhere?.mockResolvedValue([rootPoolLeafPool]);

      const mockWarnLog = jest.mocked(mockContext.log?.warn);

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result).not.toBeNull();
      expect(result?.liquidityPoolAggregator.id).toBe(leafPoolAddress);
      expect(result?.liquidityPoolAggregator.chainId).toBe(leafChainId);
      expect(result?.token0Instance).toBe(token0);
      expect(result?.token1Instance).toBe(token1);
      expect(mockWarnLog).toHaveBeenCalled();
      expect(mockRootPoolLeafPoolGetWhere).toHaveBeenCalled();
    });

    it("should return null when root pool not found and no RootPool_LeafPool exists", async () => {
      const mockLiquidityPoolGet = jest.mocked(
        mockContext.LiquidityPoolAggregator?.get,
      );
      mockLiquidityPoolGet?.mockResolvedValue(undefined);

      const mockRootPoolLeafPoolGetWhere = jest.mocked(
        mockContext.RootPool_LeafPool?.getWhere?.rootPoolAddress?.eq,
      );
      mockRootPoolLeafPoolGetWhere?.mockResolvedValue([]);

      const mockErrorLog = jest.mocked(mockContext.log?.error);

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result).toBeNull();
      expect(mockErrorLog).toHaveBeenCalled();
    });

    it("should return null when multiple RootPool_LeafPool entries exist", async () => {
      const rootPoolLeafPool1 = {
        id: `${rootPoolAddress}_${chainId}_${leafPoolAddress}_${chainId}`,
        rootChainId: chainId,
        rootPoolAddress: rootPoolAddress,
        leafChainId: chainId,
        leafPoolAddress: leafPoolAddress,
      };

      const rootPoolLeafPool2 = {
        id: `${rootPoolAddress}_${chainId}_0x5555555555555555555555555555555555555555_${chainId}`,
        rootChainId: chainId,
        rootPoolAddress: rootPoolAddress,
        leafChainId: chainId,
        leafPoolAddress: "0x5555555555555555555555555555555555555555",
      };

      const mockLiquidityPoolGet = jest.mocked(
        mockContext.LiquidityPoolAggregator?.get,
      );
      mockLiquidityPoolGet?.mockResolvedValue(undefined);

      const mockRootPoolLeafPoolGetWhere = jest.mocked(
        mockContext.RootPool_LeafPool?.getWhere?.rootPoolAddress?.eq,
      );
      mockRootPoolLeafPoolGetWhere?.mockResolvedValue([
        rootPoolLeafPool1,
        rootPoolLeafPool2,
      ]);

      const mockErrorLog = jest.mocked(mockContext.log?.error);

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result).toBeNull();
      expect(mockErrorLog).toHaveBeenCalled();
      // Check if any error call contains the expected message
      const errorMessages = mockErrorLog?.mock.calls.map((call) => call[0]);
      expect(
        errorMessages?.some(
          (msg) =>
            typeof msg === "string" &&
            msg.includes("Expected exactly one RootPool_LeafPool"),
        ),
      ).toBe(true);
    });

    it("should return null when leaf pool is not found", async () => {
      const leafChainId = 252;
      const rootPoolLeafPool = {
        id: `${rootPoolAddress}_${chainId}_${leafPoolAddress}_${leafChainId}`,
        rootChainId: chainId,
        rootPoolAddress: rootPoolAddress,
        leafChainId: leafChainId,
        leafPoolAddress: leafPoolAddress,
      };

      const mockLiquidityPoolGet = jest.mocked(
        mockContext.LiquidityPoolAggregator?.get,
      );
      mockLiquidityPoolGet?.mockResolvedValue(undefined);

      const mockRootPoolLeafPoolGetWhere = jest.mocked(
        mockContext.RootPool_LeafPool?.getWhere?.rootPoolAddress?.eq,
      );
      mockRootPoolLeafPoolGetWhere?.mockResolvedValue([rootPoolLeafPool]);

      const mockErrorLog = jest.mocked(mockContext.log?.error);

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result).toBeNull();
      expect(mockErrorLog).toHaveBeenCalled();
      // Check if any error call contains the expected message
      const errorMessages = mockErrorLog?.mock.calls.map((call) => call[0]);
      expect(
        errorMessages?.some(
          (msg) =>
            typeof msg === "string" && msg.includes("Leaf pool data not found"),
        ),
      ).toBe(true);
    });
  });
});
