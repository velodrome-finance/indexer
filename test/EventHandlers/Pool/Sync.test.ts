import type { Token } from "envio";
import { createTestIndexer } from "envio";
import {
  PoolId,
  TEN_TO_THE_18_BI,
  toChecksumAddress,
} from "../../../src/Constants";
import { setupPool } from "../../testHelpers";
import { setupCommon } from "./common";

describe("Pool Sync Event", () => {
  let mockToken0Data: Token;
  let mockToken1Data: Token;
  let mockLiquidityPoolData: ReturnType<
    typeof setupCommon
  >["mockLiquidityPoolData"];

  const chainId = 10 as const;

  const expectations = {
    reserveAmount0In: 0n,
    reserveAmount1In: 0n,
    expectedReserve0: 0n,
    expectedReserve1: 0n,
    expectedReserve0InMissing: 0n,
    expectedReserve1InMissing: 0n,
    expectedLiquidity0USD: 0n,
    expectedLiquidity1USD: 0n,
  };

  const eventData = {
    reserve0: 0n,
    reserve1: 0n,
    srcAddress: toChecksumAddress(
      "0x3333333333333333333333333333333333333333",
    ) as `0x${string}`,
  };

  let indexer: ReturnType<typeof createTestIndexer>;

  beforeEach(() => {
    const setupData = setupCommon();
    mockToken0Data = setupData.mockToken0Data;
    mockToken1Data = setupData.mockToken1Data;
    mockLiquidityPoolData = setupData.mockLiquidityPoolData;

    expectations.reserveAmount0In = 100n * 10n ** mockToken0Data.decimals;
    expectations.reserveAmount1In = 200n * 10n ** mockToken1Data.decimals;

    expectations.expectedReserve0 =
      mockLiquidityPoolData.reserve0 + expectations.reserveAmount0In;
    expectations.expectedReserve1 =
      mockLiquidityPoolData.reserve1 + expectations.reserveAmount1In;

    expectations.expectedReserve0InMissing = expectations.reserveAmount0In;
    expectations.expectedReserve1InMissing = expectations.reserveAmount1In;

    expectations.expectedLiquidity0USD =
      (expectations.expectedReserve0 *
        10n ** (18n - mockToken0Data.decimals) *
        mockToken0Data.pricePerUSDNew) /
      TEN_TO_THE_18_BI;
    expectations.expectedLiquidity1USD =
      (expectations.expectedReserve1 *
        10n ** (18n - mockToken1Data.decimals) *
        mockToken1Data.pricePerUSDNew) /
      TEN_TO_THE_18_BI;

    eventData.reserve0 = expectations.expectedReserve0;
    eventData.reserve1 = expectations.expectedReserve1;

    indexer = createTestIndexer();
  });

  describe("when both tokens exist", () => {
    beforeEach(async () => {
      setupPool(indexer, mockLiquidityPoolData, eventData.srcAddress);
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Sync",
                srcAddress: eventData.srcAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  reserve0: eventData.reserve0,
                  reserve1: eventData.reserve1,
                },
              },
            ],
          },
        },
      });
    });

    it("should update reserves and usd liquidity", async () => {
      const updatedPool = await indexer.Pool.get(
        PoolId(chainId, eventData.srcAddress),
      );
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.reserve0).toBe(expectations.expectedReserve0);
      expect(updatedPool?.reserve1).toBe(expectations.expectedReserve1);
      expect(updatedPool?.totalLiquidityUSD).toBe(
        expectations.expectedLiquidity0USD + expectations.expectedLiquidity1USD,
      );
    });
  });

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      // Create a indexer without the pool
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);
      // Note: We intentionally don't set the Pool

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Sync",
                srcAddress: eventData.srcAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  reserve0: eventData.reserve0,
                  reserve1: eventData.reserve1,
                },
              },
            ],
          },
        },
      });

      // Pool should not exist
      const pool = await indexer.Pool.get(
        PoolId(chainId, eventData.srcAddress),
      );
      expect(pool).toBeUndefined();
    });
  });
});
