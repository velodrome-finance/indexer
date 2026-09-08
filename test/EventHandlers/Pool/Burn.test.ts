import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import { registerPool } from "../../registerDynamicContracts";
import { setupCommon } from "./common";

describe("Pool Burn Event", () => {
  let indexer: ReturnType<typeof createTestIndexer>;
  let commonData: ReturnType<typeof setupCommon>;

  beforeEach(async () => {
    indexer = createTestIndexer();
    commonData = setupCommon();
    await registerPool(
      indexer,
      10,
      commonData.mockLiquidityPoolData.poolAddress,
    );

    // Set up test indexer with common data
    indexer.Pool.set(commonData.mockLiquidityPoolData);
    indexer.Token.set(commonData.mockToken0Data);
    indexer.Token.set(commonData.mockToken1Data);
  });

  it("should process burn event and update liquidity pool aggregator", async () => {
    const chainId = 10 as const;

    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "Pool",
              event: "Burn",
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
                to: toChecksumAddress(
                  "0x3333333333333333333333333333333333333333",
                ),
                amount0: 500n * 10n ** 18n,
                amount1: 1000n * 10n ** 18n,
              },
            },
          ],
        },
      },
    });

    // Verify that the liquidity pool aggregator was updated
    const rawAggregator = await indexer.Pool.get(
      commonData.mockLiquidityPoolData.id,
    );
    const { rehydrateTimestamps } = await import(
      "../../../src/EntityTimestamps"
    );
    const updatedAggregator = rawAggregator
      ? rehydrateTimestamps("Pool", rawAggregator)
      : undefined;
    expect(updatedAggregator).toBeDefined();
    expect(updatedAggregator?.lastUpdatedTimestamp).toEqual(
      new Date(1000000 * 1000),
    );

    // Verify that reserves are NOT updated by Burn events
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
        10,
        commonData.mockLiquidityPoolData.poolAddress,
      );
      freshIndexer.Token.set(commonData.mockToken0Data);
      freshIndexer.Token.set(commonData.mockToken1Data);

      const chainId = 10 as const;

      await freshIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Burn",
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
                  to: toChecksumAddress(
                    "0x2222222222222222222222222222222222222222",
                  ),
                  amount0: 500n * 10n ** 18n,
                  amount1: 1000n * 10n ** 18n,
                },
              },
            ],
          },
        },
      });

      // The burn never reached the pool: the factory-created row is untouched.
      const pool = await freshIndexer.Pool.get(
        commonData.mockLiquidityPoolData.id,
      );
      expect(pool).toBeDefined();
      expect(pool?.reserve0).toBe(0n);
      expect(pool?.reserve1).toBe(0n);

      // User stats will NOT be created when pool doesn't exist (early return)
      // and no transfer match is found
      const userStats = await freshIndexer.UserStatsPerPool.get(
        `0x1111111111111111111111111111111111111111_${commonData.mockLiquidityPoolData.poolAddress}_10`,
      );
      expect(userStats).toBeUndefined();
    });
  });
});
