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
  // The configured Optimism ALMCore. An event only routes to a contract
  // when its source address is one configured for that chain.
  const almCoreAddress = toChecksumAddress(
    "0x0000000cE42D4981513060aB7E50B9e5e2D19AF1",
  );
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
                srcAddress: almCoreAddress,
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
                srcAddress: almCoreAddress,
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
                srcAddress: almCoreAddress,
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

  describe("wrapper resolution", () => {
    // Superchain leaf chains share the ALMCore address and CREATE2 pool
    // addresses, so the same pool address can have a wrapper on several chains.
    const soneium = 1868 as const;
    const ink = 57073 as const;
    const sharedPool = toChecksumAddress(
      "0xc2026f3fb6fc51F4EcAE40a88b4509cB6C143ed4",
    );
    const soneiumWrapper: ALM_LP_Wrapper = {
      ...mockALMLPWrapperData,
      id: ALMLPWrapperId(
        soneium,
        toChecksumAddress("0x20fa0aFf0368E1B07c24EE0060320512c9Cd41bC"),
      ),
      chainId: soneium,
      pool: sharedPool,
      tokenId: 61956n,
      tickLower: 105000n,
      tickUpper: 117000n,
    };
    const inkWrapper: ALM_LP_Wrapper = {
      ...mockALMLPWrapperData,
      id: ALMLPWrapperId(
        ink,
        toChecksumAddress("0xcccccccccccccccccccccccccccccccccccccccc"),
      ),
      chainId: ink,
      pool: sharedPool,
      tokenId: 359000n,
      tickLower: 105600n,
      tickUpper: 117600n,
    };

    const rebalance = (
      pool: string,
      ammPositionIdBefore: bigint,
      ammPositionIdAfter: bigint,
    ) => ({
      contract: "ALMCore" as const,
      event: "Rebalance" as const,
      srcAddress: almCoreAddress,
      logIndex: 1,
      block: {
        timestamp: blockTimestamp,
        number: blockNumber,
        hash: transactionHash,
      },
      transaction: { hash: transactionHash },
      params: {
        rebalanceEventParams: {
          pool: pool as `0x${string}`,
          ammPositionInfo: {
            token0: mockALMLPWrapperData.token0 as `0x${string}`,
            token1: mockALMLPWrapperData.token1 as `0x${string}`,
            property: 200n,
            tickLower: 105800n,
            tickUpper: 117800n,
            liquidity: 4242n,
          },
          sqrtPriceX96: 79228162514264337593543950336n,
          amount0: 1n,
          amount1: 1n,
          ammPositionIdBefore,
          ammPositionIdAfter,
        },
      },
    });

    it("ignores a wrapper on another chain that shares the pool address", async () => {
      const indexer = createTestIndexer();
      indexer.ALM_LP_Wrapper.set(soneiumWrapper);

      await indexer.process({
        chains: {
          [ink]: { simulate: [rebalance(sharedPool, 359000n, 359077n)] },
        },
      });

      const raw = await indexer.ALM_LP_Wrapper.get(soneiumWrapper.id);
      const wrapper = raw
        ? rehydrateTimestamps("ALM_LP_Wrapper", raw)
        : undefined;
      expect(wrapper?.tokenId).toBe(61956n);
      expect(wrapper?.tickLower).toBe(105000n);
      expect(wrapper?.tickUpper).toBe(117000n);
      expect(wrapper?.liquidity).toBe(soneiumWrapper.liquidity);
      expect(wrapper?.lastUpdatedTimestamp).toEqual(
        soneiumWrapper.lastUpdatedTimestamp,
      );
      expect(await indexer.ALM_LP_Wrapper.getAll()).toHaveLength(1);
    });

    it("updates the event chain's wrapper and leaves the other chain's wrapper untouched", async () => {
      const indexer = createTestIndexer();
      // Soneium row seeded first so an unfiltered query would return it first.
      indexer.ALM_LP_Wrapper.set(soneiumWrapper);
      indexer.ALM_LP_Wrapper.set(inkWrapper);

      await indexer.process({
        chains: {
          [ink]: { simulate: [rebalance(sharedPool, 359000n, 359077n)] },
        },
      });

      const inkRaw = await indexer.ALM_LP_Wrapper.get(inkWrapper.id);
      expect(inkRaw?.tokenId).toBe(359077n);
      expect(inkRaw?.tickLower).toBe(105800n);
      expect(inkRaw?.tickUpper).toBe(117800n);
      expect(inkRaw?.liquidity).toBe(4242n);

      const soneiumRaw = await indexer.ALM_LP_Wrapper.get(soneiumWrapper.id);
      expect(soneiumRaw?.tokenId).toBe(61956n);
      expect(soneiumRaw?.tickLower).toBe(105000n);
      expect(soneiumRaw?.tickUpper).toBe(117000n);
      expect(soneiumRaw?.liquidity).toBe(soneiumWrapper.liquidity);
    });

    it("picks the same-chain wrapper whose position is being rebalanced when a pool has several", async () => {
      const indexer = createTestIndexer();
      const v1Wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        id: ALMLPWrapperId(
          chainId,
          toChecksumAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        ),
        tokenId: 1n,
      };
      const v2Wrapper: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        id: ALMLPWrapperId(
          chainId,
          toChecksumAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        ),
        tokenId: 7n,
      };
      indexer.ALM_LP_Wrapper.set(v1Wrapper);
      indexer.ALM_LP_Wrapper.set(v2Wrapper);

      await indexer.process({
        chains: {
          [chainId]: { simulate: [rebalance(poolAddress, 7n, 8n)] },
        },
      });

      expect((await indexer.ALM_LP_Wrapper.get(v2Wrapper.id))?.tokenId).toBe(
        8n,
      );
      const untouched = await indexer.ALM_LP_Wrapper.get(v1Wrapper.id);
      expect(untouched?.tokenId).toBe(1n);
      expect(untouched?.tickLower).toBe(v1Wrapper.tickLower);
    });

    it("skips the event when several same-chain wrappers cannot be told apart", async () => {
      const indexer = createTestIndexer();
      const wrapperA: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        id: ALMLPWrapperId(
          chainId,
          toChecksumAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        ),
        tokenId: 1n,
      };
      const wrapperB: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        id: ALMLPWrapperId(
          chainId,
          toChecksumAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        ),
        tokenId: 2n,
      };
      indexer.ALM_LP_Wrapper.set(wrapperA);
      indexer.ALM_LP_Wrapper.set(wrapperB);

      // Position 99 belongs to neither wrapper.
      await indexer.process({
        chains: {
          [chainId]: { simulate: [rebalance(poolAddress, 99n, 100n)] },
        },
      });

      expect((await indexer.ALM_LP_Wrapper.get(wrapperA.id))?.tokenId).toBe(1n);
      expect((await indexer.ALM_LP_Wrapper.get(wrapperB.id))?.tokenId).toBe(2n);
    });
  });
});
