import { expect } from "chai";
import { MockDb, Pool } from "../../../generated/src/TestHelpers.gen";
import {
  LiquidityPoolAggregator,
  Token,
} from "../../../generated/src/Types.gen";
import { setupCommon } from "./common";
import {
  TEN_TO_THE_18_BI,
  TEN_TO_THE_6_BI,
  toChecksumAddress,
  TokenIdByChain,
} from "../../../src/Constants";
import sinon from "sinon";
import * as PriceOracle from "../../../src/PriceOracle";

describe("Pool Swap Event", () => {
  let mockToken0Data: any;
  let mockToken1Data: any;
  let mockLiquidityPoolData: any;

  let expectations: any = {};

  let eventData: any;
  let mockPriceOracle: sinon.SinonStub;
  let mockDb: any;

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
      expectations.expectedNetAmount0 * (TEN_TO_THE_18_BI / 10n ** mockToken0Data.decimals) *
      (mockToken0Data.pricePerUSDNew / TEN_TO_THE_18_BI);

    expectations.expectedLPVolumeUSD1 =
      mockLiquidityPoolData.totalVolumeUSD +
      expectations.expectedNetAmount1 * (TEN_TO_THE_18_BI / 10n ** mockToken1Data.decimals) *
      (mockToken1Data.pricePerUSDNew / TEN_TO_THE_18_BI);

    expectations.totalVolumeUSDWhitelisted =
      expectations.expectedLPVolumeUSD0;

    mockPriceOracle = sinon
      .stub(PriceOracle, "refreshTokenPrice")
      .callsFake(async (...args) => {
        return args[0]; // Return the token that was passed in
      });

    mockDb = MockDb.createMockDb();

    eventData = {
      sender: "0x4444444444444444444444444444444444444444",
      to: "0x5555555555555555555555555555555555555555",
      amount0In: expectations.swapAmount0In,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: expectations.swapAmount1Out,
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
  });

  afterEach(() => {
    mockPriceOracle.restore();
  });

  describe("when both tokens exist", () => {
    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let updatedPool: any;

    beforeEach(async () => {
      const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolData as LiquidityPoolAggregator
      );
      const updatedDB2 = updatedDB1.entities.Token.set(mockToken0Data as Token);
      const updatedDB3 = updatedDB2.entities.Token.set(mockToken1Data as Token);

      const mockEvent = Pool.Swap.createMockEvent(eventData);

      postEventDB = await Pool.Swap.processEvent({
        event: mockEvent,
        mockDb: updatedDB3,
      });
      updatedPool = postEventDB.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(eventData.mockEventData.srcAddress)
      );
    });

    it("should create a new Pool_Swap entity and update LiquidityPool", async () => {
      const swapEvent = postEventDB.entities.Pool_Swap.get("10_123456_1");
      expect(swapEvent).to.not.be.undefined;
      expect(swapEvent?.sender).to.equal(eventData.sender);
      expect(swapEvent?.to).to.equal(eventData.to);
      expect(swapEvent?.amount0In).to.equal(eventData.amount0In);
      expect(swapEvent?.amount1Out).to.equal(eventData.amount1Out);
      expect(swapEvent?.timestamp).to.deep.equal(
        new Date(eventData.mockEventData.block.timestamp * 1000)
      );
    });

    it("should update the Liquidity Pool aggregator", async () => {
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.totalVolume0).to.equal(
        expectations.totalVolume0
      );
      expect(updatedPool?.totalVolume1).to.equal(
        expectations.totalVolume1
      );
      expect(updatedPool?.totalVolumeUSD).to.equal(
        expectations.expectedLPVolumeUSD0
      );
      expect(updatedPool?.totalVolumeUSDWhitelisted).to.equal(
        expectations.totalVolumeUSDWhitelisted
      );
      expect(updatedPool?.numberOfSwaps).to.equal(
        mockLiquidityPoolData.numberOfSwaps + 1n
      );
      expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
        new Date(eventData.mockEventData.block.timestamp * 1000)
      );
    });
    it("should call refreshTokenPrice on token0", () => {
      const calledToken = mockPriceOracle.firstCall.args[0];
      expect(calledToken.address).to.equal(mockToken0Data.address);
    });
    it("should call refreshTokenPrice on token1", () => {
      const calledToken = mockPriceOracle.secondCall.args[0];
      expect(calledToken.address).to.equal(mockToken1Data.address);
    });
    it("should update the liquidity pool with token0IsWhitelisted", () => {
      expect(updatedPool?.token0IsWhitelisted).to.equal(mockToken0Data.isWhitelisted);
    });
    it("should update the liquidity pool with token1IsWhitelisted", () => {
      expect(updatedPool?.token1IsWhitelisted).to.equal(mockToken1Data.isWhitelisted);
    });
  });
});
