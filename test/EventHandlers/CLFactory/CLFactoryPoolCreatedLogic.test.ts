import { expect } from "chai";
import type {
  CLFactory_PoolCreated_event,
  Token,
  handlerContext,
} from "generated";
import sinon from "sinon";
import { processCLFactoryPoolCreated } from "../../../src/EventHandlers/CLFactory/CLFactoryPoolCreatedLogic";
import * as PriceOracle from "../../../src/PriceOracle";
import { setupCommon } from "../Pool/common";

describe("CLFactoryPoolCreatedLogic", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();

  let mockCreateTokenEntity: sinon.SinonStub;

  beforeEach(() => {
    // Mock the createTokenEntity function using sinon
    mockCreateTokenEntity = sinon
      .stub(PriceOracle, "createTokenEntity")
      .callsFake(async (address: string) => ({
        id: "mock_token_id",
        address: address,
        symbol: "", // Empty symbol for missing tokens
        name: "Mock Token",
        decimals: 18n,
        pricePerUSDNew: 1000000000000000000n,
        chainId: 10,
        isWhitelisted: false,
        lastUpdatedTimestamp: new Date(),
      }));
  });

  afterEach(() => {
    // Restore the original function
    mockCreateTokenEntity.restore();
  });

  // Shared mock event for all tests
  const mockEvent: CLFactory_PoolCreated_event = {
    params: {
      token0: "0x2222222222222222222222222222222222222222",
      token1: "0x3333333333333333333333333333333333333333",
      tickSpacing: 60n,
      pool: "0x4444444444444444444444444444444444444444",
    },
    srcAddress: "0x1111111111111111111111111111111111111111",
    transaction: {
      hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
    },
    block: {
      timestamp: 1000000,
      number: 123456,
      hash: "0x6666666666666666666666666666666666666666666666666666666666666666",
    },
    chainId: 10,
    logIndex: 1,
  };

  // Mock context
  const mockContext = {
    log: {
      error: () => {},
    },
  } as unknown as handlerContext;

  // Shared mock loader return for success case
  const mockSuccessLoaderReturn = {
    poolToken0: mockToken0Data,
    poolToken1: mockToken1Data,
  };

  describe("processCLFactoryPoolCreated", () => {
    it("should create entity and liquidity pool aggregator for successful pool creation", async () => {
      // Process the pool created event
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockSuccessLoaderReturn,
        mockContext,
      );

      // Assertions
      expect(result.liquidityPoolAggregator).to.deep.include({
        id: "0x4444444444444444444444444444444444444444",
        chainId: 10,
        name: "CL-60 AMM - USDT/USDC",
        token0_id: "0x2222222222222222222222222222222222222222-10",
        token1_id: "0x3333333333333333333333333333333333333333-10",
        token0_address: "0x2222222222222222222222222222222222222222",
        token1_address: "0x3333333333333333333333333333333333333333",
        isStable: false,
        isCL: true,
        reserve0: 0n,
        reserve1: 0n,
        totalLiquidityUSD: 0n,
        token0IsWhitelisted: true,
        token1IsWhitelisted: true,
        gaugeIsAlive: false,
      });
      expect(result.error).to.be.undefined;
    });

    it("should handle missing token0 gracefully", async () => {
      const mockLoaderReturn = {
        poolToken0: undefined as Token | undefined,
        poolToken1: mockToken1Data,
      };

      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolAggregator).to.deep.include({
        id: "0x4444444444444444444444444444444444444444",
        chainId: 10,
        name: "CL-60 AMM - /USDC", // Empty symbol for token0
        token0_id: "0x2222222222222222222222222222222222222222-10",
        token1_id: "0x3333333333333333333333333333333333333333-10",
        token0_address: "0x2222222222222222222222222222222222222222",
        token1_address: "0x3333333333333333333333333333333333333333",
        isStable: false,
        isCL: true,
        reserve0: 0n,
        reserve1: 0n,
        totalLiquidityUSD: 0n,
        token0IsWhitelisted: false,
        token1IsWhitelisted: true,
        gaugeIsAlive: false,
      });
      expect(result.error).to.be.undefined;
    });

    it("should handle missing token1 gracefully", async () => {
      const mockLoaderReturn = {
        poolToken0: mockToken0Data,
        poolToken1: undefined as Token | undefined,
      };

      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolAggregator).to.deep.include({
        id: "0x4444444444444444444444444444444444444444",
        chainId: 10,
        name: "CL-60 AMM - USDT/", // Empty symbol for token1
        token0_id: "0x2222222222222222222222222222222222222222-10",
        token1_id: "0x3333333333333333333333333333333333333333-10",
        token0_address: "0x2222222222222222222222222222222222222222",
        token1_address: "0x3333333333333333333333333333333333333333",
        isStable: false,
        isCL: true,
        reserve0: 0n,
        reserve1: 0n,
        totalLiquidityUSD: 0n,
        token0IsWhitelisted: true,
        token1IsWhitelisted: false,
        gaugeIsAlive: false,
      });
      expect(result.error).to.be.undefined;
    });

    it("should handle both tokens missing gracefully", async () => {
      const mockLoaderReturn = {
        poolToken0: undefined as Token | undefined,
        poolToken1: undefined as Token | undefined,
      };

      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolAggregator).to.deep.include({
        id: "0x4444444444444444444444444444444444444444",
        chainId: 10,
        name: "CL-60 AMM - /", // Empty symbols for both tokens
        token0_id: "0x2222222222222222222222222222222222222222-10",
        token1_id: "0x3333333333333333333333333333333333333333-10",
        token0_address: "0x2222222222222222222222222222222222222222",
        token1_address: "0x3333333333333333333333333333333333333333",
        isStable: false,
        isCL: true,
        reserve0: 0n,
        reserve1: 0n,
        totalLiquidityUSD: 0n,
        token0IsWhitelisted: false,
        token1IsWhitelisted: false,
        gaugeIsAlive: false,
      });
      expect(result.error).to.be.undefined;
    });

    it("should handle different tick spacing values", async () => {
      const mockEventWithDifferentTickSpacing: CLFactory_PoolCreated_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          tickSpacing: 200n,
        },
      };

      const result = await processCLFactoryPoolCreated(
        mockEventWithDifferentTickSpacing,
        mockSuccessLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolAggregator?.name).to.equal(
        "CL-200 AMM - USDT/USDC",
      );
    });

    it("should handle non-whitelisted tokens correctly", async () => {
      const mockToken0NonWhitelisted: Token = {
        ...mockToken0Data,
        isWhitelisted: false,
      };

      const mockToken1NonWhitelisted: Token = {
        ...mockToken1Data,
        isWhitelisted: false,
      };

      const mockLoaderReturn = {
        poolToken0: mockToken0NonWhitelisted,
        poolToken1: mockToken1NonWhitelisted,
      };

      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolAggregator).to.deep.include({
        id: "0x4444444444444444444444444444444444444444",
        chainId: 10,
        name: "CL-60 AMM - USDT/USDC",
        token0_id: "0x2222222222222222222222222222222222222222-10",
        token1_id: "0x3333333333333333333333333333333333333333-10",
        token0_address: "0x2222222222222222222222222222222222222222",
        token1_address: "0x3333333333333333333333333333333333333333",
        isStable: false,
        isCL: true,
        reserve0: 0n,
        reserve1: 0n,
        totalLiquidityUSD: 0n,
        token0IsWhitelisted: false,
        token1IsWhitelisted: false,
        gaugeIsAlive: false,
      });
      expect(result.error).to.be.undefined;
    });

    it("should handle mixed whitelist status correctly", async () => {
      const mockToken0Whitelisted: Token = {
        ...mockToken0Data,
        isWhitelisted: true,
      };

      const mockToken1NonWhitelisted: Token = {
        ...mockToken1Data,
        isWhitelisted: false,
      };

      const mockLoaderReturn = {
        poolToken0: mockToken0Whitelisted,
        poolToken1: mockToken1NonWhitelisted,
      };

      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolAggregator).to.deep.include({
        id: "0x4444444444444444444444444444444444444444",
        chainId: 10,
        name: "CL-60 AMM - USDT/USDC",
        token0_id: "0x2222222222222222222222222222222222222222-10",
        token1_id: "0x3333333333333333333333333333333333333333-10",
        token0_address: "0x2222222222222222222222222222222222222222",
        token1_address: "0x3333333333333333333333333333333333333333",
        isStable: false,
        isCL: true,
        reserve0: 0n,
        reserve1: 0n,
        totalLiquidityUSD: 0n,
        token0IsWhitelisted: true,
        token1IsWhitelisted: false,
        gaugeIsAlive: false,
      });
      expect(result.error).to.be.undefined;
    });

    it("should handle different chain IDs correctly", async () => {
      const mockEventWithDifferentChainId: CLFactory_PoolCreated_event = {
        ...mockEvent,
        chainId: 8453, // Base
      };

      const result = await processCLFactoryPoolCreated(
        mockEventWithDifferentChainId,
        mockSuccessLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolAggregator?.chainId).to.equal(8453);
      expect(result.liquidityPoolAggregator?.token0_id).to.equal(
        "0x2222222222222222222222222222222222222222-8453",
      );
      expect(result.liquidityPoolAggregator?.token1_id).to.equal(
        "0x3333333333333333333333333333333333333333-8453",
      );
    });

    it("should handle different token symbols correctly", async () => {
      const mockToken0WithSymbol: Token = {
        ...mockToken0Data,
        symbol: "WETH",
        name: "Wrapped Ether",
      };

      const mockToken1WithSymbol: Token = {
        ...mockToken1Data,
        symbol: "USDC",
        name: "USD Coin",
      };

      const mockLoaderReturn = {
        poolToken0: mockToken0WithSymbol,
        poolToken1: mockToken1WithSymbol,
      };

      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolAggregator?.name).to.equal(
        "CL-60 AMM - WETH/USDC",
      );
    });

    it("should handle error during processing gracefully", async () => {
      // Restore the current stub and create a new one that throws
      mockCreateTokenEntity.restore();
      mockCreateTokenEntity = sinon
        .stub(PriceOracle, "createTokenEntity")
        .callsFake(async () => {
          throw new Error("Token creation failed");
        });

      // Use a loader return with undefined tokens to trigger createTokenEntity
      const loaderReturnWithMissingTokens = {
        poolToken0: undefined,
        poolToken1: undefined,
      };

      const result = await processCLFactoryPoolCreated(
        mockEvent,
        loaderReturnWithMissingTokens,
        mockContext,
      );

      // The function should complete successfully (errors are logged but don't propagate)
      expect(result.error).to.be.undefined;
    });

    it("should set all initial values correctly for new pool", async () => {
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockSuccessLoaderReturn,
        mockContext,
      );

      const aggregator = result.liquidityPoolAggregator;
      expect(aggregator).to.exist;

      // All initial values should be set correctly for a new pool
      expect(aggregator).to.deep.include({
        // All numeric values should be 0 for a new pool
        reserve0: 0n,
        reserve1: 0n,
        totalLiquidityUSD: 0n,
        totalVolume0: 0n,
        totalVolume1: 0n,
        totalVolumeUSD: 0n,
        totalVolumeUSDWhitelisted: 0n,
        totalFees0: 0n,
        totalFees1: 0n,
        gaugeFees0CurrentEpoch: 0n,
        gaugeFees1CurrentEpoch: 0n,
        totalFeesUSD: 0n,
        totalFeesUSDWhitelisted: 0n,
        numberOfSwaps: 0n,
        token0Price: 0n,
        token1Price: 0n,
        totalVotesDeposited: 0n,
        totalVotesDepositedUSD: 0n,
        totalEmissions: 0n,
        totalEmissionsUSD: 0n,
        totalBribesUSD: 0n,
        // Boolean values
        isStable: false,
        isCL: true,
        gaugeIsAlive: false,
        // Timestamps should be set to event timestamp
        lastUpdatedTimestamp: new Date(1000000 * 1000),
        lastSnapshotTimestamp: new Date(1000000 * 1000),
      });
    });
  });
});
