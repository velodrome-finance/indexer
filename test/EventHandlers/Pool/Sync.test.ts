import { expect } from "chai";
import { Pool, MockDb } from "../../../generated/src/TestHelpers.gen";
import { LiquidityPoolAggregator } from "../../../generated/src/Types.gen";
import { setupCommon } from "./common";
import { TEN_TO_THE_18_BI, TEN_TO_THE_6_BI, toChecksumAddress, TokenIdByChain } from "../../../src/Constants";

describe("Pool Sync Event", () => {
  let mockToken0Data: any;
  let mockToken1Data: any;
  let mockLiquidityPoolData: any;

  let expectations: any = {};

  let eventData: any;
  let mockDb: any;

  beforeEach(() => {
    const setupData = setupCommon();
    mockToken0Data = setupData.mockToken0Data;
    mockToken1Data = setupData.mockToken1Data;
    mockLiquidityPoolData = setupData.mockLiquidityPoolData;

    expectations.reserveAmount0In = 100n * (10n ** mockToken0Data.decimals);
    expectations.reserveAmount1In = 200n * (10n ** mockToken1Data.decimals);


    expectations.expectedReserve0 = expectations.reserveAmount0In;
    expectations.expectedReserve1 =expectations.reserveAmount1In;

    expectations.expectedReserve0InMissing = expectations.reserveAmount0In;
    expectations.expectedReserve1InMissing = expectations.reserveAmount1In; 

    expectations.expectedLiquidity0USD =
      expectations.expectedReserve0 * (10n ** (18n - mockToken0Data.decimals)) *
      mockToken0Data.pricePerUSDNew / TEN_TO_THE_18_BI;
    expectations.expectedLiquidity1USD =
      expectations.expectedReserve1 * (10n ** (18n - mockToken1Data.decimals)) *
      mockToken1Data.pricePerUSDNew / TEN_TO_THE_18_BI;

    eventData = {
      reserve0: expectations.reserveAmount0In,
      reserve1: expectations.reserveAmount1In,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
      },
    };

    mockDb = MockDb.createMockDb();
  });

  describe("when both tokens are missing", () => {
    it("should update LiquidityPool reserves, but not liquidity USD", async () => {
      const modifiedMockLiquidityPoolData = {
        ...mockLiquidityPoolData,
        token0_id: TokenIdByChain("0x9999999999999999999999999999999999999990", 10),
        token1_id: TokenIdByChain("0x9999999999999999999999999999999999999999", 10),
      };

      const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(modifiedMockLiquidityPoolData as LiquidityPoolAggregator);
      const mockEvent = Pool.Sync.createMockEvent(eventData);

      const postEventDB = await Pool.Sync.processEvent({
        event: mockEvent,
        mockDb: updatedDB1,
      });

      const updatedPool = postEventDB.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(eventData.mockEventData.srcAddress)
      );
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.reserve0).to.equal(expectations.expectedReserve0InMissing);
      expect(updatedPool?.reserve1).to.equal(expectations.expectedReserve1InMissing);
      expect(updatedPool?.totalLiquidityUSD)
        .to.equal(mockLiquidityPoolData.totalLiquidityUSD, "totalLiquidityUSD should be the same as the original value");
    });
  });

  describe("when both tokens exist", () => {
    let postEventDB: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(async () => {
      const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolData as LiquidityPoolAggregator
      );
      const updatedDB2 = updatedDB1.entities.Token.set(mockToken0Data);
      const updatedDB3 = updatedDB2.entities.Token.set(mockToken1Data);

      const mockEvent = Pool.Sync.createMockEvent(eventData);

      postEventDB = await Pool.Sync.processEvent({
        event: mockEvent,
        mockDb: updatedDB3,
      });

    });
    it("should update reserves and usd liquidity", async () => {
      const updatedPool = postEventDB.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(eventData.mockEventData.srcAddress)
      );
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.reserve0).to.equal(expectations.expectedReserve0);
      expect(updatedPool?.reserve1).to.equal(expectations.expectedReserve1);
      expect(updatedPool?.totalLiquidityUSD).to
        .equal(expectations.expectedLiquidity0USD + expectations.expectedLiquidity1USD);
    });
  });
});
