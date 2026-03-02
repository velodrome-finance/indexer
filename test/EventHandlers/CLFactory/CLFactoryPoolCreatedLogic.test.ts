import type {
  CLFactory_PoolCreated_event,
  CLGaugeConfig,
  FeeToTickSpacingMapping,
  Token,
  handlerContext,
} from "generated";
import {
  FeeToTickSpacingMappingId,
  PendingRootPoolMappingId,
  PoolId,
  RootPoolLeafPoolId,
  TokenId,
  rootPoolMatchingHash,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  flushPendingRootPoolMappingAndVotes,
  processCLFactoryPoolCreated,
} from "../../../src/EventHandlers/CLFactory/CLFactoryPoolCreatedLogic";
import * as PendingVoteProcessing from "../../../src/EventHandlers/Voter/PendingVoteProcessing";
import * as PriceOracle from "../../../src/PriceOracle";
import { setupCommon } from "../Pool/common";

describe("CLFactoryPoolCreatedLogic", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();

  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock the createTokenEntity function using vitest
    vi.spyOn(PriceOracle, "createTokenEntity").mockImplementation(
      async (address: string) => ({
        id: "mock_token_id",
        address: address,
        symbol: "", // Empty symbol for missing tokens
        name: "Mock Token",
        decimals: 18n,
        pricePerUSDNew: 1000000000000000000n,
        chainId: 10,
        isWhitelisted: false,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    id: FeeToTickSpacingMappingId(CHAIN_ID, TICK_SPACING),
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
    const expectedTokenFields = {
      token0_id: TokenId(
        10,
        toChecksumAddress("0x2222222222222222222222222222222222222222"),
      ),
      token1_id: TokenId(
        10,
        toChecksumAddress("0x3333333333333333333333333333333333333333"),
      ),
      token0_address: toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      ),
      token1_address: toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      ),
    };

    it("should create entity and liquidity pool aggregator for successful pool creation", async () => {
      // Process the pool created event
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockEvent.srcAddress,
        mockToken0Data,
        mockToken1Data,
        undefined, // CLGaugeConfig
        mockFeeToTickSpacingMapping,
        mockContext,
      );

      // Assertions
      expect(result.liquidityPoolAggregator.factoryAddress).toBe(
        mockEvent.srcAddress,
      );
      expect(result.liquidityPoolAggregator).toMatchObject({
        id: LEAF_POOL_ID,
        chainId: 10,
        name: "CL-60 AMM - USDT/USDC",
        ...expectedTokenFields,
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
        mockEvent.srcAddress,
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
        ...expectedTokenFields,
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
        mockEvent.srcAddress,
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
        ...expectedTokenFields,
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
        mockEvent.srcAddress,
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
        ...expectedTokenFields,
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
        id: FeeToTickSpacingMappingId(CHAIN_ID, 200),
        chainId: CHAIN_ID,
        tickSpacing: 200n,
        fee: 300n,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      };

      const result = await processCLFactoryPoolCreated(
        mockEventWithDifferentTickSpacing,
        mockEventWithDifferentTickSpacing.srcAddress,
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
        mockEvent.srcAddress,
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
        ...expectedTokenFields,
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
        mockEvent.srcAddress,
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
        ...expectedTokenFields,
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
        id: FeeToTickSpacingMappingId(8453, TICK_SPACING),
        chainId: 8453,
        tickSpacing: TICK_SPACING,
        fee: 400n,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      };

      const result = await processCLFactoryPoolCreated(
        mockEventWithDifferentChainId,
        mockEventWithDifferentChainId.srcAddress,
        mockToken0Data,
        mockToken1Data,
        undefined, // CLGaugeConfig
        mappingForBase,
        mockContext,
      );

      expect(result.liquidityPoolAggregator?.chainId).toBe(8453);
      expect(result.liquidityPoolAggregator?.token0_id).toBe(
        TokenId(
          8453,
          toChecksumAddress("0x2222222222222222222222222222222222222222"),
        ),
      );
      expect(result.liquidityPoolAggregator?.token1_id).toBe(
        TokenId(
          8453,
          toChecksumAddress("0x3333333333333333333333333333333333333333"),
        ),
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
        mockEvent.srcAddress,
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
      vi.restoreAllMocks();
      vi.spyOn(PriceOracle, "createTokenEntity").mockImplementation(
        async () => {
          throw new Error("Token creation failed");
        },
      );

      // Use undefined tokens to trigger createTokenEntity
      // The function catches errors and continues, so it should complete successfully
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockEvent.srcAddress,
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
        mockEvent.srcAddress,
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
        // Boolean values
        isStable: false,
        isCL: true,
        gaugeIsAlive: false,
        // Timestamps: lastUpdatedTimestamp from event; lastSnapshotTimestamp epoch 0 (never snapshotted)
        lastUpdatedTimestamp: new Date(1000000 * 1000),
        lastSnapshotTimestamp: new Date(0),
      });
    });

    it("should set gaugeEmissionsCap to undefined when CLGaugeConfig does not exist", async () => {
      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockEvent.srcAddress,
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
        id: toChecksumAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        defaultEmissionsCap: mockDefaultEmissionsCap,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      };

      const result = await processCLFactoryPoolCreated(
        mockEvent,
        mockEvent.srcAddress,
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
        mockEvent.srcAddress,
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
          mockEvent.srcAddress,
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
          id: FeeToTickSpacingMappingId(CHAIN_ID, tickSpacing),
          chainId: CHAIN_ID,
          tickSpacing,
          fee,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        };

        const result = await processCLFactoryPoolCreated(
          eventWithTickSpacing,
          eventWithTickSpacing.srcAddress,
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

  describe("flushPendingRootPoolMappingAndVotes", () => {
    const leafChainId = 8453;
    const leafPoolAddress = toChecksumAddress(
      "0x4444444444444444444444444444444444444444",
    );
    const rootChainId = 10;
    const rootPoolAddress = toChecksumAddress(
      "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
    );
    const token0 = toChecksumAddress(
      "0x2222222222222222222222222222222222222222",
    );
    const token1 = toChecksumAddress(
      "0x3333333333333333333333333333333333333333",
    );
    const tickSpacing = 60n;

    it("should do nothing when no PendingRootPoolMapping exists for the hash", async () => {
      const getWhere = vi.fn().mockResolvedValue([]);
      const set = vi.fn();
      const deleteUnsafe = vi.fn();
      const processAllSpy = vi.spyOn(
        PendingVoteProcessing,
        "processAllPendingVotesForRootPool",
      );

      const context = {
        PendingRootPoolMapping: { getWhere, deleteUnsafe },
        RootPool_LeafPool: { set },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as unknown as handlerContext;

      await flushPendingRootPoolMappingAndVotes(
        context,
        leafChainId,
        token0,
        token1,
        tickSpacing,
        leafPoolAddress,
      );

      const expectedHash = rootPoolMatchingHash(
        leafChainId,
        token0,
        token1,
        tickSpacing,
      );
      expect(getWhere).toHaveBeenCalledTimes(1);
      expect(getWhere).toHaveBeenCalledWith({
        rootPoolMatchingHash: { _eq: expectedHash },
      });
      expect(set).not.toHaveBeenCalled();
      expect(deleteUnsafe).not.toHaveBeenCalled();
      expect(processAllSpy).not.toHaveBeenCalled();
    });

    it.each([null, undefined])(
      "should do nothing when getWhere returns %s (treat as empty)",
      async (getWhereResult) => {
        const getWhere = vi.fn().mockResolvedValue(getWhereResult);
        const set = vi.fn();
        const deleteUnsafe = vi.fn();
        const processAllSpy = vi.spyOn(
          PendingVoteProcessing,
          "processAllPendingVotesForRootPool",
        );

        const context = {
          PendingRootPoolMapping: { getWhere, deleteUnsafe },
          RootPool_LeafPool: { set },
          log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        } as unknown as handlerContext;

        await flushPendingRootPoolMappingAndVotes(
          context,
          leafChainId,
          token0,
          token1,
          tickSpacing,
          leafPoolAddress,
        );

        const expectedHash = rootPoolMatchingHash(
          leafChainId,
          token0,
          token1,
          tickSpacing,
        );
        expect(getWhere).toHaveBeenCalledTimes(1);
        expect(getWhere).toHaveBeenCalledWith({
          rootPoolMatchingHash: { _eq: expectedHash },
        });
        expect(set).not.toHaveBeenCalled();
        expect(deleteUnsafe).not.toHaveBeenCalled();
        expect(processAllSpy).not.toHaveBeenCalled();
      },
    );

    it("should set RootPool_LeafPool, delete PendingRootPoolMapping, and call processAllPendingVotesForRootPool when pending mapping exists", async () => {
      const hash = rootPoolMatchingHash(
        leafChainId,
        token0,
        token1,
        tickSpacing,
      );
      const pendingMapping = {
        id: PendingRootPoolMappingId(rootChainId, rootPoolAddress),
        rootChainId,
        rootPoolAddress,
        leafChainId,
        token0,
        token1,
        tickSpacing,
        rootPoolMatchingHash: hash,
      };

      const getWhere = vi.fn().mockResolvedValue([pendingMapping]);
      const set = vi.fn();
      const deleteUnsafe = vi.fn();
      const processAllSpy = vi
        .spyOn(PendingVoteProcessing, "processAllPendingVotesForRootPool")
        .mockResolvedValue(undefined);

      const context = {
        PendingRootPoolMapping: { getWhere, deleteUnsafe },
        RootPool_LeafPool: { set },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as unknown as handlerContext;

      await flushPendingRootPoolMappingAndVotes(
        context,
        leafChainId,
        token0,
        token1,
        tickSpacing,
        leafPoolAddress,
      );

      expect(getWhere).toHaveBeenCalledWith({
        rootPoolMatchingHash: { _eq: hash },
      });
      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith({
        id: RootPoolLeafPoolId(
          rootChainId,
          leafChainId,
          rootPoolAddress,
          leafPoolAddress,
        ),
        rootChainId,
        rootPoolAddress,
        leafChainId,
        leafPoolAddress,
      });
      expect(deleteUnsafe).toHaveBeenCalledTimes(1);
      expect(deleteUnsafe).toHaveBeenCalledWith(pendingMapping.id);
      expect(processAllSpy).toHaveBeenCalledTimes(1);
      expect(processAllSpy).toHaveBeenCalledWith(context, rootPoolAddress);
    });

    it("should still set RootPool_LeafPool, delete PendingRootPoolMapping, and complete without throwing when processAllPendingVotesForRootPool throws", async () => {
      const hash = rootPoolMatchingHash(
        leafChainId,
        token0,
        token1,
        tickSpacing,
      );
      const pendingMapping = {
        id: PendingRootPoolMappingId(rootChainId, rootPoolAddress),
        rootChainId,
        rootPoolAddress,
        leafChainId,
        token0,
        token1,
        tickSpacing,
        rootPoolMatchingHash: hash,
      };

      const getWhere = vi.fn().mockResolvedValue([pendingMapping]);
      const set = vi.fn();
      const deleteUnsafe = vi.fn();
      const logError = vi.fn();
      const processAllSpy = vi
        .spyOn(PendingVoteProcessing, "processAllPendingVotesForRootPool")
        .mockRejectedValueOnce(new Error("Pending vote processing failed"));

      const context = {
        PendingRootPoolMapping: { getWhere, deleteUnsafe },
        RootPool_LeafPool: { set },
        log: { info: vi.fn(), warn: vi.fn(), error: logError },
      } as unknown as handlerContext;

      await expect(
        flushPendingRootPoolMappingAndVotes(
          context,
          leafChainId,
          token0,
          token1,
          tickSpacing,
          leafPoolAddress,
        ),
      ).resolves.toBeUndefined();

      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith({
        id: RootPoolLeafPoolId(
          rootChainId,
          leafChainId,
          rootPoolAddress,
          leafPoolAddress,
        ),
        rootChainId,
        rootPoolAddress,
        leafChainId,
        leafPoolAddress,
      });
      expect(deleteUnsafe).toHaveBeenCalledTimes(1);
      expect(deleteUnsafe).toHaveBeenCalledWith(pendingMapping.id);
      expect(processAllSpy).toHaveBeenCalledWith(context, rootPoolAddress);
      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining(rootPoolAddress),
      );
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("Pending vote processing failed"),
      );
    });
  });
});
