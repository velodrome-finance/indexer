import {
  ALMDeployFactoryV2,
  MockDb,
} from "../../../generated/src/TestHelpers.gen";
import type { NonFungiblePosition } from "../../../generated/src/Types.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { calculatePositionAmountsFromLiquidity } from "../../../src/Helpers";
import {
  extendMockDbWithGetWhere,
  setupLiquidityPoolAggregator,
} from "../../testHelpers";
import { setupCommon } from "../Pool/common";

describe("ALMDeployFactoryV2 StrategyCreated Event", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const chainId = mockLiquidityPoolData.chainId;
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const lpWrapperAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const callerAddress = "0xcccccccccccccccccccccccccccccccccccccccc";
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const blockTimestamp = 1000000;
  const blockNumber = 123456;
  const tokenId = 42n;

  // sqrtPriceX96 is constant (calculated from tick 0 in setupCommon)
  const sqrtPriceX96 = mockLiquidityPoolData.sqrtPriceX96 ?? 0n;

  const mockEventData = {
    block: {
      timestamp: blockTimestamp,
      number: blockNumber,
      hash: transactionHash,
    },
    chainId,
    logIndex: 1,
    transaction: {
      hash: transactionHash,
    },
  };

  describe("StrategyCreated event", () => {
    it("should create ALM_LP_Wrapper entity with strategy and position data", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with NonFungiblePosition (created by CLPool handlers)
      const mockNFPM: NonFungiblePosition = {
        id: `${chainId}_${tokenId}`,
        chainId,
        tokenId,
        owner: callerAddress,
        pool: poolAddress,
        tickUpper: 1000n,
        tickLower: -1000n,
        token0: mockToken0Data.address,
        token1: mockToken1Data.address,
        liquidity: 1000000n,
        mintTransactionHash: transactionHash,
        mintLogIndex: 1,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      mockDb = mockDb.entities.NonFungiblePosition.set(mockNFPM);
      mockDb = setupLiquidityPoolAggregator(
        mockDb,
        mockLiquidityPoolData,
        poolAddress,
      );

      // Pre-populate with TotalSupplyLimitUpdated event
      const totalSupplyEventId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_TotalSupplyLimitUpdated_event.set({
        id: totalSupplyEventId,
        lpWrapperAddress: toChecksumAddress(lpWrapperAddress),
        currentTotalSupplyLPTokens: 5000n * 10n ** 18n,
        transactionHash: transactionHash,
      });

      // Track entities for getWhere query
      const storedNFPMs = [mockNFPM];

      // Extend mockDb to include getWhere for NonFungiblePosition
      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, storedNFPMs);

      const strategyType = 1n;
      const tickNeighborhood = 100n;
      const tickSpacing = 60n;
      const width = 2000n;
      const maxLiquidityRatioDeviationX96 = 79228162514264337593543950336n; // 1 * 2^96
      const property = 3000n; // uint24
      const tickLower = -1000n;
      const tickUpper = 1000n;
      const liquidity = 1000000n;

      // V2: params tuple has 5 elements: [pool, ammPosition (array), strategyParams (5 fields), lpWrapper, caller]
      // No synthetixFarm in V2
      const mockEvent = ALMDeployFactoryV2.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          // ammPosition is an array with one element
          [
            [
              toChecksumAddress(mockToken0Data.address),
              toChecksumAddress(mockToken1Data.address),
              property,
              tickLower,
              tickUpper,
              liquidity,
            ],
          ],
          // strategyParams has 5 fields (includes maxLiquidityRatioDeviationX96)
          [
            strategyType,
            tickNeighborhood,
            tickSpacing,
            width,
            maxLiquidityRatioDeviationX96,
          ],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV2.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(createdWrapper).toBeDefined();
      expect(createdWrapper?.id).toBe(wrapperId);
      expect(createdWrapper?.chainId).toBe(chainId);
      expect(createdWrapper?.pool).toBe(toChecksumAddress(poolAddress));
      expect(createdWrapper?.token0).toBe(mockToken0Data.address);
      expect(createdWrapper?.token1).toBe(mockToken1Data.address);

      // Wrapper-level aggregations should be initialized from NonFungiblePosition
      // Calculate expected amounts from liquidity and sqrtPriceX96
      const expectedAmounts = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );
      expect(createdWrapper?.amount0).toBe(expectedAmounts.amount0);
      expect(createdWrapper?.amount1).toBe(expectedAmounts.amount1);
      // lpAmount should be initialized from TotalSupplyLimitUpdated event
      expect(createdWrapper?.lpAmount).toBe(5000n * 10n ** 18n);

      // Strategy/Position-level state should be set from event
      expect(createdWrapper?.tokenId).toBe(tokenId);
      expect(createdWrapper?.tickLower).toBe(tickLower);
      expect(createdWrapper?.tickUpper).toBe(tickUpper);
      expect(createdWrapper?.property).toBe(property);
      expect(createdWrapper?.liquidity).toBe(liquidity);
      expect(createdWrapper?.strategyType).toBe(strategyType);
      expect(createdWrapper?.tickNeighborhood).toBe(tickNeighborhood);
      expect(createdWrapper?.tickSpacing).toBe(tickSpacing);
      expect(createdWrapper?.positionWidth).toBe(width);
      expect(createdWrapper?.maxLiquidityRatioDeviationX96).toBe(
        maxLiquidityRatioDeviationX96,
      );
      expect(createdWrapper?.creationTimestamp).toEqual(
        new Date(blockTimestamp * 1000),
      );
      expect(createdWrapper?.strategyTransactionHash).toBe(transactionHash);
      expect(createdWrapper?.lastUpdatedTimestamp).toEqual(
        new Date(blockTimestamp * 1000),
      );
      // Initial state from StrategyCreated is from on-chain AMM position, not derived
      expect(createdWrapper?.ammStateIsDerived).toBe(false);
    });

    it("should not create entity when NonFungiblePosition not found (empty array - covers ?.filter branch)", async () => {
      const mockDb = MockDb.createMockDb();

      // Extend mockDb to include getWhere (returning empty array)
      // This tests the branch where nonFungiblePositions?.filter() is called (not short-circuited)
      // and returns [] (empty array), so ?? [] is NOT triggered
      const mockDbWithGetWhere = extendMockDbWithGetWhere(
        mockDb,
        [],
        async () => [],
      );

      const mockEvent = ALMDeployFactoryV2.StrategyCreated.createMockEvent({
        params: [
          poolAddress,
          [
            [
              mockToken0Data.address,
              mockToken1Data.address,
              3000n,
              -1000n,
              1000n,
              1000000n,
            ],
          ],
          [1n, 100n, 60n, 2000n, 79228162514264337593543950336n],
          lpWrapperAddress,
          callerAddress,
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV2.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      // Verify that no wrapper was created
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(createdWrapper).toBeUndefined();
    });

    it("should not create entity when NonFungiblePosition getWhere returns null (covers ?? [] branch)", async () => {
      const mockDb = MockDb.createMockDb();

      // Extend mockDb to include getWhere (returning null to cover ?? [] branch)
      const mockDbWithGetWhere = extendMockDbWithGetWhere(
        mockDb,
        [],
        async () => null as NonFungiblePosition[] | null,
      );

      const mockEvent = ALMDeployFactoryV2.StrategyCreated.createMockEvent({
        params: [
          poolAddress,
          [
            [
              mockToken0Data.address,
              mockToken1Data.address,
              3000n,
              -1000n,
              1000n,
              1000000n,
            ],
          ],
          [1n, 100n, 60n, 2000n, 79228162514264337593543950336n],
          lpWrapperAddress,
          callerAddress,
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV2.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      // Verify that no wrapper was created
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(createdWrapper).toBeUndefined();
    });

    it("should not create entity when NonFungiblePosition getWhere returns undefined (covers ?? [] branch)", async () => {
      const mockDb = MockDb.createMockDb();

      // Extend mockDb to include getWhere (returning undefined to cover ?? [] branch)
      const mockDbWithGetWhere = extendMockDbWithGetWhere(
        mockDb,
        [],
        async (_txHash: string) =>
          undefined as NonFungiblePosition[] | undefined,
      );

      const mockEvent = ALMDeployFactoryV2.StrategyCreated.createMockEvent({
        params: [
          poolAddress,
          [
            [
              mockToken0Data.address,
              mockToken1Data.address,
              3000n,
              -1000n,
              1000n,
              1000000n,
            ],
          ],
          [1n, 100n, 60n, 2000n, 79228162514264337593543950336n],
          lpWrapperAddress,
          callerAddress,
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV2.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      // Verify that no wrapper was created
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(createdWrapper).toBeUndefined();
    });

    it("should filter NonFungiblePosition by tickLower, tickUpper, liquidity, token0, and token1", async () => {
      let mockDb = MockDb.createMockDb();

      // Create multiple NonFungiblePositions with same transaction hash but different properties
      const matchingNFPM: NonFungiblePosition = {
        id: `${chainId}_${tokenId}`,
        chainId,
        tokenId,
        owner: callerAddress,
        pool: poolAddress,
        tickUpper: 1000n,
        tickLower: -1000n,
        token0: mockToken0Data.address,
        token1: mockToken1Data.address,
        liquidity: 1000000n,
        mintTransactionHash: transactionHash,
        mintLogIndex: 1,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      const nonMatchingNFPM1: NonFungiblePosition = {
        ...matchingNFPM,
        id: `${chainId}_${tokenId + 1n}`,
        tokenId: tokenId + 1n,
        tickLower: -2000n, // Different tickLower
        mintTransactionHash: transactionHash,
      };

      const nonMatchingNFPM2: NonFungiblePosition = {
        ...matchingNFPM,
        id: `${chainId}_${tokenId + 2n}`,
        tokenId: tokenId + 2n,
        liquidity: 2000000n, // Different liquidity
        mintTransactionHash: transactionHash,
      };

      mockDb = mockDb.entities.NonFungiblePosition.set(matchingNFPM);
      mockDb = mockDb.entities.NonFungiblePosition.set(nonMatchingNFPM1);
      mockDb = mockDb.entities.NonFungiblePosition.set(nonMatchingNFPM2);
      mockDb = setupLiquidityPoolAggregator(
        mockDb,
        mockLiquidityPoolData,
        poolAddress,
      );

      // Pre-populate with TotalSupplyLimitUpdated event
      const totalSupplyEventId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_TotalSupplyLimitUpdated_event.set({
        id: totalSupplyEventId,
        lpWrapperAddress: toChecksumAddress(lpWrapperAddress),
        currentTotalSupplyLPTokens: 5000n * 10n ** 18n,
        transactionHash: transactionHash,
      });

      // Track entities for getWhere query
      const storedNFPMs = [matchingNFPM, nonMatchingNFPM1, nonMatchingNFPM2];

      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, storedNFPMs);

      const strategyType = 1n;
      const tickNeighborhood = 100n;
      const tickSpacing = 60n;
      const width = 2000n;
      const maxLiquidityRatioDeviationX96 = 79228162514264337593543950336n;
      const property = 3000n;
      const tickLower = -1000n;
      const tickUpper = 1000n;
      const liquidity = 1000000n;

      // V2: params tuple has 5 elements: [pool, ammPosition (array), strategyParams (5 fields), lpWrapper, caller]
      // No synthetixFarm in V2
      const mockEvent = ALMDeployFactoryV2.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          // ammPosition is an array with one element
          [
            [
              toChecksumAddress(mockToken0Data.address),
              toChecksumAddress(mockToken1Data.address),
              property,
              tickLower,
              tickUpper,
              liquidity,
            ],
          ],
          // strategyParams has 5 fields (includes maxLiquidityRatioDeviationX96)
          [
            strategyType,
            tickNeighborhood,
            tickSpacing,
            width,
            maxLiquidityRatioDeviationX96,
          ],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV2.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(createdWrapper).toBeDefined();
      // Should use the matching NFPM (matchingNFPM), not the others
      expect(createdWrapper?.tokenId).toBe(tokenId);
      // Calculate expected amounts from liquidity and sqrtPriceX96
      const expectedAmounts = calculatePositionAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
      );
      expect(createdWrapper?.amount0).toBe(expectedAmounts.amount0);
      expect(createdWrapper?.amount1).toBe(expectedAmounts.amount1);
    });

    it("should filter out NonFungiblePosition with mismatched token0 (covers filter predicate branches)", async () => {
      let mockDb = MockDb.createMockDb();

      // Create NonFungiblePosition with matching properties except token0
      const nonMatchingNFPM: NonFungiblePosition = {
        id: `${chainId}_${tokenId}`,
        chainId,
        tokenId,
        owner: callerAddress,
        pool: poolAddress,
        tickUpper: 1000n,
        tickLower: -1000n,
        token0: "0xffffffffffffffffffffffffffffffffffffffff", // Different token0
        token1: mockToken1Data.address,
        liquidity: 1000000n,
        mintTransactionHash: transactionHash,
        mintLogIndex: 1,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      mockDb = mockDb.entities.NonFungiblePosition.set(nonMatchingNFPM);

      // Track entities for getWhere query
      const storedNFPMs = [nonMatchingNFPM];

      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, storedNFPMs);

      const mockEvent = ALMDeployFactoryV2.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          [
            [
              toChecksumAddress(mockToken0Data.address), // Different from NFPM
              toChecksumAddress(mockToken1Data.address),
              3000n,
              -1000n,
              1000n,
              1000000n,
            ],
          ],
          [1n, 100n, 60n, 2000n, 79228162514264337593543950336n],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV2.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      // Verify that no wrapper was created (filter should exclude this NFPM)
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(createdWrapper).toBeUndefined();
    });

    it("should filter out NonFungiblePosition with mismatched token1 (covers filter predicate branches)", async () => {
      let mockDb = MockDb.createMockDb();

      // Create NonFungiblePosition with matching properties except token1
      const nonMatchingNFPM: NonFungiblePosition = {
        id: `${chainId}_${tokenId}`,
        chainId,
        tokenId,
        owner: callerAddress,
        pool: poolAddress,
        tickUpper: 1000n,
        tickLower: -1000n,
        token0: mockToken0Data.address,
        token1: "0xffffffffffffffffffffffffffffffffffffffff", // Different token1
        liquidity: 1000000n,
        mintTransactionHash: transactionHash,
        mintLogIndex: 1,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      mockDb = mockDb.entities.NonFungiblePosition.set(nonMatchingNFPM);

      // Track entities for getWhere query
      const storedNFPMs = [nonMatchingNFPM];

      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, storedNFPMs);

      const mockEvent = ALMDeployFactoryV2.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          [
            [
              toChecksumAddress(mockToken0Data.address),
              toChecksumAddress(mockToken1Data.address), // Different from NFPM
              3000n,
              -1000n,
              1000n,
              1000000n,
            ],
          ],
          [1n, 100n, 60n, 2000n, 79228162514264337593543950336n],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV2.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      // Verify that no wrapper was created (filter should exclude this NFPM)
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(createdWrapper).toBeUndefined();
    });

    it("should filter out NonFungiblePosition with mismatched tickUpper (covers filter predicate branches)", async () => {
      let mockDb = MockDb.createMockDb();

      // Create NonFungiblePosition with matching tickLower but different tickUpper
      const nonMatchingNFPM: NonFungiblePosition = {
        id: `${chainId}_${tokenId}`,
        chainId,
        tokenId,
        owner: callerAddress,
        pool: poolAddress,
        tickUpper: 2000n, // Different tickUpper (tickLower matches)
        tickLower: -1000n, // Matches
        token0: mockToken0Data.address,
        token1: mockToken1Data.address,
        liquidity: 1000000n,
        mintTransactionHash: transactionHash,
        mintLogIndex: 1,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      mockDb = mockDb.entities.NonFungiblePosition.set(nonMatchingNFPM);

      // Track entities for getWhere query
      const storedNFPMs = [nonMatchingNFPM];

      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, storedNFPMs);

      const mockEvent = ALMDeployFactoryV2.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          [
            [
              toChecksumAddress(mockToken0Data.address),
              toChecksumAddress(mockToken1Data.address),
              3000n,
              -1000n, // Matches NFPM
              1000n, // Different from NFPM (2000n)
              1000000n,
            ],
          ],
          [1n, 100n, 60n, 2000n, 79228162514264337593543950336n],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV2.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      // Verify that no wrapper was created (filter should exclude this NFPM)
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(createdWrapper).toBeUndefined();
    });

    it("should not create entity when TotalSupplyLimitUpdated event not found (covers first part of OR condition)", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with NonFungiblePosition but NOT TotalSupplyLimitUpdated event
      const mockNFPM: NonFungiblePosition = {
        id: `${chainId}_${tokenId}`,
        chainId,
        tokenId,
        owner: callerAddress,
        pool: poolAddress,
        tickUpper: 1000n,
        tickLower: -1000n,
        token0: mockToken0Data.address,
        token1: mockToken1Data.address,
        liquidity: 1000000n,
        mintTransactionHash: transactionHash,
        mintLogIndex: 1,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      mockDb = mockDb.entities.NonFungiblePosition.set(mockNFPM);

      // Track entities for getWhere query
      const storedNFPMs = [mockNFPM];

      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, storedNFPMs);

      const mockEvent = ALMDeployFactoryV2.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          [
            [
              toChecksumAddress(mockToken0Data.address),
              toChecksumAddress(mockToken1Data.address),
              3000n,
              -1000n,
              1000n,
              1000000n,
            ],
          ],
          [1n, 100n, 60n, 2000n, 79228162514264337593543950336n],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV2.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      // Verify that no wrapper was created
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(createdWrapper).toBeUndefined();
    });

    it("should not create entity when TotalSupplyLimitUpdated event exists but transaction hash doesn't match (covers OR branch)", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with NonFungiblePosition
      const mockNFPM: NonFungiblePosition = {
        id: `${chainId}_${tokenId}`,
        chainId,
        tokenId,
        owner: callerAddress,
        pool: poolAddress,
        tickUpper: 1000n,
        tickLower: -1000n,
        token0: mockToken0Data.address,
        token1: mockToken1Data.address,
        liquidity: 1000000n,
        mintTransactionHash: transactionHash,
        mintLogIndex: 1,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      mockDb = mockDb.entities.NonFungiblePosition.set(mockNFPM);

      // Pre-populate with TotalSupplyLimitUpdated event but with different transaction hash
      // This tests the second part of the OR condition: event exists but hash doesn't match
      const totalSupplyEventId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_TotalSupplyLimitUpdated_event.set({
        id: totalSupplyEventId,
        lpWrapperAddress: toChecksumAddress(lpWrapperAddress),
        currentTotalSupplyLPTokens: 5000n * 10n ** 18n,
        transactionHash: "0xdifferenthash", // Different hash - tests second part of OR condition
      });

      // Track entities for getWhere query
      const storedNFPMs = [mockNFPM];

      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, storedNFPMs);

      const mockEvent = ALMDeployFactoryV2.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          [
            [
              toChecksumAddress(mockToken0Data.address),
              toChecksumAddress(mockToken1Data.address),
              3000n,
              -1000n,
              1000n,
              1000000n,
            ],
          ],
          [1n, 100n, 60n, 2000n, 79228162514264337593543950336n],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV2.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      // Verify that no wrapper was created
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(createdWrapper).toBeUndefined();
    });

    it("should handle multiple matching NonFungiblePositions and use the first one", async () => {
      let mockDb = MockDb.createMockDb();

      // Create two NonFungiblePositions with identical matching properties
      const matchingNFPM1: NonFungiblePosition = {
        id: `${chainId}_${tokenId}`,
        chainId,
        tokenId,
        owner: callerAddress,
        pool: poolAddress,
        tickUpper: 1000n,
        tickLower: -1000n,
        token0: mockToken0Data.address,
        token1: mockToken1Data.address,
        liquidity: 1000000n,
        mintTransactionHash: transactionHash,
        mintLogIndex: 1,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      const matchingNFPM2: NonFungiblePosition = {
        ...matchingNFPM1,
        id: `${chainId}_${poolAddress}_${tokenId + 1n}`,
        tokenId: tokenId + 1n,
        mintLogIndex: 2,
      };

      mockDb = mockDb.entities.NonFungiblePosition.set(matchingNFPM1);
      mockDb = mockDb.entities.NonFungiblePosition.set(matchingNFPM2);
      mockDb = setupLiquidityPoolAggregator(
        mockDb,
        mockLiquidityPoolData,
        poolAddress,
      );

      // Pre-populate with TotalSupplyLimitUpdated event
      const totalSupplyEventId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_TotalSupplyLimitUpdated_event.set({
        id: totalSupplyEventId,
        lpWrapperAddress: toChecksumAddress(lpWrapperAddress),
        currentTotalSupplyLPTokens: 5000n * 10n ** 18n,
        transactionHash: transactionHash,
      });

      // Track entities for getWhere query
      const storedNFPMs = [matchingNFPM1, matchingNFPM2];

      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, storedNFPMs);

      const mockEvent = ALMDeployFactoryV2.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          [
            [
              toChecksumAddress(mockToken0Data.address),
              toChecksumAddress(mockToken1Data.address),
              3000n,
              -1000n,
              1000n,
              1000000n,
            ],
          ],
          [1n, 100n, 60n, 2000n, 79228162514264337593543950336n],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV2.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(createdWrapper).toBeDefined();
      // Should use the first matching NFPM (matchingNFPM1)
      expect(createdWrapper?.tokenId).toBe(tokenId);
      // Calculate expected amounts from liquidity and sqrtPriceX96
      const expectedAmounts = calculatePositionAmountsFromLiquidity(
        1000000n, // liquidity
        sqrtPriceX96,
        -1000n, // tickLower
        1000n, // tickUpper
      );
      expect(createdWrapper?.amount0).toBe(expectedAmounts.amount0);
      expect(createdWrapper?.amount1).toBe(expectedAmounts.amount1);
    });
  });
});
