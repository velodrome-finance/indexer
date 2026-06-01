import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import * as PoolBurnAndMintLogic from "../../../src/EventHandlers/Pool/PoolBurnAndMintLogic";
import { setupCommon } from "./common";

describe("Pool Mint Event", () => {
  let indexer: ReturnType<typeof createTestIndexer>;
  let commonData: ReturnType<typeof setupCommon>;

  const chainId = 10 as const;

  beforeEach(() => {
    indexer = createTestIndexer();
    commonData = setupCommon();

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

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      // Create a fresh indexer without the pool
      const freshIndexer = createTestIndexer();
      freshIndexer.Token.set(commonData.mockToken0Data);
      freshIndexer.Token.set(commonData.mockToken1Data);
      // Note: We intentionally don't set the Pool

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

      // Pool should not exist
      const pool = await freshIndexer.Pool.get(
        commonData.mockLiquidityPoolData.id,
      );
      expect(pool).toBeUndefined();

      // User stats will NOT be created when pool doesn't exist (early return)
      // and no transfer match is found
      const userStats = await freshIndexer.UserStatsPerPool.get(
        `${toChecksumAddress("0x1111111111111111111111111111111111111111")}_${commonData.mockLiquidityPoolData.poolAddress}_10`,
      );
      expect(userStats).toBeUndefined();
    });
  });
});
