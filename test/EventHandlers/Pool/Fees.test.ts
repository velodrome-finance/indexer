import type { LiquidityPoolAggregator, Token } from "generated";
import { MockDb, Pool } from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "./common";

describe("Pool Fees Event", () => {
  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } =
    setupCommon();
  const poolId = mockLiquidityPoolData.id;

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let updatedDB: ReturnType<typeof MockDb.createMockDb>;
  const expectations = {
    amount0In: 3n * 10n ** 18n,
    amount1In: 2n * 10n ** 6n,
    totalLiquidityUSD: 0n,
    totalFeesUSDWhitelisted: 0n,
    totalFeesGeneratedUSD: 0n,
  };

  expectations.totalLiquidityUSD =
    ((mockLiquidityPoolData.reserve0 - expectations.amount0In) *
      mockToken0Data.pricePerUSDNew) /
      10n ** mockToken0Data.decimals +
    ((mockLiquidityPoolData.reserve1 - expectations.amount1In) *
      mockToken1Data.pricePerUSDNew) /
      10n ** mockToken1Data.decimals;

  expectations.totalFeesGeneratedUSD =
    mockLiquidityPoolData.totalFeesGeneratedUSD +
    (expectations.amount0In / 10n ** mockToken0Data.decimals) *
      mockToken0Data.pricePerUSDNew +
    (expectations.amount1In / 10n ** mockToken1Data.decimals) *
      mockToken1Data.pricePerUSDNew;

  expectations.totalFeesUSDWhitelisted = expectations.totalFeesGeneratedUSD;

  let updatedPool: LiquidityPoolAggregator | undefined;

  beforeEach(async () => {
    mockDb = MockDb.createMockDb();
    updatedDB = mockDb.entities.Token.set(mockToken0Data as Token);
    updatedDB = updatedDB.entities.Token.set(mockToken1Data as Token);
    updatedDB = updatedDB.entities.LiquidityPoolAggregator.set(
      mockLiquidityPoolData,
    );

    const mockEvent = Pool.Fees.createMockEvent({
      amount0: expectations.amount0In,
      amount1: expectations.amount1In,
      sender: toChecksumAddress("0x1234567890123456789012345678901234567890"),
      mockEventData: {
        block: {
          number: 123456,
          timestamp: 1000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        srcAddress: mockLiquidityPoolData.poolAddress as `0x${string}`,
      },
    });

    const result = await updatedDB.processEvents([mockEvent]);

    updatedPool = result.entities.LiquidityPoolAggregator.get(poolId);
  });

  it("should update LiquidityPoolAggregator", async () => {
    expect(updatedPool).toBeDefined();
    expect(updatedPool?.lastUpdatedTimestamp).toEqual(new Date(1000000 * 1000));
  });

  it("should update LiquidityPoolAggregator nominal fees", async () => {
    // For regular pools, fees are tracked as unstaked fees
    expect(updatedPool?.totalFeesGenerated0).toBe(
      mockLiquidityPoolData.totalFeesGenerated0 + expectations.amount0In,
    );
    expect(updatedPool?.totalFeesGenerated1).toBe(
      mockLiquidityPoolData.totalFeesGenerated1 + expectations.amount1In,
    );
  });

  it("should update LiquidityPoolAggregator total fees in USD", async () => {
    expect(updatedPool?.totalFeesGeneratedUSD).toBe(
      expectations.totalFeesGeneratedUSD,
    );
  });

  it("should update LiquidityPoolAggregator total fees in USD whitelisted", async () => {
    expect(updatedPool?.totalFeesUSDWhitelisted).toBe(
      expectations.totalFeesUSDWhitelisted,
    );
  });

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      // Create a fresh mockDb without the pool
      const freshMockDb = MockDb.createMockDb();
      const updatedDB1 = freshMockDb.entities.Token.set(
        mockToken0Data as Token,
      );
      const updatedDB2 = updatedDB1.entities.Token.set(mockToken1Data as Token);
      // Note: We intentionally don't set the LiquidityPoolAggregator

      const mockEvent = Pool.Fees.createMockEvent({
        amount0: 3n * 10n ** 18n,
        amount1: 2n * 10n ** 6n,
        sender: toChecksumAddress("0x1234567890123456789012345678901234567890"),
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          srcAddress: mockLiquidityPoolData.poolAddress as `0x${string}`,
        },
      });

      const postEventDB = await updatedDB2.processEvents([mockEvent]);

      // Pool should not exist
      const pool = postEventDB.entities.LiquidityPoolAggregator.get(poolId);
      expect(pool).toBeUndefined();
    });
  });
});
