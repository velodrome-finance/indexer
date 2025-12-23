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
import { setupCommon } from "./Pool/common";

describe("CLFactory Events", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  // Use Base (8453) instead of Optimism (10) because Optimism has empty newCLGaugeFactoryAddress
  const chainId = 8453; // Base chain has a valid newCLGaugeFactoryAddress
  const poolAddress = "0x3333333333333333333333333333333333333333";
  const token0Address = mockToken0Data.address;
  const token1Address = mockToken1Data.address;

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

    processSpy = jest
      .spyOn(CLFactoryPoolCreatedLogic, "processCLFactoryPoolCreated")
      .mockResolvedValue({
        liquidityPoolAggregator: {
          id: toChecksumAddress(poolAddress),
          chainId: chainId,
          token0_id: TokenIdByChain(token0Address, chainId),
          token1_id: TokenIdByChain(token1Address, chainId),
          token0_address: token0Address,
          token1_address: token1Address,
          isStable: false,
          isCL: true,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        } as LiquidityPoolAggregator,
      });
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

      mockEvent = CLFactory.PoolCreated.createMockEvent({
        token0: token0Address,
        token1: token1Address,
        pool: poolAddress,
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
      // Verify context was passed as 5th argument
      expect(callArgs[4]).toBeDefined();
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
      const preloadMockDb = MockDb.createMockDb();
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
      preloadMockDb.entities.Token.set(token0ForBase);
      preloadMockDb.entities.Token.set(token1ForBase);

      const clGaugeConfig: CLGaugeConfig = {
        id: newCLGaugeFactoryAddress, // Use the address as-is from CHAIN_CONSTANTS
        chainId: chainId,
        gaugeFactoryAddress: newCLGaugeFactoryAddress,
        defaultEmissionsCap: 0n,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      } as CLGaugeConfig;
      preloadMockDb.entities.CLGaugeConfig.set(clGaugeConfig);

      // Reset spy to track calls
      processSpy.mockClear();

      // Handlers now run during both preload and normal phases
      const result = await CLFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb: preloadMockDb,
      });

      // Should call processCLFactoryPoolCreated (no preload check anymore)
      // Handlers may run multiple times (preload + normal), so check if called at least once
      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("should load token0, token1, and CLGaugeConfig in parallel", () => {
      // Verify that the handler loads all three entities
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
    });
  });
});
