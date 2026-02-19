import "../../eventHandlersRegistration";
import type { LiquidityPoolAggregator, Token } from "generated";
import { MockDb, Pool } from "../../../generated/src/TestHelpers.gen";
import { PoolId, TEN_TO_THE_18_BI } from "../../../src/Constants";
import { setupCommon } from "./common";

describe("Pool Sync Event", () => {
  let mockToken0Data: Token;
  let mockToken1Data: Token;
  let mockLiquidityPoolData: LiquidityPoolAggregator;

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
    mockEventData: {
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      chainId: 10,
      logIndex: 1,
      srcAddress: "0x3333333333333333333333333333333333333333" as `0x${string}`,
    },
  };

  let mockDb: ReturnType<typeof MockDb.createMockDb>;

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

    mockDb = MockDb.createMockDb();
  });

  describe("when both tokens exist", () => {
    let postEventDB: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(async () => {
      const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolData as LiquidityPoolAggregator,
      );
      const updatedDB2 = updatedDB1.entities.Token.set(mockToken0Data);
      const updatedDB3 = updatedDB2.entities.Token.set(mockToken1Data);

      const mockEvent = Pool.Sync.createMockEvent(eventData);

      postEventDB = await updatedDB3.processEvents([mockEvent]);
    });
    it("should update reserves and usd liquidity", async () => {
      const updatedPool = postEventDB.entities.LiquidityPoolAggregator.get(
        PoolId(
          eventData.mockEventData.chainId,
          eventData.mockEventData.srcAddress,
        ),
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
      // Create a mockDb without the pool
      const updatedDB1 = mockDb.entities.Token.set(mockToken0Data);
      const updatedDB2 = updatedDB1.entities.Token.set(mockToken1Data);
      // Note: We intentionally don't set the LiquidityPoolAggregator

      const mockEvent = Pool.Sync.createMockEvent(eventData);

      const postEventDB = await updatedDB2.processEvents([mockEvent]);

      // Pool should not exist
      const pool = postEventDB.entities.LiquidityPoolAggregator.get(
        PoolId(
          eventData.mockEventData.chainId,
          eventData.mockEventData.srcAddress,
        ),
      );
      expect(pool).toBeUndefined();
    });
  });
});
