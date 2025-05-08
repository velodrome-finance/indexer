import { expect } from "chai";
import { Pool, MockDb } from "../../../generated/src/TestHelpers.gen";
import { LiquidityPoolAggregator, Token } from "../../../generated/src/Types.gen";
import { setupCommon } from "./common";
import { TEN_TO_THE_18_BI, TEN_TO_THE_6_BI, toChecksumAddress, TokenIdByChain } from "../../../src/Constants";

describe("Pool Fees Event", () => {
  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } = setupCommon();
  const poolId = mockLiquidityPoolData.id;

  let mockDb: any;
  let updatedDB: any;
  let expectations: any = {
    amount0In: 3n * 10n ** 18n,
    amount1In: 2n * 10n ** 6n,
    totalLiquidityUSD: 0n,
    totalFeesUSDWhitelisted: 0n,
  };

  expectations.totalLiquidityUSD =
    (mockLiquidityPoolData.reserve0 - expectations.amount0In) * mockToken0Data.pricePerUSDNew / ( 10n ** (mockToken0Data.decimals) )  +
    (mockLiquidityPoolData.reserve1 - expectations.amount1In) * mockToken1Data.pricePerUSDNew / ( 10n ** (mockToken1Data.decimals) );
  
  expectations.totalFeesUSD =
        mockLiquidityPoolData.totalFeesUSD +
          (expectations.amount0In / 10n ** (mockToken0Data.decimals) ) * mockToken0Data.pricePerUSDNew +
          (expectations.amount1In / 10n ** (mockToken1Data.decimals) ) * mockToken1Data.pricePerUSDNew;

  expectations.totalFeesUSDWhitelisted = expectations.totalFeesUSD;

  let updatedPool: any;
  
  beforeEach(async () => {
    mockDb = MockDb.createMockDb();
    updatedDB = mockDb.entities.Token.set(mockToken0Data as Token);
    updatedDB = updatedDB.entities.Token.set(mockToken1Data as Token);
    updatedDB = updatedDB.entities.LiquidityPoolAggregator.set(mockLiquidityPoolData);

    const mockEvent = Pool.Fees.createMockEvent({
      amount0: expectations.amount0In,
      amount1: expectations.amount1In,
      mockEventData: {
        block: {
          number: 123456,
          timestamp: 1000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        srcAddress: poolId,
      },
    });

    const result = await Pool.Fees.processEvent({
      event: mockEvent,
      mockDb: updatedDB,
    });

    updatedPool = result.entities.LiquidityPoolAggregator.get(poolId);
  });

  it("should update LiquidityPoolAggregator", async () => {
    expect(updatedPool).to.not.be.undefined;
    expect(updatedPool.lastUpdatedTimestamp).to.deep.equal(new Date(1000000 * 1000));
  });

  it("should update LiquidityPoolAggregator nominal fees", async () => {
    expect(updatedPool.totalFees0).to.equal(
      mockLiquidityPoolData.totalFees0 + expectations.amount0In
    );
    expect(updatedPool.totalFees1).to.equal(
      mockLiquidityPoolData.totalFees1 + expectations.amount1In
    );
  });

  it("should update LiquidityPoolAggregator total fees in USD", async () => {
    expect(updatedPool.totalFeesUSD).to.equal(expectations.totalFeesUSD);
  });

  it("should update LiquidityPoolAggregator total fees in USD whitelisted", async () => {
    expect(updatedPool.totalFeesUSDWhitelisted).to.equal(expectations.totalFeesUSDWhitelisted);
  });
});
