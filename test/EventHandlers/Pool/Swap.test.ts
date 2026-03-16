import type { LiquidityPoolAggregator, Token } from "generated";
import type { MockInstance } from "vitest";
import { MockDb, Pool } from "../../../generated/src/TestHelpers.gen";
import {
  PoolId,
  TEN_TO_THE_18_BI,
  toChecksumAddress,
} from "../../../src/Constants";
import * as PriceOracle from "../../../src/PriceOracle";
import { setupCommon } from "./common";

describe("Pool Swap Event", () => {
  let mockToken0Data: Token;
  let mockToken1Data: Token;
  let mockLiquidityPoolData: LiquidityPoolAggregator;

  const expectations = {
    swapAmount0In: 0n,
    swapAmount1Out: 0n,
    expectedNetAmount0: 0n,
    expectedNetAmount1: 0n,
    totalVolume0: 0n,
    totalVolume1: 0n,
    expectedLPVolumeUSD0: 0n,
    expectedLPVolumeUSD1: 0n,
    totalVolumeUSDWhitelisted: 0n,
  };

  const eventData = {
    sender: toChecksumAddress("0x4444444444444444444444444444444444444444"),
    to: toChecksumAddress("0x5555555555555555555555555555555555555555"),
    amount0In: 0n,
    amount1In: 0n,
    amount0Out: 0n,
    amount1Out: 0n,
    mockEventData: {
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      chainId: 10,
      logIndex: 1,
      srcAddress: toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      ),
    },
  };

  let mockPriceOracle: MockInstance;
  let mockDb: ReturnType<typeof MockDb.createMockDb>;

  beforeEach(() => {
    const setupData = setupCommon();
    mockToken0Data = setupData.mockToken0Data;
    mockToken1Data = setupData.mockToken1Data;
    mockLiquidityPoolData = setupData.mockLiquidityPoolData;

    expectations.swapAmount0In = 100n * 10n ** mockToken0Data.decimals;
    expectations.swapAmount1Out = 99n * 10n ** mockToken1Data.decimals;

    expectations.expectedNetAmount0 = expectations.swapAmount0In;

    expectations.expectedNetAmount1 = expectations.swapAmount1Out;

    expectations.totalVolume0 =
      mockLiquidityPoolData.totalVolume0 + expectations.swapAmount0In;
    expectations.totalVolume1 =
      mockLiquidityPoolData.totalVolume1 + expectations.swapAmount1Out;

    // The code expects pricePerUSDNew to be normalized to 1e18
    expectations.expectedLPVolumeUSD0 =
      mockLiquidityPoolData.totalVolumeUSD +
      expectations.expectedNetAmount0 *
        (TEN_TO_THE_18_BI / 10n ** mockToken0Data.decimals) *
        (mockToken0Data.pricePerUSDNew / TEN_TO_THE_18_BI);

    expectations.expectedLPVolumeUSD1 =
      mockLiquidityPoolData.totalVolumeUSD +
      expectations.expectedNetAmount1 *
        (TEN_TO_THE_18_BI / 10n ** mockToken1Data.decimals) *
        (mockToken1Data.pricePerUSDNew / TEN_TO_THE_18_BI);

    expectations.totalVolumeUSDWhitelisted = expectations.expectedLPVolumeUSD0;

    mockPriceOracle = vi
      .spyOn(PriceOracle, "refreshTokenPrice")
      .mockImplementation(async (...args) => {
        return args[0]; // Return the token that was passed in
      });

    mockDb = MockDb.createMockDb();
    eventData.amount0In = expectations.swapAmount0In;
    eventData.amount1Out = expectations.swapAmount1Out;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when both tokens exist", () => {
    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let updatedPool: LiquidityPoolAggregator | undefined;

    beforeEach(async () => {
      const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolData as LiquidityPoolAggregator,
      );
      const updatedDB2 = updatedDB1.entities.Token.set(mockToken0Data as Token);
      const updatedDB3 = updatedDB2.entities.Token.set(mockToken1Data as Token);

      const mockEvent = Pool.Swap.createMockEvent(eventData);

      postEventDB = await updatedDB3.processEvents([mockEvent]);
      updatedPool = postEventDB.entities.LiquidityPoolAggregator.get(
        PoolId(
          eventData.mockEventData.chainId,
          eventData.mockEventData.srcAddress,
        ),
      );
    });

    it("should update the Liquidity Pool aggregator", async () => {
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.totalVolume0).toBe(expectations.totalVolume0);
      expect(updatedPool?.totalVolume1).toBe(expectations.totalVolume1);
      expect(updatedPool?.totalVolumeUSD).toBe(
        expectations.expectedLPVolumeUSD0,
      );
      expect(updatedPool?.totalVolumeUSDWhitelisted).toBe(
        expectations.totalVolumeUSDWhitelisted,
      );
      expect(updatedPool?.numberOfSwaps).toBe(
        mockLiquidityPoolData.numberOfSwaps + 1n,
      );
      expect(updatedPool?.lastUpdatedTimestamp).toEqual(
        new Date(eventData.mockEventData.block.timestamp * 1000),
      );
    });
    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should call refreshTokenPrice on token0", () => {
      const calledToken = mockPriceOracle.mock.calls[0][0];
      expect(calledToken.address).toBe(mockToken0Data.address);
    });
    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should call refreshTokenPrice on token1", () => {
      const calledToken = mockPriceOracle.mock.calls[1][0];
      expect(calledToken.address).toBe(mockToken1Data.address);
    });
  });

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      // Create a mockDb without the pool
      const updatedDB1 = mockDb.entities.Token.set(mockToken0Data as Token);
      const updatedDB2 = updatedDB1.entities.Token.set(mockToken1Data as Token);
      // Note: We intentionally don't set the LiquidityPoolAggregator

      const mockEvent = Pool.Swap.createMockEvent(eventData);

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
