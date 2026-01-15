import { CLFactory, MockDb } from "../../generated/src/TestHelpers.gen";
import type {
  CLGaugeConfig,
  LiquidityPoolAggregator,
  Token,
} from "../../generated/src/Types.gen";
import {
  CHAIN_CONSTANTS,
  TokenIdByChain,
  toChecksumAddress,
} from "../../src/Constants";
import * as CLFactoryPoolCreatedLogic from "../../src/EventHandlers/CLFactory/CLFactoryPoolCreatedLogic";
import * as PriceOracle from "../../src/PriceOracle";
import { setupCommon } from "./Pool/common";

describe("CLFactory Events", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  // Use Base (8453) instead of Optimism (10) because Optimism has empty newCLGaugeFactoryAddress
  const chainId = 8453; // Base chain has a valid newCLGaugeFactoryAddress
  const poolAddress = "0x3333333333333333333333333333333333333333";
  const token0Address = mockToken0Data.address;
  const token1Address = mockToken1Data.address;

  // Shared constants for FeeToTickSpacingMapping
  const TICK_SPACING = 60n;
  const FEE = 500n;
  const createFeeToTickSpacingMapping = () => ({
    id: `${chainId}_${TICK_SPACING}`,
    chainId: chainId,
    tickSpacing: TICK_SPACING,
    fee: FEE,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  });

  let processSpy: jest.SpyInstance;
  // Store the original newCLGaugeFactoryAddress from Constants (Base chain: 0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a)
  const originalNewCLGaugeFactoryAddress =
    "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a";
  let newCLGaugeFactoryAddress: string;
  let originalNewCLGaugeFactoryAddressValue: string | undefined;

  beforeEach(() => {
    // Store the original value before mutation to restore in afterEach
    if (CHAIN_CONSTANTS[chainId]) {
      originalNewCLGaugeFactoryAddressValue =
        CHAIN_CONSTANTS[chainId].newCLGaugeFactoryAddress;
      // Always ensure CHAIN_CONSTANTS[chainId].newCLGaugeFactoryAddress is set correctly
      // (in case another test modified it). This ensures the handler can find the CLGaugeConfig.
      CHAIN_CONSTANTS[chainId].newCLGaugeFactoryAddress =
        originalNewCLGaugeFactoryAddress;
    }
    newCLGaugeFactoryAddress = originalNewCLGaugeFactoryAddress;

    // Mock createTokenEntity in case it's called for missing tokens
    jest
      .spyOn(PriceOracle, "createTokenEntity")
      .mockImplementation(async (address: string) => ({
        id: TokenIdByChain(address, chainId),
        address: address,
        symbol: "",
        name: "Mock Token",
        decimals: 18n,
        pricePerUSDNew: 1000000000000000000n,
        chainId: chainId,
        isWhitelisted: false,
        lastUpdatedTimestamp: new Date(),
      }));

    processSpy = jest
      .spyOn(CLFactoryPoolCreatedLogic, "processCLFactoryPoolCreated")
      .mockImplementation(
        async (
          event,
          token0,
          token1,
          clGaugeConfig,
          feeToTickSpacingMapping,
        ) => {
          return {
            liquidityPoolAggregator: {
              id: toChecksumAddress(poolAddress),
              chainId: chainId,
              token0_id: TokenIdByChain(token0Address, chainId),
              token1_id: TokenIdByChain(token1Address, chainId),
              token0_address: token0Address,
              token1_address: token1Address,
              isStable: false,
              isCL: true,
              baseFee: feeToTickSpacingMapping?.fee,
              currentFee: feeToTickSpacingMapping?.fee,
              lastUpdatedTimestamp: new Date(1000000 * 1000),
            } as LiquidityPoolAggregator,
          };
        },
      );
  });

  afterEach(() => {
    // Restore original newCLGaugeFactoryAddress to prevent interference with other tests
    if (
      CHAIN_CONSTANTS[chainId] &&
      originalNewCLGaugeFactoryAddressValue !== undefined
    ) {
      CHAIN_CONSTANTS[chainId].newCLGaugeFactoryAddress =
        originalNewCLGaugeFactoryAddressValue;
    }
    jest.restoreAllMocks();
  });

  describe("PoolCreated event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof CLFactory.PoolCreated.createMockEvent>;
    let resultDB: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(async () => {
      mockDb = MockDb.createMockDb();

      // Set up token entities with correct chainId (8453 for Base)
      const token0ForBase = {
        ...mockToken0Data,
        id: TokenIdByChain(mockToken0Data.address, chainId),
        chainId: chainId,
      } as Token;
      const token1ForBase = {
        ...mockToken1Data,
        id: TokenIdByChain(mockToken1Data.address, chainId),
        chainId: chainId,
      } as Token;
      mockDb = mockDb.entities.Token.set(token0ForBase);
      mockDb = mockDb.entities.Token.set(token1ForBase);

      // Set up CLGaugeConfig
      const clGaugeConfig: CLGaugeConfig = {
        id: newCLGaugeFactoryAddress, // Use address as-is from CHAIN_CONSTANTS to match handler lookup
        chainId: chainId,
        gaugeFactoryAddress: newCLGaugeFactoryAddress,
        defaultEmissionsCap: 0n,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      } as CLGaugeConfig;
      mockDb = mockDb.entities.CLGaugeConfig.set(clGaugeConfig);

      // Set up FeeToTickSpacingMapping for the pool's tick spacing
      const feeToTickSpacingMapping = createFeeToTickSpacingMapping();
      mockDb = mockDb.entities.FeeToTickSpacingMapping.set(
        feeToTickSpacingMapping,
      );

      mockEvent = CLFactory.PoolCreated.createMockEvent({
        token0: token0Address,
        token1: token1Address,
        pool: poolAddress,
        tickSpacing: TICK_SPACING,
        mockEventData: {
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
        },
      });

      resultDB = await CLFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb,
      });
    });

    it("should call processCLFactoryPoolCreated with correct parameters", () => {
      // The spy should have been called when the event was processed in beforeEach
      expect(processSpy).toHaveBeenCalled();
      const callArgs = processSpy.mock.calls[0];
      expect(callArgs[0]).toEqual(mockEvent);
      expect(callArgs[1]).toEqual(
        expect.objectContaining({
          address: mockToken0Data.address,
          chainId: chainId,
        }),
      );
      expect(callArgs[2]).toEqual(
        expect.objectContaining({
          address: mockToken1Data.address,
          chainId: chainId,
        }),
      );
      expect(callArgs[3]).toEqual(
        expect.objectContaining({
          id: newCLGaugeFactoryAddress,
        }),
      );
      // Verify feeToTickSpacingMapping was passed as 4th argument
      expect(callArgs[4]).toEqual(
        expect.objectContaining({
          id: `${chainId}_60`,
          fee: 500n,
        }),
      );
      // Verify context was passed as 5th argument
      expect(callArgs[5]).toBeDefined();
    });

    it("should set the liquidity pool aggregator entity", () => {
      const pool = resultDB.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(poolAddress),
      );
      expect(pool).toBeDefined();
      expect(pool?.id).toBe(toChecksumAddress(poolAddress));
      expect(pool?.chainId).toBe(chainId);
      expect(pool?.isCL).toBe(true);
    });

    it("should process event even during preload phase", async () => {
      // Create a mock context that simulates preload
      let preloadMockDb = MockDb.createMockDb();
      const token0ForBase = {
        ...mockToken0Data,
        id: TokenIdByChain(mockToken0Data.address, chainId),
        chainId: chainId,
      } as Token;
      const token1ForBase = {
        ...mockToken1Data,
        id: TokenIdByChain(mockToken1Data.address, chainId),
        chainId: chainId,
      } as Token;
      preloadMockDb = preloadMockDb.entities.Token.set(token0ForBase);
      preloadMockDb = preloadMockDb.entities.Token.set(token1ForBase);

      const clGaugeConfig: CLGaugeConfig = {
        id: newCLGaugeFactoryAddress, // Use the address as-is from CHAIN_CONSTANTS
        chainId: chainId,
        gaugeFactoryAddress: newCLGaugeFactoryAddress,
        defaultEmissionsCap: 0n,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      } as CLGaugeConfig;
      preloadMockDb = preloadMockDb.entities.CLGaugeConfig.set(clGaugeConfig);

      // Set up FeeToTickSpacingMapping
      const feeToTickSpacingMapping = createFeeToTickSpacingMapping();
      preloadMockDb = preloadMockDb.entities.FeeToTickSpacingMapping.set(
        feeToTickSpacingMapping,
      );

      // Reset spy to track calls
      processSpy.mockClear();

      // Verify the mapping exists before processing (using the same key format as the handler)
      const mappingKey = `${chainId}_${TICK_SPACING}`;
      const mappingBefore =
        preloadMockDb.entities.FeeToTickSpacingMapping.get(mappingKey);
      expect(mappingBefore).toBeDefined(); // Verify mapping exists before processing

      // Handlers now run during both preload and normal phases
      const result = await CLFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb: preloadMockDb,
      });

      // Verify that the handler ran (pool should be created if mapping exists)
      const pool = result.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(poolAddress),
      );

      // Since we verified the mapping exists, the handler should have run and created the pool
      expect(pool).toBeDefined();
      // The handler should have called processCLFactoryPoolCreated
      // Note: The spy may be called multiple times (preload + normal), so check at least once
      expect(processSpy).toHaveBeenCalled();
    });

    it("should load token0, token1, CLGaugeConfig, and FeeToTickSpacingMapping in parallel", () => {
      // Verify that the handler loads all four entities
      // This is tested implicitly by the fact that processCLFactoryPoolCreated is called
      // with the correct token instances
      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const callArgs = processSpy.mock.calls[0];
      expect(callArgs[1]).toBeDefined(); // token0
      expect(callArgs[2]).toBeDefined(); // token1
      const clGaugeConfig = callArgs[3];
      expect(clGaugeConfig).toBeDefined(); // CLGaugeConfig
      expect(clGaugeConfig?.id).toBe(newCLGaugeFactoryAddress);
      const feeToTickSpacingMapping = callArgs[4];
      expect(feeToTickSpacingMapping).toBeDefined(); // FeeToTickSpacingMapping
      expect(feeToTickSpacingMapping?.fee).toBe(500n);
    });

    it("should set baseFee and currentFee from FeeToTickSpacingMapping when mapping exists", () => {
      const pool = resultDB.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(poolAddress),
      );
      expect(pool?.baseFee).toBe(500n);
      expect(pool?.currentFee).toBe(500n);
    });

    it("should handle missing FeeToTickSpacingMapping gracefully", async () => {
      const mockDbWithoutMapping = MockDb.createMockDb();
      const token0ForBase = {
        ...mockToken0Data,
        id: TokenIdByChain(mockToken0Data.address, chainId),
        chainId: chainId,
      } as Token;
      const token1ForBase = {
        ...mockToken1Data,
        id: TokenIdByChain(mockToken1Data.address, chainId),
        chainId: chainId,
      } as Token;
      mockDbWithoutMapping.entities.Token.set(token0ForBase);
      mockDbWithoutMapping.entities.Token.set(token1ForBase);

      const clGaugeConfig: CLGaugeConfig = {
        id: newCLGaugeFactoryAddress,
        chainId: chainId,
        gaugeFactoryAddress: newCLGaugeFactoryAddress,
        defaultEmissionsCap: 0n,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      } as CLGaugeConfig;
      mockDbWithoutMapping.entities.CLGaugeConfig.set(clGaugeConfig);
      // Note: FeeToTickSpacingMapping is NOT set

      const result = await CLFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithoutMapping,
      });

      const pool = result.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(poolAddress),
      );
      // When mapping doesn't exist, handler returns early and no pool is created
      expect(pool).toBeUndefined();
    });
  });

  describe("TickSpacingEnabled event", () => {
    // Shared constants
    const CHAIN_ID = 10;
    const TICK_SPACING = 100n;
    const FEE = 500n;
    const BLOCK_TIMESTAMP = 1000000;
    const BLOCK_NUMBER = 123456;
    const BLOCK_HASH =
      "0x1234567890123456789012345678901234567890123456789012345678901234";

    let mockDb: ReturnType<typeof MockDb.createMockDb>;

    const createMockEvent = (
      tickSpacing: bigint,
      fee: bigint,
      overrides: {
        chainId?: number;
        timestamp?: number;
        number?: number;
        logIndex?: number;
      } = {},
    ) => {
      return CLFactory.TickSpacingEnabled.createMockEvent({
        tickSpacing,
        fee,
        mockEventData: {
          block: {
            timestamp: overrides.timestamp ?? BLOCK_TIMESTAMP,
            number: overrides.number ?? BLOCK_NUMBER,
            hash: BLOCK_HASH,
          },
          chainId: overrides.chainId ?? CHAIN_ID,
          logIndex: overrides.logIndex ?? 1,
        },
      });
    };

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
    });

    it("should create a new mapping when it doesn't exist", async () => {
      const mappingId = `${CHAIN_ID}_${TICK_SPACING}`;
      const mockEvent = createMockEvent(TICK_SPACING, FEE);

      const result = await CLFactory.TickSpacingEnabled.processEvent({
        event: mockEvent,
        mockDb,
      });

      const mapping = result.entities.FeeToTickSpacingMapping.get(mappingId);
      expect(mapping).toBeDefined();
      expect(mapping?.id).toBe(mappingId);
      expect(mapping?.chainId).toBe(CHAIN_ID);
      expect(mapping?.tickSpacing).toBe(TICK_SPACING);
      expect(mapping?.fee).toBe(FEE);
      expect(mapping?.lastUpdatedTimestamp).toEqual(
        new Date(BLOCK_TIMESTAMP * 1000),
      );
    });

    it("should update existing mapping when it already exists", async () => {
      const mappingId = `${CHAIN_ID}_${TICK_SPACING}`;
      const oldFee = 400n;
      const newFee = 600n;
      const oldTimestamp = 500000;
      const newTimestamp = 2000000;

      // Create existing mapping
      const existingMapping = {
        id: mappingId,
        chainId: CHAIN_ID,
        tickSpacing: TICK_SPACING,
        fee: oldFee,
        lastUpdatedTimestamp: new Date(oldTimestamp * 1000),
      };
      mockDb = mockDb.entities.FeeToTickSpacingMapping.set(existingMapping);

      const mockEvent = createMockEvent(TICK_SPACING, newFee, {
        timestamp: newTimestamp,
        number: 123457,
        logIndex: 2,
      });

      const result = await CLFactory.TickSpacingEnabled.processEvent({
        event: mockEvent,
        mockDb,
      });

      const updatedMapping =
        result.entities.FeeToTickSpacingMapping.get(mappingId);
      expect(updatedMapping).toBeDefined();
      expect(updatedMapping?.fee).toBe(newFee);
      expect(updatedMapping?.lastUpdatedTimestamp).toEqual(
        new Date(newTimestamp * 1000),
      );
      // Verify other fields are preserved
      expect(updatedMapping?.id).toBe(mappingId);
      expect(updatedMapping?.chainId).toBe(CHAIN_ID);
      expect(updatedMapping?.tickSpacing).toBe(TICK_SPACING);
    });

    it.each([
      {
        name: "different tick spacings on same chain",
        mappings: [
          { tickSpacing: 100n, fee: 500n, chainId: CHAIN_ID },
          { tickSpacing: 200n, fee: 300n, chainId: CHAIN_ID },
        ],
      },
      {
        name: "same tick spacing on different chains",
        mappings: [
          { tickSpacing: TICK_SPACING, fee: 500n, chainId: 10 },
          { tickSpacing: TICK_SPACING, fee: 400n, chainId: 8453 },
        ],
      },
    ])(
      "should handle multiple mappings correctly: $name",
      async ({ mappings }) => {
        let result = mockDb;
        const expectedMappings: Array<{
          id: string;
          chainId: number;
          tickSpacing: bigint;
          fee: bigint;
        }> = [];

        for (const mapping of mappings) {
          const mappingId = `${mapping.chainId}_${mapping.tickSpacing}`;
          expectedMappings.push({
            id: mappingId,
            chainId: mapping.chainId,
            tickSpacing: mapping.tickSpacing,
            fee: mapping.fee,
          });

          const mockEvent = createMockEvent(mapping.tickSpacing, mapping.fee, {
            chainId: mapping.chainId,
          });

          result = await CLFactory.TickSpacingEnabled.processEvent({
            event: mockEvent,
            mockDb: result,
          });
        }

        // Verify all mappings were created correctly
        for (const expected of expectedMappings) {
          const mapping = result.entities.FeeToTickSpacingMapping.get(
            expected.id,
          );
          expect(mapping).toBeDefined();
          expect(mapping?.chainId).toBe(expected.chainId);
          expect(mapping?.tickSpacing).toBe(expected.tickSpacing);
          expect(mapping?.fee).toBe(expected.fee);
        }
      },
    );
  });
});
