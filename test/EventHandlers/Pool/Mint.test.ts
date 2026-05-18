import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { setupCommon } from "./common";

describe("Pool Mint Event", () => {
  let indexer: ReturnType<typeof createTestIndexer>;
  let commonData: ReturnType<typeof setupCommon>;

  beforeEach(() => {
    indexer = createTestIndexer();
    commonData = setupCommon();

    // Set up indexer with common data
    indexer.Pool.set(commonData.mockLiquidityPoolData);
    indexer.Token.set(commonData.mockToken0Data);
    indexer.Token.set(commonData.mockToken1Data);
  });

  it("should process mint event and update liquidity pool aggregator", async () => {
    await simulateEvent(indexer, 10, {
      contract: "Pool",
      event: "Mint",
      params: {
        sender: toChecksumAddress("0x2222222222222222222222222222222222222222"),
        amount0: 1000n * 10n ** 18n,
        amount1: 2000n * 10n ** 18n,
      },
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      srcAddress: commonData.mockLiquidityPoolData.poolAddress as `0x${string}`,
      logIndex: 1,
    });

    // Verify that the liquidity pool aggregator was updated
    const updatedAggregator = await indexer.Pool.get(
      commonData.mockLiquidityPoolData.id,
    );
    expect(updatedAggregator).toBeDefined();
    expect(
      new Date(
        updatedAggregator?.lastUpdatedTimestamp as unknown as string,
      ).getTime(),
    ).toBe(new Date(1000000 * 1000).getTime());

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

      await simulateEvent(freshIndexer, 10, {
        contract: "Pool",
        event: "Mint",
        params: {
          sender: toChecksumAddress(
            "0x1111111111111111111111111111111111111111",
          ),
          amount0: 1000n * 10n ** 18n,
          amount1: 2000n * 10n ** 18n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        srcAddress: commonData.mockLiquidityPoolData
          .poolAddress as `0x${string}`,
        logIndex: 1,
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
