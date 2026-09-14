import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import * as PoolBurnAndMintLogic from "../../../src/EventHandlers/Pool/PoolBurnAndMintLogic";
import { registerPool } from "../../registerDynamicContracts";
import { setupCommon } from "./common";

describe("Pool Mint Event", () => {
  let indexer: ReturnType<typeof createTestIndexer>;
  let commonData: ReturnType<typeof setupCommon>;

  const chainId = 10 as const;

  beforeEach(async () => {
    indexer = createTestIndexer();
    commonData = setupCommon();
    await registerPool(
      indexer,
      chainId,
      commonData.mockLiquidityPoolData.poolAddress,
    );

    // Set up test indexer with common data
    indexer.Pool.set(commonData.mockLiquidityPoolData);
    indexer.Token.set(commonData.mockToken0Data);
    indexer.Token.set(commonData.mockToken1Data);
  });

  it("should process mint event and update liquidity pool aggregator", async () => {
    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "Pool",
              event: "Mint",
              srcAddress: commonData.mockLiquidityPoolData
                .poolAddress as `0x${string}`,
              logIndex: 1,
              block: {
                timestamp: 1000000,
                number: 123456,
                hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
              },
              params: {
                sender: toChecksumAddress(
                  "0x2222222222222222222222222222222222222222",
                ),
                amount0: 1000n * 10n ** 18n,
                amount1: 2000n * 10n ** 18n,
              },
            },
          ],
        },
      },
    });

    // Verify that the liquidity pool aggregator was updated
    const { rehydrateTimestamps } = await import(
      "../../../src/EntityTimestamps"
    );
    const raw = await indexer.Pool.get(commonData.mockLiquidityPoolData.id);
    const updatedAggregator = raw
      ? rehydrateTimestamps("Pool", raw)
      : undefined;
    expect(updatedAggregator).toBeDefined();
    expect(updatedAggregator?.lastUpdatedTimestamp).toEqual(
      new Date(1000000 * 1000),
    );

    // Verify that reserves are NOT updated by Mint events
    // Only Sync events update reserves (they contain absolute values)
    expect(updatedAggregator?.reserve0).toBe(
      commonData.mockLiquidityPoolData.reserve0,
    );
    expect(updatedAggregator?.reserve1).toBe(
      commonData.mockLiquidityPoolData.reserve1,
    );
  });

  describe("when pool data cannot be loaded", () => {
    it("should return early without processing", async () => {
      // Note: we intentionally don't seed the Pool. `registerPool` had to
      // replay `PoolFactory.PoolCreated` to put the address on the chain, and
      // that handler always writes a Pool row — so the row here is the factory
      // default, pointing at token ids that were never created. `loadPoolData`
      // returns null on that missing-token branch, which is the early return
      // under test.
      const freshIndexer = createTestIndexer();
      await registerPool(
        freshIndexer,
        chainId,
        commonData.mockLiquidityPoolData.poolAddress,
      );
      freshIndexer.Token.set(commonData.mockToken0Data);
      freshIndexer.Token.set(commonData.mockToken1Data);

      await freshIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Mint",
                srcAddress: commonData.mockLiquidityPoolData
                  .poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  sender: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ),
                  amount0: 1000n * 10n ** 18n,
                  amount1: 2000n * 10n ** 18n,
                },
              },
            ],
          },
        },
      });

      // The mint never reached the pool: the factory-created row is untouched.
      const pool = await freshIndexer.Pool.get(
        commonData.mockLiquidityPoolData.id,
      );
      expect(pool).toBeDefined();
      expect(pool?.reserve0).toBe(0n);
      expect(pool?.reserve1).toBe(0n);

      // User stats will NOT be created when pool doesn't exist (early return)
      // and no transfer match is found
      const userStats = await freshIndexer.UserStatsPerPool.get(
        `${toChecksumAddress("0x1111111111111111111111111111111111111111")}_${commonData.mockLiquidityPoolData.poolAddress}_10`,
      );
      expect(userStats).toBeUndefined();
    });
  });
});
