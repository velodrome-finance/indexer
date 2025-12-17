import { expect } from "chai";
import sinon from "sinon";
import type { PublicClient } from "viem";
import { MockDb, PoolFactory } from "../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  RootPool_LeafPool,
  Token,
} from "../../generated/src/Types.gen";
import { CHAIN_CONSTANTS, toChecksumAddress } from "../../src/Constants";
import { getRootPoolAddress } from "../../src/Effects/RootPool";
import * as PriceOracle from "../../src/PriceOracle";
import { setupCommon } from "./Pool/common";

describe("PoolFactory Events", () => {
  const {
    mockToken0Data,
    mockToken1Data,
    mockLiquidityPoolData,
    createMockLiquidityPoolAggregator,
  } = setupCommon();
  const token0Address = mockToken0Data.address;
  const token1Address = mockToken1Data.address;
  const poolAddress = mockLiquidityPoolData.id;
  const chainId = 10;

  let mockPriceOracle: sinon.SinonStub;

  /**
   * Helper function to reset and reconfigure the mockPriceOracle stub
   * This avoids repetition across multiple test cases
   */
  function resetMockPriceOracle(): void {
    mockPriceOracle.reset();
    mockPriceOracle.callsFake(async (...args) => {
      if (args[0] === token0Address) return mockToken0Data as Token;
      return mockToken1Data as Token;
    });
  }

  describe("PoolCreated event", () => {
    let createdPool: LiquidityPoolAggregator | undefined;

    beforeEach(async () => {
      mockPriceOracle = sinon.stub(PriceOracle, "createTokenEntity");
      resetMockPriceOracle();

      const mockDb = MockDb.createMockDb();
      const mockEvent = PoolFactory.PoolCreated.createMockEvent({
        token0: token0Address,
        token1: token1Address,
        pool: poolAddress,
        stable: false,
        mockEventData: {
          block: {
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId,
          logIndex: 1,
        },
      });
      const result = await PoolFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb,
      });
      createdPool = result.entities.LiquidityPoolAggregator.get(poolAddress);
    });

    afterEach(() => {
      mockPriceOracle.restore();
    });

    it("should create token entities", () => {
      expect(mockPriceOracle.called).to.be.true;
      expect(mockPriceOracle.callCount).to.be.at.least(2);
    });

    it("should create a new LiquidityPool entity and Token entities", async () => {
      expect(createdPool).to.not.be.undefined;
      expect(createdPool?.isStable).to.be.false;
      expect(createdPool?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000 * 1000),
      );
    });

    it("should appropriately set token data on the aggregator", () => {
      expect(createdPool?.token0_id).to.equal(`${token0Address}-${chainId}`);
      expect(createdPool?.token1_id).to.equal(`${token1Address}-${chainId}`);
      expect(createdPool?.token0_address).to.equal(token0Address);
      expect(createdPool?.token1_address).to.equal(token1Address);
    });

    it("should NOT create RootPool_LeafPool for Optimism (chainId 10)", async () => {
      resetMockPriceOracle();

      const mockDb = MockDb.createMockDb();
      const mockEvent = PoolFactory.PoolCreated.createMockEvent({
        token0: token0Address,
        token1: token1Address,
        pool: poolAddress,
        stable: false,
        mockEventData: {
          block: {
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10, // Optimism
          logIndex: 1,
        },
      });

      const result = await PoolFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should not create RootPool_LeafPool for Optimism
      const rootPoolLeafPools = Array.from(
        result.entities.RootPool_LeafPool.getAll(),
      );
      expect(rootPoolLeafPools.length).to.equal(0);
    });

    it("should NOT create RootPool_LeafPool for Base (chainId 8453)", async () => {
      resetMockPriceOracle();

      const mockDb = MockDb.createMockDb();
      const mockEvent = PoolFactory.PoolCreated.createMockEvent({
        token0: token0Address,
        token1: token1Address,
        pool: poolAddress,
        stable: false,
        mockEventData: {
          block: {
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 8453, // Base
          logIndex: 1,
        },
      });

      const result = await PoolFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should not create RootPool_LeafPool for Base
      const rootPoolLeafPools = Array.from(
        result.entities.RootPool_LeafPool.getAll(),
      );
      expect(rootPoolLeafPools.length).to.equal(0);
    });

    it("should create RootPool_LeafPool for non-Optimism/Base chains (e.g., Fraxtal)", async () => {
      const fraxtalChainId = 252;
      const mockRootPoolAddressLowercase =
        "0x98dcff98d17f21e35211c923934924af65fbdd66";
      const mockLpHelperAddress = "0x2F44BD0Aff1826aec123cE3eA9Ce44445b64BB34";

      // Setup mock ethClient for Fraxtal
      const mockEthClient = {
        simulateContract: sinon.stub().resolves({
          result: mockRootPoolAddressLowercase,
        }),
      } as unknown as PublicClient;

      // Mock CHAIN_CONSTANTS for Fraxtal
      (
        CHAIN_CONSTANTS as Record<
          number,
          { eth_client: PublicClient; lpHelperAddress: string }
        >
      )[fraxtalChainId] = {
        eth_client: mockEthClient,
        lpHelperAddress: mockLpHelperAddress,
      };

      resetMockPriceOracle();

      const mockDb = MockDb.createMockDb();
      const mockEvent = PoolFactory.PoolCreated.createMockEvent({
        token0: token0Address,
        token1: token1Address,
        pool: poolAddress,
        stable: false,
        mockEventData: {
          block: {
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: fraxtalChainId,
          logIndex: 1,
        },
      });

      const result = await PoolFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should create RootPool_LeafPool for Fraxtal
      // The rootPoolAddress will be checksummed by the effect
      // ID format: rootPoolAddress_10_leafPoolAddress_leafChainId
      const expectedRootPoolAddress = toChecksumAddress(
        mockRootPoolAddressLowercase,
      );
      const rootPoolLeafPoolId = `${expectedRootPoolAddress}_10_${poolAddress}_${fraxtalChainId}`;
      const rootPoolLeafPool =
        result.entities.RootPool_LeafPool.get(rootPoolLeafPoolId);

      expect(rootPoolLeafPool).to.not.be.undefined;
      expect(rootPoolLeafPool?.rootChainId).to.equal(10); // Always 10 (Optimism)
      expect(rootPoolLeafPool?.rootPoolAddress).to.equal(
        expectedRootPoolAddress,
      );
      expect(rootPoolLeafPool?.leafChainId).to.equal(fraxtalChainId);
      expect(rootPoolLeafPool?.leafPoolAddress).to.equal(poolAddress);

      // Verify the effect was called
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      expect(mockSimulateContract.calledOnce).to.be.true;
    });

    it("should handle error when getRootPoolAddress fails for non-Optimism/Base chains", async () => {
      const fraxtalChainId = 252;
      const mockLpHelperAddress = "0x2F44BD0Aff1826aec123cE3eA9Ce44445b64BB34";

      // Setup mock ethClient that throws an error
      const mockEthClient = {
        simulateContract: sinon.stub().rejects(new Error("RPC call failed")),
      } as unknown as PublicClient;

      // Mock CHAIN_CONSTANTS for Fraxtal
      (
        CHAIN_CONSTANTS as Record<
          number,
          { eth_client: PublicClient; lpHelperAddress: string }
        >
      )[fraxtalChainId] = {
        eth_client: mockEthClient,
        lpHelperAddress: mockLpHelperAddress,
      };

      resetMockPriceOracle();

      const mockDb = MockDb.createMockDb();
      const mockEvent = PoolFactory.PoolCreated.createMockEvent({
        token0: token0Address,
        token1: token1Address,
        pool: poolAddress,
        stable: false,
        mockEventData: {
          block: {
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: fraxtalChainId,
          logIndex: 1,
        },
      });

      // The effect will throw an error, which should be caught by the handler
      // The handler checks if rootPoolAddress is falsy and returns early
      const result = await PoolFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should still create the pool even if root pool address fetch fails
      const createdPool =
        result.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(createdPool).to.not.be.undefined;

      // Should not create RootPool_LeafPool when effect fails (returns null/undefined)
      const rootPoolLeafPools = Array.from(
        result.entities.RootPool_LeafPool.getAll(),
      );
      // Note: The current implementation returns early if rootPoolAddress is falsy,
      // so we expect no RootPool_LeafPool to be created
      expect(rootPoolLeafPools.length).to.equal(0);
    });

    it("should handle null/undefined rootPoolAddress from effect", async () => {
      const fraxtalChainId = 252;
      const mockLpHelperAddress = "0x2F44BD0Aff1826aec123cE3eA9Ce44445b64BB34";

      // Setup mock ethClient that returns null
      // This will cause fetchRootPoolAddress to return empty string, which the handler should handle
      const mockEthClient = {
        simulateContract: sinon.stub().resolves({
          result: null,
        }),
      } as unknown as PublicClient;

      // Mock CHAIN_CONSTANTS for Fraxtal
      (
        CHAIN_CONSTANTS as Record<
          number,
          { eth_client: PublicClient; lpHelperAddress: string }
        >
      )[fraxtalChainId] = {
        eth_client: mockEthClient,
        lpHelperAddress: mockLpHelperAddress,
      };

      resetMockPriceOracle();

      const mockDb = MockDb.createMockDb();
      const mockEvent = PoolFactory.PoolCreated.createMockEvent({
        token0: token0Address,
        token1: token1Address,
        pool: poolAddress,
        stable: false,
        mockEventData: {
          block: {
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: fraxtalChainId,
          logIndex: 1,
        },
      });

      const result = await PoolFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should still create the pool
      const createdPool =
        result.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(createdPool).to.not.be.undefined;

      // Should not create RootPool_LeafPool when rootPoolAddress is null/undefined
      const rootPoolLeafPools = Array.from(
        result.entities.RootPool_LeafPool.getAll(),
      );
      expect(rootPoolLeafPools.length).to.equal(0);
    });
  });

  describe("SetCustomFee event", () => {
    it("should update the LiquidityPoolAggregator", async () => {
      // Setup - create a pool entity first
      let mockDb = MockDb.createMockDb();
      const existingPool = createMockLiquidityPoolAggregator({
        baseFee: undefined,
        currentFee: undefined,
        lastUpdatedTimestamp: new Date(900000 * 1000),
      });
      mockDb = mockDb.entities.LiquidityPoolAggregator.set(existingPool);

      const customFee = 500n; // 0.05% fee (500 basis points)
      const blockTimestamp = 2000000;
      const mockEvent = PoolFactory.SetCustomFee.createMockEvent({
        pool: poolAddress,
        fee: customFee,
        mockEventData: {
          block: {
            number: 2000000,
            timestamp: blockTimestamp,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 1,
        },
      });

      // Execute
      const result = await PoolFactory.SetCustomFee.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert - check LiquidityPoolAggregator was updated
      const updatedPool =
        result.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.baseFee).to.equal(customFee);
      expect(updatedPool?.currentFee).to.equal(customFee);
      expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
        new Date(blockTimestamp * 1000),
      );
      // Verify other fields are preserved
      expect(updatedPool?.id).to.equal(existingPool.id);
      expect(updatedPool?.chainId).to.equal(existingPool.chainId);
      expect(updatedPool?.token0_address).to.equal(existingPool.token0_address);
      expect(updatedPool?.token1_address).to.equal(existingPool.token1_address);
    });

    it("should update existing fee values when pool already has fees set", async () => {
      // Setup - create a pool entity with existing fees
      let mockDb = MockDb.createMockDb();
      const existingFee = 300n;
      const existingPool = createMockLiquidityPoolAggregator({
        baseFee: existingFee,
        currentFee: existingFee,
        lastUpdatedTimestamp: new Date(900000 * 1000),
      });
      mockDb = mockDb.entities.LiquidityPoolAggregator.set(existingPool);

      const newFee = 750n;
      const blockTimestamp = 2000000;
      const mockEvent = PoolFactory.SetCustomFee.createMockEvent({
        pool: poolAddress,
        fee: newFee,
        mockEventData: {
          block: {
            number: 2000000,
            timestamp: blockTimestamp,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 1,
        },
      });

      // Execute
      const result = await PoolFactory.SetCustomFee.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert - check fees were updated
      const updatedPool =
        result.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.baseFee).to.equal(newFee);
      expect(updatedPool?.currentFee).to.equal(newFee);
      expect(updatedPool?.baseFee).to.not.equal(existingFee);
      expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
        new Date(blockTimestamp * 1000),
      );
    });

    it("should return early without updating pool if pool does not exist", async () => {
      // Setup - no pool entity in mock DB
      const mockDb = MockDb.createMockDb();
      const nonExistentPoolAddress = toChecksumAddress(
        "0x9999999999999999999999999999999999999999",
      );
      const mockEvent = PoolFactory.SetCustomFee.createMockEvent({
        pool: nonExistentPoolAddress,
        fee: 100n,
        mockEventData: {
          block: {
            number: 2000000,
            timestamp: 2000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 2,
        },
      });

      // Execute
      const result = await PoolFactory.SetCustomFee.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert - LiquidityPoolAggregator should not be updated
      const pool = result.entities.LiquidityPoolAggregator.get(
        nonExistentPoolAddress,
      );
      expect(pool).to.be.undefined;
    });
  });
});
