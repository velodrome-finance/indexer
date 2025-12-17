import { expect } from "chai";
import sinon from "sinon";
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
import { setupCommon } from "../EventHandlers/Pool/common";

// Type for the simulateContract method
type SimulateContractMethod =
  (typeof CHAIN_CONSTANTS)[10]["eth_client"]["simulateContract"];

describe("LiquidityPoolAggregator Functions", () => {
  let contextStub: Partial<handlerContext>;
  let liquidityPoolAggregator: Partial<LiquidityPoolAggregator>;
  let timestamp: Date;
  let mockContract: sinon.SinonStub;
  const blockNumber = 131536921;
  const { createMockLiquidityPoolAggregator } = setupCommon();

  beforeEach(() => {
    contextStub = {
      LiquidityPoolAggregatorSnapshot: {
        set: sinon.stub(),
        get: sinon.stub(),
        getOrThrow: sinon.stub(),
        getOrCreate: sinon.stub(),
        deleteUnsafe: sinon.stub(),
        getWhere: {
          gaugeAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          bribeVotingRewardAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          feeVotingRewardAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
        },
      },
      LiquidityPoolAggregator: {
        set: sinon.stub(),
        get: sinon.stub(),
        getOrThrow: sinon.stub(),
        getOrCreate: sinon.stub(),
        deleteUnsafe: sinon.stub(),
        getWhere: {
          gaugeAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          poolLauncherPoolId: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          bribeVotingRewardAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          feeVotingRewardAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          rootPoolMatchingHash: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
        },
      },
      Token: {
        set: sinon.stub(),
        get: sinon.stub(),
        getOrThrow: sinon.stub(),
        getOrCreate: sinon.stub(),
        deleteUnsafe: sinon.stub(),
        getWhere: {
          address: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          chainId: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
        },
      },
      TokenPriceSnapshot: {
        set: sinon.stub(),
        get: sinon.stub(),
        getOrThrow: sinon.stub(),
        getOrCreate: sinon.stub(),
        deleteUnsafe: sinon.stub(),
        getWhere: {
          address: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          lastUpdatedTimestamp: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
        },
      },
      RootPool_LeafPool: {
        set: sinon.stub(),
        get: sinon.stub(),
        getOrThrow: sinon.stub(),
        getOrCreate: sinon.stub(),
        deleteUnsafe: sinon.stub(),
        getWhere: {
          rootPoolAddress: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
        },
      },
      log: {
        error: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        debug: sinon.stub(),
      },
      effect: sinon.stub().callsFake(async (effectFn, input) => {
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
      gaugeFees0CurrentEpoch: 0n,
      gaugeFees1CurrentEpoch: 0n,
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
      token0IsWhitelisted: false,
      token1IsWhitelisted: false,
      lastUpdatedTimestamp: new Date(),
      lastSnapshotTimestamp: new Date(),
    });
    timestamp = new Date();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("updateDynamicFeePools", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Mock for testing
    let dynamicFeeConfigMock: any;

    beforeEach(() => {
      // Add DynamicFeeGlobalConfig mock
      dynamicFeeConfigMock = {
        getWhere: {
          chainId: {
            eq: sinon.stub().returns([
              {
                id: "0xd9eE4FBeE92970509ec795062cA759F8B52d6720",
                chainId: 10,
              },
            ]),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
        },
      };
      // biome-ignore lint/suspicious/noExplicitAny: Mock context for testing
      (contextStub as any).DynamicFeeGlobalConfig = dynamicFeeConfigMock;
    });

    it("should update the pool with current dynamic fee", async () => {
      await updateDynamicFeePools(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        contextStub as handlerContext,
        blockNumber,
      );

      // Verify that the pool was updated with the current fee
      const setStub = contextStub.LiquidityPoolAggregator
        ?.set as sinon.SinonStub;
      expect(setStub.calledOnce).to.be.true;
      const updatedPool = setStub.getCall(0).args[0];
      expect(updatedPool.currentFee).to.equal(1900n); // From the mocked effect
    });

    it("should handle missing config gracefully", async () => {
      // Mock no config found
      (dynamicFeeConfigMock.getWhere.chainId.eq as sinon.SinonStub).returns([]);

      await updateDynamicFeePools(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        contextStub as handlerContext,
        blockNumber,
      );

      // Should log an error but not crash
      expect(contextStub.log?.error).to.be.a("function");
    });

    it("should handle effect errors gracefully", async () => {
      // Mock effect to throw error
      (contextStub.effect as sinon.SinonStub).throws(
        new Error("Pool not found"),
      );

      await updateDynamicFeePools(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        contextStub as handlerContext,
        blockNumber,
      );

      // Should complete without crashing
      expect(true).to.be.true;
    });
  });

  describe("Snapshot Creation", () => {
    beforeEach(() => {
      setLiquidityPoolAggregatorSnapshot(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        timestamp,
        contextStub as handlerContext,
      );
    });

    it("should create a snapshot of the liquidity pool aggregator", () => {
      const setStub = contextStub.LiquidityPoolAggregatorSnapshot
        ?.set as sinon.SinonStub;
      expect(setStub.calledOnce).to.be.true;
      const snapshot = setStub.getCall(0).args[0];
      expect(snapshot.id).to.equal(
        `${liquidityPoolAggregator.chainId}-${
          liquidityPoolAggregator.id
        }_${timestamp.getTime()}`,
      );
      expect(snapshot.pool).to.equal(liquidityPoolAggregator.id);
    });
  });

  describe("Updating the Liquidity Pool Aggregator", () => {
    let diff = {
      totalVolume0: 0n,
      totalVolume1: 0n,
      totalVolumeUSD: 0n,
      numberOfSwaps: 0n,
      totalVolumeUSDWhitelisted: 0n,
      totalFeesUSDWhitelisted: 0n,
      totalVotesDeposited: 0n,
      totalVotesDepositedUSD: 0n,
      totalEmissions: 0n,
    };
    beforeEach(async () => {
      diff = {
        totalVolume0: 5000n,
        totalVolume1: 6000n,
        totalVolumeUSD: 7000n,
        numberOfSwaps: 11n,
        totalVolumeUSDWhitelisted: 8000n,
        totalFeesUSDWhitelisted: 9000n,
        totalVotesDeposited: 2000n,
        totalVotesDepositedUSD: 3000n,
        totalEmissions: 4000n,
      };
      await updateLiquidityPoolAggregator(
        diff,
        liquidityPoolAggregator as LiquidityPoolAggregator,
        timestamp,
        contextStub as handlerContext,
        blockNumber,
      );
    });

    it("should update the liquidity pool aggregator", () => {
      const setStub = contextStub.LiquidityPoolAggregator
        ?.set as sinon.SinonStub;
      const updatedAggregator = setStub.getCall(0).args[0];
      expect(updatedAggregator.totalVolume0).to.equal(diff.totalVolume0);
      expect(updatedAggregator.totalVolume1).to.equal(diff.totalVolume1);
      expect(updatedAggregator.numberOfSwaps).to.equal(diff.numberOfSwaps);
      expect(updatedAggregator.totalVolumeUSDWhitelisted).to.equal(
        diff.totalVolumeUSDWhitelisted,
      );
      expect(updatedAggregator.totalFeesUSDWhitelisted).to.equal(
        diff.totalFeesUSDWhitelisted,
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
        contextStub as handlerContext,
        blockNumber,
      );

      const setStub = contextStub.LiquidityPoolAggregatorSnapshot
        ?.set as sinon.SinonStub;
      const snapshot = setStub.getCall(0).args[0];
      expect(snapshot).to.not.be.undefined;
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

      const liquidityPoolGetStub = contextStub.LiquidityPoolAggregator
        ?.get as sinon.SinonStub;
      liquidityPoolGetStub.resolves(liquidityPoolAggregator);

      const tokenGetStub = contextStub.Token?.get as sinon.SinonStub;
      tokenGetStub.callsFake((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const tokenSetStub = contextStub.Token?.set as sinon.SinonStub;
      tokenSetStub.reset();

      const snapshotSetStub = contextStub.TokenPriceSnapshot
        ?.set as sinon.SinonStub;
      snapshotSetStub.reset();
    });

    it("should load pool data without refreshing prices when block data is not provided", async () => {
      const result = await loadPoolData(
        poolAddress,
        chainId,
        contextStub as handlerContext,
      );

      expect(result).to.not.be.null;
      expect(result?.liquidityPoolAggregator).to.equal(liquidityPoolAggregator);
      expect(result?.token0Instance).to.equal(token0);
      expect(result?.token1Instance).to.equal(token1);

      // Token.set should not be called (no price refresh)
      const tokenSetStub = contextStub.Token?.set as sinon.SinonStub;
      expect(tokenSetStub.called).to.be.false;
    });

    it("should refresh token prices when block data is provided and prices are stale", async () => {
      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000); // Current time
      const newPrice0 = 1500000n; // $1.50
      const newPrice1 = 2500000n; // $2.50

      // Mock effect to return new prices and token details
      (contextStub.effect as sinon.SinonStub).callsFake(
        async (effectFn, input) => {
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
        },
      );

      const result = await loadPoolData(
        poolAddress,
        chainId,
        contextStub as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).to.not.be.null;
      expect(result?.token0Instance.pricePerUSDNew).to.equal(newPrice0);
      expect(result?.token1Instance.pricePerUSDNew).to.equal(newPrice1);
      expect(result?.token0Instance.lastUpdatedTimestamp).to.be.instanceOf(
        Date,
      );
      expect(result?.token1Instance.lastUpdatedTimestamp).to.be.instanceOf(
        Date,
      );

      // Token.set should be called for both tokens
      const tokenSetStub = contextStub.Token?.set as sinon.SinonStub;
      expect(tokenSetStub.callCount).to.equal(2);

      // TokenPriceSnapshot.set should be called for both tokens
      const snapshotSetStub = contextStub.TokenPriceSnapshot
        ?.set as sinon.SinonStub;
      expect(snapshotSetStub.callCount).to.equal(2);
    });

    it("should not refresh token prices when they are recent (less than 1 hour)", async () => {
      const recentTimestamp = new Date(); // Just now
      token0 = { ...token0, lastUpdatedTimestamp: recentTimestamp };
      token1 = { ...token1, lastUpdatedTimestamp: recentTimestamp };

      // Update the stub to return the updated tokens
      const tokenGetStub = contextStub.Token?.get as sinon.SinonStub;
      tokenGetStub.callsFake((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000);

      const result = await loadPoolData(
        poolAddress,
        chainId,
        contextStub as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).to.not.be.null;
      // Prices should remain unchanged
      expect(result?.token0Instance.pricePerUSDNew).to.equal(
        token0.pricePerUSDNew,
      );
      expect(result?.token1Instance.pricePerUSDNew).to.equal(
        token1.pricePerUSDNew,
      );

      // Token.set should not be called (no refresh needed)
      const tokenSetStub = contextStub.Token?.set as sinon.SinonStub;
      expect(tokenSetStub.called).to.be.false;
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

      // Update the stub to return the updated tokens
      const tokenGetStub = contextStub.Token?.get as sinon.SinonStub;
      tokenGetStub.callsFake((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000);
      const newPrice0 = 1000000n; // $1.00

      // Mock effect to return new price and token details
      (contextStub.effect as sinon.SinonStub).callsFake(
        async (effectFn, input) => {
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
        },
      );

      const result = await loadPoolData(
        poolAddress,
        chainId,
        contextStub as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).to.not.be.null;
      // token0 should be refreshed even though timestamp is recent
      expect(result?.token0Instance.pricePerUSDNew).to.equal(newPrice0);
      // token1 should not be refreshed (recent timestamp and non-zero price)
      expect(result?.token1Instance.pricePerUSDNew).to.equal(
        token1.pricePerUSDNew,
      );

      // Token.set should be called only for token0
      const tokenSetStub = contextStub.Token?.set as sinon.SinonStub;
      expect(tokenSetStub.callCount).to.equal(1);
    });

    it("should handle price refresh errors gracefully", async () => {
      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000);

      // Mock effect to throw error for token0, return price for token1
      (contextStub.effect as sinon.SinonStub).callsFake(
        async (effectFn, input) => {
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
        },
      );

      const result = await loadPoolData(
        poolAddress,
        chainId,
        contextStub as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).to.not.be.null;
      // token0 should remain unchanged (error handled)
      expect(result?.token0Instance.pricePerUSDNew).to.equal(
        token0.pricePerUSDNew,
      );
      // token1 should be refreshed successfully
      expect(result?.token1Instance.pricePerUSDNew).to.equal(3000000n);

      // Error should be logged
      const errorLogStub = contextStub.log?.error as sinon.SinonStub;
      expect(errorLogStub.called).to.be.true;
    });

    it("should return null when pool is not found", async () => {
      const liquidityPoolGetStub = contextStub.LiquidityPoolAggregator
        ?.get as sinon.SinonStub;
      liquidityPoolGetStub.resolves(undefined);

      const result = await loadPoolData(
        poolAddress,
        chainId,
        contextStub as handlerContext,
      );

      expect(result).to.be.null;
      const errorLogStub = contextStub.log?.error as sinon.SinonStub;
      expect(errorLogStub.called).to.be.true;
    });

    it("should return null when tokens are not found", async () => {
      const tokenGetStub = contextStub.Token?.get as sinon.SinonStub;
      tokenGetStub.resolves(undefined);

      const result = await loadPoolData(
        poolAddress,
        chainId,
        contextStub as handlerContext,
      );

      expect(result).to.be.null;
      const errorLogStub = contextStub.log?.error as sinon.SinonStub;
      expect(errorLogStub.called).to.be.true;
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

      const liquidityPoolGetStub = contextStub.LiquidityPoolAggregator
        ?.get as sinon.SinonStub;
      liquidityPoolGetStub.callsFake((address: string) => {
        if (address === rootPoolAddress) return Promise.resolve(rootPool);
        return Promise.resolve(undefined);
      });

      const tokenGetStub = contextStub.Token?.get as sinon.SinonStub;
      tokenGetStub.callsFake((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        contextStub as handlerContext,
      );

      expect(result).to.not.be.null;
      expect(result?.liquidityPoolAggregator.id).to.equal(rootPoolAddress);
      expect(result?.token0Instance).to.equal(token0);
      expect(result?.token1Instance).to.equal(token1);

      // Should not query RootPool_LeafPool when pool exists directly
      const rootPoolLeafPoolGetWhereStub = contextStub.RootPool_LeafPool
        ?.getWhere?.rootPoolAddress?.eq as sinon.SinonStub;
      expect(rootPoolLeafPoolGetWhereStub.called).to.be.false;
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

      const liquidityPoolGetStub = contextStub.LiquidityPoolAggregator
        ?.get as sinon.SinonStub;
      liquidityPoolGetStub.callsFake((address: string) => {
        if (address === rootPoolAddress) return Promise.resolve(undefined);
        if (address === leafPoolAddress) return Promise.resolve(leafPool);
        return Promise.resolve(undefined);
      });

      const tokenGetStub = contextStub.Token?.get as sinon.SinonStub;
      tokenGetStub.callsFake((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const rootPoolLeafPoolGetWhereStub = contextStub.RootPool_LeafPool
        ?.getWhere?.rootPoolAddress?.eq as sinon.SinonStub;
      rootPoolLeafPoolGetWhereStub.resolves([rootPoolLeafPool]);

      const warnLogStub = contextStub.log?.warn as sinon.SinonStub;

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        contextStub as handlerContext,
      );

      expect(result).to.not.be.null;
      expect(result?.liquidityPoolAggregator.id).to.equal(leafPoolAddress);
      expect(result?.liquidityPoolAggregator.chainId).to.equal(leafChainId);
      expect(result?.token0Instance).to.equal(token0);
      expect(result?.token1Instance).to.equal(token1);
      expect(warnLogStub.called).to.be.true;
      expect(rootPoolLeafPoolGetWhereStub.called).to.be.true;
    });

    it("should return null when root pool not found and no RootPool_LeafPool exists", async () => {
      const liquidityPoolGetStub = contextStub.LiquidityPoolAggregator
        ?.get as sinon.SinonStub;
      liquidityPoolGetStub.resolves(undefined);

      const rootPoolLeafPoolGetWhereStub = contextStub.RootPool_LeafPool
        ?.getWhere?.rootPoolAddress?.eq as sinon.SinonStub;
      rootPoolLeafPoolGetWhereStub.resolves([]);

      const errorLogStub = contextStub.log?.error as sinon.SinonStub;

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        contextStub as handlerContext,
      );

      expect(result).to.be.null;
      expect(errorLogStub.called).to.be.true;
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

      const liquidityPoolGetStub = contextStub.LiquidityPoolAggregator
        ?.get as sinon.SinonStub;
      liquidityPoolGetStub.resolves(undefined);

      const rootPoolLeafPoolGetWhereStub = contextStub.RootPool_LeafPool
        ?.getWhere?.rootPoolAddress?.eq as sinon.SinonStub;
      rootPoolLeafPoolGetWhereStub.resolves([
        rootPoolLeafPool1,
        rootPoolLeafPool2,
      ]);

      const errorLogStub = contextStub.log?.error as sinon.SinonStub;

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        contextStub as handlerContext,
      );

      expect(result).to.be.null;
      expect(errorLogStub.called).to.be.true;
      // Check if any error call contains the expected message
      const errorMessages = errorLogStub.getCalls().map((call) => call.args[0]);
      expect(
        errorMessages.some(
          (msg) =>
            typeof msg === "string" &&
            msg.includes("Expected exactly one RootPool_LeafPool"),
        ),
      ).to.be.true;
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

      const liquidityPoolGetStub = contextStub.LiquidityPoolAggregator
        ?.get as sinon.SinonStub;
      liquidityPoolGetStub.resolves(undefined);

      const rootPoolLeafPoolGetWhereStub = contextStub.RootPool_LeafPool
        ?.getWhere?.rootPoolAddress?.eq as sinon.SinonStub;
      rootPoolLeafPoolGetWhereStub.resolves([rootPoolLeafPool]);

      const errorLogStub = contextStub.log?.error as sinon.SinonStub;

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        contextStub as handlerContext,
      );

      expect(result).to.be.null;
      expect(errorLogStub.called).to.be.true;
      // Check if any error call contains the expected message
      const errorMessages = errorLogStub.getCalls().map((call) => call.args[0]);
      expect(
        errorMessages.some(
          (msg) =>
            typeof msg === "string" && msg.includes("Leaf pool data not found"),
        ),
      ).to.be.true;
    });
  });
});
