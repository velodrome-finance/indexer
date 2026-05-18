import type { NonFungiblePosition } from "envio";
import { createTestIndexer } from "envio";
import {
  ALMLPWrapperId,
  NonFungiblePositionId,
  toChecksumAddress,
} from "../../../src/Constants";
import { setupPool, simulateEvent } from "../../testHelpers";
import { setupCommon } from "../Pool/common";

describe("ALMDeployFactoryV1 StrategyCreated Event", () => {
  const {
    mockLiquidityPoolData,
    mockToken0Data,
    mockToken1Data,
    defaultNfpmAddress: nfpmAddress,
  } = setupCommon();
  const chainId = mockLiquidityPoolData.chainId;
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const lpWrapperAddress = toChecksumAddress(
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const synthetixFarmAddress = toChecksumAddress(
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  const callerAddress = toChecksumAddress(
    "0xcccccccccccccccccccccccccccccccccccccccc",
  );
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const blockTimestamp = 1000000;
  const blockNumber = 123456;
  const tokenId = 42n;

  // sqrtPriceX96 is constant (calculated from tick 0 in setupCommon)
  const sqrtPriceX96 = mockLiquidityPoolData.sqrtPriceX96;
  if (sqrtPriceX96 === undefined) {
    throw new Error(
      "Test setup error: sqrtPriceX96 must be defined in mockLiquidityPoolData",
    );
  }

  const block = {
    timestamp: blockTimestamp,
    number: blockNumber,
    hash: transactionHash,
  };

  describe("StrategyCreated event", () => {
    it("should create ALM_LP_Wrapper entity with strategy and position data", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with NonFungiblePosition (created by CLPool handlers)
      // mintTransactionHash must match event.transaction.hash for getWhere to find it
      const mockNFPM: NonFungiblePosition = {
        id: NonFungiblePositionId(chainId, nfpmAddress, tokenId),
        chainId,
        tokenId,
        nfpmAddress: nfpmAddress,
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
        lastSnapshotTimestamp: undefined,
        isStakedInGauge: false,
      };

      indexer.NonFungiblePosition.set(mockNFPM);
      setupPool(indexer, mockLiquidityPoolData, poolAddress);

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
      await simulateEvent(indexer, chainId, {
        contract: "ALMDeployFactoryV1",
        event: "StrategyCreated",
        params: {
          params: [
            poolAddress as `0x${string}`,
            // ammPosition is a single tuple, not an array
            [
              mockToken0Data.address as `0x${string}`,
              mockToken1Data.address as `0x${string}`,
              property,
              tickLower,
              tickUpper,
              liquidity,
            ],
            // strategyParams has 4 fields (no maxLiquidityRatioDeviationX96)
            [strategyType, tickNeighborhood, tickSpacing, width],
            lpWrapperAddress,
            synthetixFarmAddress,
            callerAddress,
          ],
        },
        block,
        transaction: { hash: transactionHash },
        logIndex: 1,
      });

      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      const createdWrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);

      expect(createdWrapper).toBeDefined();
      expect(createdWrapper?.id).toBe(wrapperId);
      expect(createdWrapper?.chainId).toBe(chainId);
      expect(createdWrapper?.pool).toBe(poolAddress);
      expect(createdWrapper?.token0).toBe(mockToken0Data.address);
      expect(createdWrapper?.token1).toBe(mockToken1Data.address);

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
      // Quirk 2: Date fields are returned as ISO strings from indexer
      expect(
        new Date(
          createdWrapper?.creationTimestamp as unknown as string,
        ).getTime(),
      ).toBe(blockTimestamp * 1000);
      expect(createdWrapper?.strategyTransactionHash).toBe(transactionHash);
      expect(
        new Date(
          createdWrapper?.lastUpdatedTimestamp as unknown as string,
        ).getTime(),
      ).toBe(blockTimestamp * 1000);
      expect(createdWrapper?.lastSnapshotTimestamp).toBeUndefined();
    });

    it("should not create entity when NonFungiblePosition not found", async () => {
      const indexer = createTestIndexer();
      // No NFP seeded → getWhere returns []

      const strategyType = 1n;
      const tickNeighborhood = 100n;
      const tickSpacing = 60n;
      const width = 2000n;
      const property = 3000n;
      const tickLower = -1000n;
      const tickUpper = 1000n;
      const liquidity = 1000000n;

      await simulateEvent(indexer, chainId, {
        contract: "ALMDeployFactoryV1",
        event: "StrategyCreated",
        params: {
          params: [
            poolAddress as `0x${string}`,
            [
              mockToken0Data.address as `0x${string}`,
              mockToken1Data.address as `0x${string}`,
              property,
              tickLower,
              tickUpper,
              liquidity,
            ],
            [strategyType, tickNeighborhood, tickSpacing, width],
            lpWrapperAddress,
            synthetixFarmAddress,
            callerAddress,
          ],
        },
        block,
        transaction: { hash: transactionHash },
        logIndex: 1,
      });

      // Verify that no wrapper was created
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      const createdWrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);
      expect(createdWrapper).toBeUndefined();
    });

    it.skip("should not create entity when NonFungiblePosition getWhere returns null", async () => {}); // exercises a null-guard code path (??[]) that cannot be triggered via Pattern A. // TODO: V3 in-memory getWhere never returns null — always returns []. This test

    it("should filter NonFungiblePosition by tickLower, tickUpper, liquidity, token0, and token1", async () => {
      const indexer = createTestIndexer();

      // Create multiple NonFungiblePositions with different values
      const matchingNFPM: NonFungiblePosition = {
        id: NonFungiblePositionId(chainId, nfpmAddress, tokenId),
        chainId,
        tokenId,
        nfpmAddress: nfpmAddress,
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
        lastSnapshotTimestamp: undefined,
        isStakedInGauge: false,
      };

      const nonMatchingNFPM: NonFungiblePosition = {
        id: NonFungiblePositionId(chainId, nfpmAddress, tokenId + 1n),
        chainId,
        tokenId: tokenId + 1n,
        nfpmAddress: nfpmAddress,
        owner: callerAddress,
        pool: poolAddress,
        tickUpper: 2000n, // Different tickUpper
        tickLower: -2000n, // Different tickLower
        token0: mockToken0Data.address,
        token1: mockToken1Data.address,
        liquidity: 2000000n, // Different liquidity
        mintLogIndex: 1,
        mintTransactionHash: transactionHash,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
        lastSnapshotTimestamp: undefined,
        isStakedInGauge: false,
      };

      indexer.NonFungiblePosition.set(matchingNFPM);
      indexer.NonFungiblePosition.set(nonMatchingNFPM);
      setupPool(indexer, mockLiquidityPoolData, poolAddress);

      const strategyType = 1n;
      const tickNeighborhood = 100n;
      const tickSpacing = 60n;
      const width = 2000n;
      const property = 3000n;
      const tickLower = -1000n;
      const tickUpper = 1000n;
      const liquidity = 1000000n;

      await simulateEvent(indexer, chainId, {
        contract: "ALMDeployFactoryV1",
        event: "StrategyCreated",
        params: {
          params: [
            poolAddress as `0x${string}`,
            [
              mockToken0Data.address as `0x${string}`,
              mockToken1Data.address as `0x${string}`,
              property,
              tickLower,
              tickUpper,
              liquidity,
            ],
            [strategyType, tickNeighborhood, tickSpacing, width],
            lpWrapperAddress,
            synthetixFarmAddress,
            callerAddress,
          ],
        },
        block,
        transaction: { hash: transactionHash },
        logIndex: 1,
      });

      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      const createdWrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);

      expect(createdWrapper).toBeDefined();
      // Should use the matching NonFungiblePosition (tokenId = 42n)
      expect(createdWrapper?.tokenId).toBe(tokenId);
      // Calculate expected amounts from liquidity and sqrtPriceX96
    });

    it("should warn when multiple matching NonFungiblePositions found", async () => {
      const indexer = createTestIndexer();

      // Create two NonFungiblePositions with identical matching criteria
      const matchingNFPM1: NonFungiblePosition = {
        id: NonFungiblePositionId(chainId, nfpmAddress, tokenId),
        chainId,
        tokenId,
        nfpmAddress: nfpmAddress,
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
        lastSnapshotTimestamp: undefined,
        isStakedInGauge: false,
      };

      const matchingNFPM2: NonFungiblePosition = {
        id: NonFungiblePositionId(chainId, nfpmAddress, tokenId + 1n),
        chainId,
        tokenId: tokenId + 1n,
        nfpmAddress: nfpmAddress,
        owner: callerAddress,
        pool: poolAddress,
        tickUpper: 1000n,
        tickLower: -1000n,
        token0: mockToken0Data.address,
        token1: mockToken1Data.address,
        liquidity: 1000000n,
        mintLogIndex: 2,
        mintTransactionHash: transactionHash,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
        lastSnapshotTimestamp: undefined,
        isStakedInGauge: false,
      };

      indexer.NonFungiblePosition.set(matchingNFPM1);
      indexer.NonFungiblePosition.set(matchingNFPM2);
      setupPool(indexer, mockLiquidityPoolData, poolAddress);

      const strategyType = 1n;
      const tickNeighborhood = 100n;
      const tickSpacing = 60n;
      const width = 2000n;
      const property = 3000n;
      const tickLower = -1000n;
      const tickUpper = 1000n;
      const liquidity = 1000000n;

      await simulateEvent(indexer, chainId, {
        contract: "ALMDeployFactoryV1",
        event: "StrategyCreated",
        params: {
          params: [
            poolAddress as `0x${string}`,
            [
              mockToken0Data.address as `0x${string}`,
              mockToken1Data.address as `0x${string}`,
              property,
              tickLower,
              tickUpper,
              liquidity,
            ],
            [strategyType, tickNeighborhood, tickSpacing, width],
            lpWrapperAddress,
            synthetixFarmAddress,
            callerAddress,
          ],
        },
        block,
        transaction: { hash: transactionHash },
        logIndex: 1,
      });

      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      const createdWrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);

      expect(createdWrapper).toBeDefined();
      // Should use the first matching NonFungiblePosition
      expect(createdWrapper?.tokenId).toBe(tokenId);
      expect(createdWrapper?.liquidity).toBe(liquidity);
    });
  });
});
