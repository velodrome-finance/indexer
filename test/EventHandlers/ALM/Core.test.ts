import type { ALM_LP_Wrapper, UserStatsPerPool } from "envio";
import { createTestIndexer } from "envio";
import { ALMLPWrapperId, toChecksumAddress } from "../../../src/Constants";
import { rehydrateTimestamps } from "../../../src/EntityTimestamps";
import { setupCommon } from "../Pool/common";

describe("ALMCore Rebalance Event", () => {
  const {
    mockALMLPWrapperData,
    mockLiquidityPoolData,
    createMockUserStatsPerPool,
  } = setupCommon();
  const chainId = mockLiquidityPoolData.chainId as 10;
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const wrapperAddress = mockALMLPWrapperData.id.split("_")[0];
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const blockTimestamp = 1000000;
  const blockNumber = 123456;

  describe("Rebalance event", () => {
    it("should update ALM_LP_Wrapper entity with new position state", async () => {
      const indexer = createTestIndexer();
      const wrapperId = mockALMLPWrapperData.id;
      indexer.ALM_LP_Wrapper.set(mockALMLPWrapperData);
      // Seed ALM_LP_Wrapper so native getWhere({pool: {_eq: poolAddress}}) returns it
      // (the handler queries by pool field)

      const newAmount0 = 800n * 10n ** 18n;
      const newAmount1 = 400n * 10n ** 6n;
      const newLiquidity = 2000000n;
      const newTokenId = 2n;
      const newTickLower = -1500n;
      const newTickUpper = 1500n;
      const newProperty = 3000n;
      const sqrtPriceX96 = 79228162514264337593543950336n; // sqrt(1) * 2^96

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMCore",
                event: "Rebalance",
                srcAddress: poolAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  rebalanceEventParams: {
                    pool: poolAddress as `0x${string}`,
                    ammPositionInfo: {
                      token0: mockALMLPWrapperData.token0 as `0x${string}`,
                      token1: mockALMLPWrapperData.token1 as `0x${string}`,
                      property: newProperty,
                      tickLower: newTickLower,
                      tickUpper: newTickUpper,
                      liquidity: newLiquidity,
                    },
                    sqrtPriceX96,
                    amount0: newAmount0,
                    amount1: newAmount1,
                    ammPositionIdBefore: 1n,
                    ammPositionIdAfter: newTokenId,
                  },
                },
              },
            ],
          },
        },
      });

      const rawWrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);
      const updatedWrapper = rawWrapper
        ? rehydrateTimestamps("ALM_LP_Wrapper", rawWrapper)
        : undefined;

      expect(updatedWrapper).toBeDefined();
      expect(updatedWrapper?.liquidity).toBe(newLiquidity);
      expect(updatedWrapper?.tokenId).toBe(newTokenId);
      expect(updatedWrapper?.tickLower).toBe(newTickLower);
      expect(updatedWrapper?.tickUpper).toBe(newTickUpper);
      expect(updatedWrapper?.property).toBe(newProperty);
      expect(updatedWrapper?.lastUpdatedTimestamp).toEqual(
        new Date(blockTimestamp * 1000),
      );

      // Verify wrapper-level lpAmount aggregation is preserved
      expect(updatedWrapper?.lpAmount).toBe(mockALMLPWrapperData.lpAmount);
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const indexer = createTestIndexer();
      // No ALM_LP_Wrapper seeded — native getWhere returns []

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMCore",
                event: "Rebalance",
                srcAddress: poolAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  rebalanceEventParams: {
                    pool: poolAddress as `0x${string}`,
                    ammPositionInfo: {
                      token0: mockALMLPWrapperData.token0 as `0x${string}`,
                      token1: mockALMLPWrapperData.token1 as `0x${string}`,
                      property: 3000n,
                      tickLower: -1000n,
                      tickUpper: 1000n,
                      liquidity: 1000000n,
                    },
                    sqrtPriceX96: 79228162514264337593543950336n,
                    amount0: 500n * 10n ** 18n,
                    amount1: 250n * 10n ** 6n,
                    ammPositionIdBefore: 1n,
                    ammPositionIdAfter: 2n,
                  },
                },
              },
            ],
          },
        },
      });

      // Verify that no wrapper was created or updated
      const all = await indexer.ALM_LP_Wrapper.getAll();
      expect(all).toHaveLength(0);
    });

    it("should handle multiple wrappers and update the first one", async () => {
      const indexer = createTestIndexer();

      // Create multiple wrappers with the same pool address
      const wrapper1: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        id: ALMLPWrapperId(
          chainId,
          toChecksumAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        ),
      };

      const wrapper2: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        id: ALMLPWrapperId(
          chainId,
          toChecksumAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        ),
      };

      indexer.ALM_LP_Wrapper.set(wrapper1);
      indexer.ALM_LP_Wrapper.set(wrapper2);

      const newTokenId = 3n;
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMCore",
                event: "Rebalance",
                srcAddress: poolAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  rebalanceEventParams: {
                    pool: poolAddress as `0x${string}`,
                    ammPositionInfo: {
                      token0: mockALMLPWrapperData.token0 as `0x${string}`,
                      token1: mockALMLPWrapperData.token1 as `0x${string}`,
                      property: 3000n,
                      tickLower: -1000n,
                      tickUpper: 1000n,
                      liquidity: 1000000n,
                    },
                    sqrtPriceX96: 79228162514264337593543950336n,
                    amount0: 500n * 10n ** 18n,
                    amount1: 250n * 10n ** 6n,
                    ammPositionIdBefore: 1n,
                    ammPositionIdAfter: newTokenId,
                  },
                },
              },
            ],
          },
        },
      });

      // Should update the first wrapper (wrapper1)
      const updatedWrapper1 = await indexer.ALM_LP_Wrapper.get(wrapper1.id);
      expect(updatedWrapper1?.tokenId).toBe(newTokenId);

      // Second wrapper should remain unchanged
      const unchangedWrapper2 = await indexer.ALM_LP_Wrapper.get(wrapper2.id);
      expect(unchangedWrapper2?.tokenId).toBe(wrapper2.tokenId);
    });

    it("should not update UserStatsPerPool on Rebalance (underlyings derived at snapshot time)", async () => {
      const indexer = createTestIndexer();
      indexer.ALM_LP_Wrapper.set(mockALMLPWrapperData);

      const userAlmLpAmount = 1000n * 10n ** 18n;
      const userStats = createMockUserStatsPerPool({
        poolAddress,
        chainId,
        almAddress: wrapperAddress,
        almLpAmount: userAlmLpAmount,
      });
      indexer.UserStatsPerPool.set(userStats);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMCore",
                event: "Rebalance",
                srcAddress: poolAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  rebalanceEventParams: {
                    pool: poolAddress as `0x${string}`,
                    ammPositionInfo: {
                      token0: mockALMLPWrapperData.token0 as `0x${string}`,
                      token1: mockALMLPWrapperData.token1 as `0x${string}`,
                      property: 3000n,
                      tickLower: -1000n,
                      tickUpper: 1000n,
                      liquidity: 1000000n,
                    },
                    sqrtPriceX96: 79228162514264337593543950336n,
                    amount0: 800n * 10n ** 18n,
                    amount1: 400n * 10n ** 6n,
                    ammPositionIdBefore: 1n,
                    ammPositionIdAfter: 2n,
                  },
                },
              },
            ],
          },
        },
      });

      const updatedWrapper = await indexer.ALM_LP_Wrapper.get(
        mockALMLPWrapperData.id,
      );
      expect(updatedWrapper?.liquidity).toBe(1000000n);
      expect(updatedWrapper?.tokenId).toBe(2n);

      // User stats unchanged (almAmount0/almAmount1 are derived at snapshot time, not stored)
      const updatedUser = await indexer.UserStatsPerPool.get(userStats.id);
      expect(updatedUser).toBeDefined();
      expect(updatedUser?.almLpAmount).toBe(userAlmLpAmount);
    });
  });
});
