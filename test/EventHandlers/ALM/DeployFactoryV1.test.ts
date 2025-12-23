import {
  ALMDeployFactoryV1,
  MockDb,
} from "../../../generated/src/TestHelpers.gen";
import type { NonFungiblePosition } from "../../../generated/src/Types.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { extendMockDbWithGetWhere } from "../../testHelpers";
import { setupCommon } from "../Pool/common";

describe("ALMDeployFactoryV1 StrategyCreated Event", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const chainId = mockLiquidityPoolData.chainId;
  const poolAddress = mockLiquidityPoolData.id;
  const lpWrapperAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const synthetixFarmAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const callerAddress = "0xcccccccccccccccccccccccccccccccccccccccc";
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const blockTimestamp = 1000000;
  const blockNumber = 123456;
  const tokenId = 42n;

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
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
        amountUSD: 750n * 10n ** 18n,
        mintTransactionHash: transactionHash,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      mockDb = mockDb.entities.NonFungiblePosition.set(mockNFPM);

      // Track entities for getWhere query
      const storedNFPMs = [mockNFPM];

      // Extend mockDb to include getWhere for NonFungiblePosition
      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, storedNFPMs);

      const strategyType = 1n;
      const tickNeighborhood = 100n;
      const tickSpacing = 60n;
      const width = 2000n;
      // Note: V1 doesn't have maxLiquidityRatioDeviationX96 in strategyParams
      const property = 3000n; // uint24
      const tickLower = -1000n;
      const tickUpper = 1000n;
      const liquidity = 1000000n;

      // V1: params tuple has 6 elements: [pool, ammPosition (single tuple), strategyParams (4 fields), lpWrapper, synthetixFarm, caller]
      const mockEvent = ALMDeployFactoryV1.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          // ammPosition is a single tuple, not an array
          [
            toChecksumAddress(mockToken0Data.address),
            toChecksumAddress(mockToken1Data.address),
            property,
            tickLower,
            tickUpper,
            liquidity,
          ],
          // strategyParams has 4 fields (no maxLiquidityRatioDeviationX96)
          [strategyType, tickNeighborhood, tickSpacing, width],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(synthetixFarmAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV1.StrategyCreated.processEvent({
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
      expect(createdWrapper?.amount0).toBe(500n * 10n ** 18n);
      expect(createdWrapper?.amount1).toBe(250n * 10n ** 6n);
      // lpAmount should equal liquidity (initialTotalSupply = position.liquidity in V1)
      expect(createdWrapper?.lpAmount).toBe(liquidity);

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
      // V1 doesn't have maxLiquidityRatioDeviationX96 in strategyParams, defaults to 0n
      expect(createdWrapper?.maxLiquidityRatioDeviationX96).toBe(0n);
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

    it("should not create entity when NonFungiblePosition not found", async () => {
      const mockDb = MockDb.createMockDb();

      // Extend mockDb to include getWhere (returning empty array)
      const mockDbWithGetWhere = extendMockDbWithGetWhere(
        mockDb,
        [],
        async () => [],
      );

      const strategyType = 1n;
      const tickNeighborhood = 100n;
      const tickSpacing = 60n;
      const width = 2000n;
      const property = 3000n;
      const tickLower = -1000n;
      const tickUpper = 1000n;
      const liquidity = 1000000n;

      const mockEvent = ALMDeployFactoryV1.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          [
            toChecksumAddress(mockToken0Data.address),
            toChecksumAddress(mockToken1Data.address),
            property,
            tickLower,
            tickUpper,
            liquidity,
          ],
          [strategyType, tickNeighborhood, tickSpacing, width],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(synthetixFarmAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV1.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      // Verify that no wrapper was created
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(createdWrapper).toBeUndefined();
    });

    it("should not create entity when NonFungiblePosition getWhere returns null", async () => {
      const mockDb = MockDb.createMockDb();

      // Extend mockDb to include getWhere (returning null)
      const mockDbWithGetWhere = extendMockDbWithGetWhere(
        mockDb,
        [],
        async () => null as NonFungiblePosition[] | null,
      );

      const strategyType = 1n;
      const tickNeighborhood = 100n;
      const tickSpacing = 60n;
      const width = 2000n;
      const property = 3000n;
      const tickLower = -1000n;
      const tickUpper = 1000n;
      const liquidity = 1000000n;

      const mockEvent = ALMDeployFactoryV1.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          [
            toChecksumAddress(mockToken0Data.address),
            toChecksumAddress(mockToken1Data.address),
            property,
            tickLower,
            tickUpper,
            liquidity,
          ],
          [strategyType, tickNeighborhood, tickSpacing, width],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(synthetixFarmAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV1.StrategyCreated.processEvent({
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

      // Create multiple NonFungiblePositions with different values
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
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
        amountUSD: 750n * 10n ** 18n,
        mintTransactionHash: transactionHash,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      const nonMatchingNFPM: NonFungiblePosition = {
        id: `${chainId}_${tokenId + 1n}`,
        chainId,
        tokenId: tokenId + 1n,
        owner: callerAddress,
        pool: poolAddress,
        tickUpper: 2000n, // Different tickUpper
        tickLower: -2000n, // Different tickLower
        token0: mockToken0Data.address,
        token1: mockToken1Data.address,
        liquidity: 2000000n, // Different liquidity
        amount0: 1000n * 10n ** 18n,
        amount1: 500n * 10n ** 6n,
        amountUSD: 1500n * 10n ** 18n,
        mintTransactionHash: transactionHash,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      mockDb = mockDb.entities.NonFungiblePosition.set(matchingNFPM);
      mockDb = mockDb.entities.NonFungiblePosition.set(nonMatchingNFPM);

      const storedNFPMs = [matchingNFPM, nonMatchingNFPM];

      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, storedNFPMs);

      const strategyType = 1n;
      const tickNeighborhood = 100n;
      const tickSpacing = 60n;
      const width = 2000n;
      const property = 3000n;
      const tickLower = -1000n;
      const tickUpper = 1000n;
      const liquidity = 1000000n;

      const mockEvent = ALMDeployFactoryV1.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          [
            toChecksumAddress(mockToken0Data.address),
            toChecksumAddress(mockToken1Data.address),
            property,
            tickLower,
            tickUpper,
            liquidity,
          ],
          [strategyType, tickNeighborhood, tickSpacing, width],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(synthetixFarmAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV1.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(createdWrapper).toBeDefined();
      // Should use the matching NonFungiblePosition (tokenId = 42n)
      expect(createdWrapper?.tokenId).toBe(tokenId);
      expect(createdWrapper?.amount0).toBe(500n * 10n ** 18n);
      expect(createdWrapper?.amount1).toBe(250n * 10n ** 6n);
    });

    it("should warn when multiple matching NonFungiblePositions found", async () => {
      let mockDb = MockDb.createMockDb();

      // Create two NonFungiblePositions with identical matching criteria
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
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
        amountUSD: 750n * 10n ** 18n,
        mintTransactionHash: transactionHash,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      const matchingNFPM2: NonFungiblePosition = {
        id: `${chainId}_${tokenId + 1n}`,
        chainId,
        tokenId: tokenId + 1n,
        owner: callerAddress,
        pool: poolAddress,
        tickUpper: 1000n,
        tickLower: -1000n,
        token0: mockToken0Data.address,
        token1: mockToken1Data.address,
        liquidity: 1000000n,
        amount0: 600n * 10n ** 18n, // Different amounts
        amount1: 300n * 10n ** 6n,
        amountUSD: 900n * 10n ** 18n,
        mintTransactionHash: transactionHash,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      mockDb = mockDb.entities.NonFungiblePosition.set(matchingNFPM1);
      mockDb = mockDb.entities.NonFungiblePosition.set(matchingNFPM2);

      const storedNFPMs = [matchingNFPM1, matchingNFPM2];

      const mockDbWithGetWhere = extendMockDbWithGetWhere(mockDb, storedNFPMs);

      const strategyType = 1n;
      const tickNeighborhood = 100n;
      const tickSpacing = 60n;
      const width = 2000n;
      const property = 3000n;
      const tickLower = -1000n;
      const tickUpper = 1000n;
      const liquidity = 1000000n;

      const mockEvent = ALMDeployFactoryV1.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
          [
            toChecksumAddress(mockToken0Data.address),
            toChecksumAddress(mockToken1Data.address),
            property,
            tickLower,
            tickUpper,
            liquidity,
          ],
          [strategyType, tickNeighborhood, tickSpacing, width],
          toChecksumAddress(lpWrapperAddress),
          toChecksumAddress(synthetixFarmAddress),
          toChecksumAddress(callerAddress),
        ],
        mockEventData,
      });

      const result = await ALMDeployFactoryV1.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(createdWrapper).toBeDefined();
      // Should use the first matching NonFungiblePosition
      expect(createdWrapper?.tokenId).toBe(tokenId);
      expect(createdWrapper?.amount0).toBe(500n * 10n ** 18n);
      expect(createdWrapper?.amount1).toBe(250n * 10n ** 6n);
    });
  });
});
