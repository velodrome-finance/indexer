import { expect } from "chai";
import sinon from "sinon";
import { MockDb, Pool } from "../../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
} from "../../../generated/src/Types.gen";
import {
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  TokenIdByChain,
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
    sender: "0x4444444444444444444444444444444444444444",
    to: "0x5555555555555555555555555555555555555555",
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
      srcAddress: "0x3333333333333333333333333333333333333333",
    },
  };

  let mockPriceOracle: sinon.SinonStub;
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

    mockPriceOracle = sinon
      .stub(PriceOracle, "refreshTokenPrice")
      .callsFake(async (...args) => {
        return args[0]; // Return the token that was passed in
      });

    mockDb = MockDb.createMockDb();
    eventData.amount0In = expectations.swapAmount0In;
    eventData.amount1Out = expectations.swapAmount1Out;
  });

  afterEach(() => {
    mockPriceOracle.restore();
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

      postEventDB = await Pool.Swap.processEvent({
        event: mockEvent,
        mockDb: updatedDB3,
      });
      updatedPool = postEventDB.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(eventData.mockEventData.srcAddress),
      );
    });

    it("should update UserStatsPerPool with swap activity", async () => {
      const userStats = postEventDB.entities.UserStatsPerPool.get(
        `${eventData.sender.toLowerCase()}_${eventData.mockEventData.srcAddress.toLowerCase()}_${eventData.mockEventData.chainId}`,
      );
      expect(userStats).to.not.be.undefined;
      expect(userStats?.userAddress).to.equal(eventData.sender.toLowerCase());
      expect(userStats?.poolAddress).to.equal(
        eventData.mockEventData.srcAddress.toLowerCase(),
      );
      expect(userStats?.chainId).to.equal(eventData.mockEventData.chainId);
      expect(userStats?.numberOfSwaps).to.equal(1n);
      expect(userStats?.totalSwapVolumeUSD).to.equal(100000000000000000000n); // 100 tokens * 1 USD
      expect(userStats?.lastActivityTimestamp).to.deep.equal(
        new Date(eventData.mockEventData.block.timestamp * 1000),
      );
    });

    it("should update the Liquidity Pool aggregator", async () => {
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.totalVolume0).to.equal(expectations.totalVolume0);
      expect(updatedPool?.totalVolume1).to.equal(expectations.totalVolume1);
      expect(updatedPool?.totalVolumeUSD).to.equal(
        expectations.expectedLPVolumeUSD0,
      );
      expect(updatedPool?.totalVolumeUSDWhitelisted).to.equal(
        expectations.totalVolumeUSDWhitelisted,
      );
      expect(updatedPool?.numberOfSwaps).to.equal(
        mockLiquidityPoolData.numberOfSwaps + 1n,
      );
      expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
        new Date(eventData.mockEventData.block.timestamp * 1000),
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
      expect(updatedPool?.token0IsWhitelisted).to.equal(
        mockToken0Data.isWhitelisted,
      );
    });
    it("should update the liquidity pool with token1IsWhitelisted", () => {
      expect(updatedPool?.token1IsWhitelisted).to.equal(
        mockToken1Data.isWhitelisted,
      );
    });
  });
});
