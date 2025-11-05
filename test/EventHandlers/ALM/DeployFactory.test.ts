import { expect } from "chai";
import {
  ALMDeployFactory,
  MockDb,
} from "../../../generated/src/TestHelpers.gen";
import type { NonFungiblePosition } from "../../../generated/src/Types.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("ALMDeployFactory StrategyCreated Event", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const chainId = mockLiquidityPoolData.chainId;
  const poolAddress = mockLiquidityPoolData.id;
  const lpWrapperAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
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
        amount0: 500n * 10n ** 18n,
        amount1: 250n * 10n ** 6n,
        amountUSD: 750n * 10n ** 18n,
        transactionHash,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      mockDb = mockDb.entities.NonFungiblePosition.set(mockNFPM);

      // Track entities for getWhere query
      const storedNFPMs = [mockNFPM];

      // Extend mockDb to include getWhere for NonFungiblePosition
      const mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          NonFungiblePosition: {
            ...mockDb.entities.NonFungiblePosition,
            getWhere: {
              transactionHash: {
                eq: async (txHash: string) => {
                  return storedNFPMs.filter(
                    (entity) => entity.transactionHash === txHash,
                  );
                },
              },
            },
          },
        },
      };

      const strategyType = 1n;
      const tickNeighborhood = 100n;
      const tickSpacing = 60n;
      const width = 2000n;
      const maxLiquidityRatioDeviationX96 = 79228162514264337593543950336n; // 1 * 2^96
      const property = 3000n; // uint24
      const tickLower = -1000n;
      const tickUpper = 1000n;
      const liquidity = 1000000n;

      const mockEvent = ALMDeployFactory.StrategyCreated.createMockEvent({
        params: [
          toChecksumAddress(poolAddress),
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

      const result = await ALMDeployFactory.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(createdWrapper).to.not.be.undefined;
      expect(createdWrapper?.id).to.equal(wrapperId);
      expect(createdWrapper?.chainId).to.equal(chainId);
      expect(createdWrapper?.pool).to.equal(toChecksumAddress(poolAddress));
      expect(createdWrapper?.token0).to.equal(mockToken0Data.address);
      expect(createdWrapper?.token1).to.equal(mockToken1Data.address);

      // Wrapper-level aggregations should be initialized to 0
      expect(createdWrapper?.amount0).to.equal(0n);
      expect(createdWrapper?.amount1).to.equal(0n);
      expect(createdWrapper?.lpAmount).to.equal(0n);

      // Strategy/Position-level state should be set from event
      expect(createdWrapper?.tokenId).to.equal(tokenId);
      expect(createdWrapper?.tickLower).to.equal(tickLower);
      expect(createdWrapper?.tickUpper).to.equal(tickUpper);
      expect(createdWrapper?.property).to.equal(property);
      expect(createdWrapper?.liquidity).to.equal(liquidity);
      expect(createdWrapper?.positionAmount0).to.equal(0n); // Initialize to 0
      expect(createdWrapper?.positionAmount1).to.equal(0n); // Initialize to 0
      expect(createdWrapper?.strategyType).to.equal(strategyType);
      expect(createdWrapper?.tickNeighborhood).to.equal(tickNeighborhood);
      expect(createdWrapper?.tickSpacing).to.equal(tickSpacing);
      expect(createdWrapper?.positionWidth).to.equal(width);
      expect(createdWrapper?.maxLiquidityRatioDeviationX96).to.equal(
        maxLiquidityRatioDeviationX96,
      );
      expect(createdWrapper?.creationTimestamp).to.deep.equal(
        new Date(blockTimestamp * 1000),
      );
      expect(createdWrapper?.strategyTransactionHash).to.equal(transactionHash);
      expect(createdWrapper?.lastUpdatedTimestamp).to.deep.equal(
        new Date(blockTimestamp * 1000),
      );
    });

    it("should not create entity when NonFungiblePosition not found", async () => {
      const mockDb = MockDb.createMockDb();

      // Extend mockDb to include getWhere (returning empty array)
      const mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          NonFungiblePosition: {
            ...mockDb.entities.NonFungiblePosition,
            getWhere: {
              transactionHash: {
                eq: async (_txHash: string) => {
                  return []; // No entities found
                },
              },
            },
          },
        },
      };

      const mockEvent = ALMDeployFactory.StrategyCreated.createMockEvent({
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

      const result = await ALMDeployFactory.StrategyCreated.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere as typeof mockDb,
      });

      // Verify that no wrapper was created
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdWrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(createdWrapper).to.be.undefined;
    });
  });
});
