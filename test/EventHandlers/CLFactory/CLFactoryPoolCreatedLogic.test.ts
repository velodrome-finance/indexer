import type {
  CLFactory_PoolCreated_event,
  CLGaugeConfig,
  FeeToTickSpacingMapping,
  Token,
  handlerContext,
} from "generated";
import { PoolId, toChecksumAddress } from "../../../src/Constants";
import { processCLFactoryPoolCreated } from "../../../src/EventHandlers/CLFactory/CLFactoryPoolCreatedLogic";
import * as PriceOracle from "../../../src/PriceOracle";
import { setupCommon } from "../Pool/common";

describe("CLFactoryPoolCreatedLogic", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock the createTokenEntity function using Jest
    jest
      .spyOn(PriceOracle, "createTokenEntity")
      .mockImplementation(async (address: string) => ({
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
    jest.restoreAllMocks();
  });

  // Shared mock event for all tests
  const mockEvent: CLFactory_PoolCreated_event = {
    params: {
      token0: toChecksumAddress("0x2222222222222222222222222222222222222222"),
      token1: toChecksumAddress("0x3333333333333333333333333333333333333333"),
      tickSpacing: 60n,
      pool: toChecksumAddress("0x4444444444444444444444444444444444444444"),
    },
    srcAddress: toChecksumAddress("0x1111111111111111111111111111111111111111"),
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

  // Shared constants
  const CHAIN_ID = 10;
  const TICK_SPACING = 60n;
  const FEE = 500n;
  const LEAF_POOL_ADDRESS = mockEvent.params.pool;
  const LEAF_POOL_ID = PoolId(CHAIN_ID, LEAF_POOL_ADDRESS);

  // Mock FeeToTickSpacingMapping
  const mockFeeToTickSpacingMapping: FeeToTickSpacingMapping = {
    id: `${CHAIN_ID}_${TICK_SPACING}`,
    chainId: CHAIN_ID,
    tickSpacing: TICK_SPACING,
    fee: FEE,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  // Mock context
  const mockContext = {
    log: {
      error: () => {},
    },
  } as unknown as handlerContext;

  describe("processCLFactoryPoolCreated", () => {
    it("should create entity and liquidity pool aggregator for successful pool creation", async () => {
      // Process the pool created event
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockToken0Data,
        mockToken1Data,
        undefined, // CLGaugeConfig
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      // Assertions
      expect(result.liquidityPoolAggregator).toMatchObject({
        id: LEAF_POOL_ID,
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
        gaugeIsAlive: false,
      });
    });

    it("should handle missing token0 gracefully", async () => {
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        undefined,
        mockToken1Data,
        undefined, // CLGaugeConfig
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      expect(result.liquidityPoolAggregator).toMatchObject({
        id: LEAF_POOL_ID,
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
        gaugeIsAlive: false,
      });
    });

    it("should handle missing token1 gracefully", async () => {
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockToken0Data,
        undefined,
        undefined, // CLGaugeConfig
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      expect(result.liquidityPoolAggregator).toMatchObject({
        id: LEAF_POOL_ID,
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
        gaugeIsAlive: false,
      });
    });

    it("should handle both tokens missing gracefully", async () => {
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        undefined,
        undefined,
        undefined, // CLGaugeConfig
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      expect(result.liquidityPoolAggregator).toMatchObject({
        id: LEAF_POOL_ID,
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
        gaugeIsAlive: false,
      });
    });

    it("should handle different tick spacing values", async () => {
      const mockEventWithDifferentTickSpacing: CLFactory_PoolCreated_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          tickSpacing: 200n,
        },
      };

      // For different tick spacing, use a different mapping
      const mappingForTickSpacing200: FeeToTickSpacingMapping = {
        id: `${CHAIN_ID}_200`,
        chainId: CHAIN_ID,
        tickSpacing: 200n,
        fee: 300n,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      };

      const result = await processCLFactoryPoolCreated(
        mockEventWithDifferentTickSpacing,
        mockToken0Data,
        mockToken1Data,
        undefined, // CLGaugeConfig
        mappingForTickSpacing200,
        mockContext,
      );

      expect(result.liquidityPoolAggregator?.name).toBe(
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

      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockToken0NonWhitelisted,
        mockToken1NonWhitelisted,
        undefined, // CLGaugeConfig
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      expect(result.liquidityPoolAggregator).toMatchObject({
        id: LEAF_POOL_ID,
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
        gaugeIsAlive: false,
      });
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

      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockToken0Whitelisted,
        mockToken1NonWhitelisted,
        undefined, // CLGaugeConfig
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      expect(result.liquidityPoolAggregator).toMatchObject({
        id: LEAF_POOL_ID,
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
        gaugeIsAlive: false,
      });
    });

    it("should handle different chain IDs correctly", async () => {
      const mockEventWithDifferentChainId: CLFactory_PoolCreated_event = {
        ...mockEvent,
        chainId: 8453, // Base
      };

      // For different chain ID, use a different mapping
      const mappingForBase: FeeToTickSpacingMapping = {
        id: `8453_${TICK_SPACING}`,
        chainId: 8453,
        tickSpacing: TICK_SPACING,
        fee: 400n,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      };

      const result = await processCLFactoryPoolCreated(
        mockEventWithDifferentChainId,
        mockToken0Data,
        mockToken1Data,
        undefined, // CLGaugeConfig
        mappingForBase,
        mockContext,
      );

      expect(result.liquidityPoolAggregator?.chainId).toBe(8453);
      expect(result.liquidityPoolAggregator?.token0_id).toBe(
        "0x2222222222222222222222222222222222222222-8453",
      );
      expect(result.liquidityPoolAggregator?.token1_id).toBe(
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

      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockToken0WithSymbol,
        mockToken1WithSymbol,
        undefined, // CLGaugeConfig
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      expect(result.liquidityPoolAggregator?.name).toBe(
        "CL-60 AMM - WETH/USDC",
      );
    });

    it("should handle error during processing gracefully", async () => {
      // Restore the current mock and create a new one that throws
      jest.restoreAllMocks();
      jest
        .spyOn(PriceOracle, "createTokenEntity")
        .mockImplementation(async () => {
          throw new Error("Token creation failed");
        });

      // Use undefined tokens to trigger createTokenEntity
      // The function catches errors and continues, so it should complete successfully
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        undefined,
        undefined,
        undefined, // CLGaugeConfig
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      // The function should complete successfully (errors are logged but don't stop processing)
      // When token creation fails, symbols will be undefined
      expect(result.liquidityPoolAggregator).toBeDefined();
      expect(result.liquidityPoolAggregator.name).toBe(
        "CL-60 AMM - undefined/undefined",
      );
    });

    it("should set all initial values correctly for new pool", async () => {
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockToken0Data,
        mockToken1Data,
        undefined, // CLGaugeConfig
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      const aggregator = result.liquidityPoolAggregator;
      expect(aggregator).toBeDefined();

      // All initial values should be set correctly for a new pool
      expect(aggregator).toMatchObject({
        // All numeric values should be 0 for a new pool
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
        // Boolean values
        isStable: false,
        isCL: true,
        gaugeIsAlive: false,
        // Timestamps should be set to event timestamp
        lastUpdatedTimestamp: new Date(1000000 * 1000),
        lastSnapshotTimestamp: new Date(1000000 * 1000),
      });
    });

    it("should set gaugeEmissionsCap to undefined when CLGaugeConfig does not exist", async () => {
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockToken0Data,
        mockToken1Data,
        undefined, // CLGaugeConfig does not exist
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      expect(result.liquidityPoolAggregator.gaugeEmissionsCap).toBeUndefined();
    });

    it("should set gaugeEmissionsCap to defaultEmissionsCap when CLGaugeConfig exists", async () => {
      const mockDefaultEmissionsCap = 1000000000000000000000n; // 1000 tokens in 18 decimals
      const mockCLGaugeConfig: CLGaugeConfig = {
        id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        defaultEmissionsCap: mockDefaultEmissionsCap,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      };

      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockToken0Data,
        mockToken1Data,
        mockCLGaugeConfig,
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      expect(result.liquidityPoolAggregator.gaugeEmissionsCap).toBe(
        mockDefaultEmissionsCap,
      );
    });

    it("should set baseFee and currentFee from FeeToTickSpacingMapping when mapping exists", async () => {
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockToken0Data,
        mockToken1Data,
        undefined, // CLGaugeConfig
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      expect(result.liquidityPoolAggregator.baseFee).toBe(FEE);
      expect(result.liquidityPoolAggregator.currentFee).toBe(FEE);
    });

    it("should throw error when FeeToTickSpacingMapping does not exist", async () => {
      // This case is now handled by the handler which returns early
      // The function signature requires FeeToTickSpacingMapping, so we can't test undefined here
      // Instead, we test that the handler prevents pool creation when mapping is missing
      await expect(
        processCLFactoryPoolCreated(
          mockEvent,
          mockToken0Data,
          mockToken1Data,
          undefined, // CLGaugeConfig
          undefined as unknown as FeeToTickSpacingMapping, // FeeToTickSpacingMapping does not exist
          mockContext,
        ),
      ).rejects.toThrow();
    });

    it.each([
      { tickSpacing: 60n, fee: 500n },
      { tickSpacing: 100n, fee: 400n },
      { tickSpacing: 200n, fee: 300n },
    ])(
      "should use correct fee for tick spacing $tickSpacing with fee $fee",
      async ({ tickSpacing, fee }) => {
        const eventWithTickSpacing: CLFactory_PoolCreated_event = {
          ...mockEvent,
          params: {
            ...mockEvent.params,
            tickSpacing,
          },
        };

        const mapping: FeeToTickSpacingMapping = {
          id: `${CHAIN_ID}_${tickSpacing}`,
          chainId: CHAIN_ID,
          tickSpacing,
          fee,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        };

        const result = await processCLFactoryPoolCreated(
          eventWithTickSpacing,
          mockToken0Data,
          mockToken1Data,
          undefined, // CLGaugeConfig
          mapping,
          mockContext,
        );

        expect(result.liquidityPoolAggregator.baseFee).toBe(fee);
        expect(result.liquidityPoolAggregator.currentFee).toBe(fee);
      },
    );
  });
});
