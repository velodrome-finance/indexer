import { expect } from "chai";
import sinon from "sinon";
import * as PriceOracle from "../src/PriceOracle";
import * as Erc20 from "../src/Erc20";
import { CHAIN_CONSTANTS } from "../src/Constants";
import { Cache } from "../src/cache";

import { setupCommon } from "./EventHandlers/Pool/common";

describe("PriceOracle", () => {
  let mockContext: any ;
  let mockContract: any;

  const chainId = 10; // Optimism
  const startBlock = CHAIN_CONSTANTS[chainId].oracle.startBlock;
  const blockNumber = startBlock + 1;
  const blockDatetime = new Date("2023-01-01T00:00:00Z");

  let addStub: sinon.SinonStub;
  let readStub: sinon.SinonStub;
  const { mockToken0Data } = setupCommon();

  beforeEach(() => {
    addStub = sinon.stub();
    readStub = sinon.stub().returns({
      prices: null
    });
    const stubCache = sinon.stub(Cache, "init").returns({
      add: addStub,
      read: readStub
    } as any);

    mockContext = {
        Token: { set: sinon.stub(), get: sinon.stub() },
        TokenPriceSnapshot: { set: sinon.stub(), get: sinon.stub() }
    };

  });

  afterEach(() => {
    sinon.restore();
  });

  describe("refreshTokenPrice", () => {
    let mockERC20Details: sinon.SinonStub;
    let testLastUpdated: Date;

    const mockTokenPriceData: any = {
      pricePerUSDNew: 2n * 10n ** 18n,
      decimals: mockToken0Data.decimals,
    };

    beforeEach(() => {
      mockContract = sinon.stub(CHAIN_CONSTANTS[chainId].eth_client, "simulateContract")
        .returns({
          result: [mockTokenPriceData.pricePerUSDNew.toString(), "2000000000000000000"]
        } as any);
      mockERC20Details = sinon.stub(Erc20, "getErc20TokenDetails")
        .returns({
          decimals: mockTokenPriceData.decimals
        } as any);
    });

    describe("if the update interval hasn't passed", () => {
      let updatedToken: any;
      beforeEach(async () => {
        testLastUpdated = new Date(blockDatetime.getTime());
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: testLastUpdated
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(fetchedToken, blockNumber, blockTimestamp, chainId, mockContext);
      });
      it("should not update prices if the update interval hasn't passed", async () => {
        expect(mockContract.called).to.be.false;
        expect(mockContext.Token.set.called).to.be.false;
        expect(mockContext.TokenPriceSnapshot.set.called).to.be.false;
      });
    });
    describe("if the update interval has passed", () => {
      let updatedToken: any;
      let testLastUpdated: Date;
      beforeEach(async () => {
        testLastUpdated = new Date(blockDatetime.getTime() - (61 * 60 * 1000));
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: testLastUpdated
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(fetchedToken, blockNumber, blockTimestamp, chainId, mockContext);
        updatedToken = mockContext.Token.set.lastCall.args[0];
      });
      it("should update prices if the update interval has passed", async () => {
        expect(updatedToken.pricePerUSDNew).to.equal(mockTokenPriceData.pricePerUSDNew);
        expect(updatedToken.lastUpdatedTimestamp.getTime()).greaterThan(testLastUpdated.getTime());
      });
      it("should create a new TokenPriceSnapshot entity", async () => {
        const tokenPrice = mockContext.TokenPriceSnapshot.set.lastCall.args[0];
        expect(tokenPrice.pricePerUSDNew).to.equal(mockTokenPriceData.pricePerUSDNew);
        expect(tokenPrice.lastUpdatedTimestamp.getTime()).greaterThan(testLastUpdated.getTime());
        expect(tokenPrice.isWhitelisted).to.equal(mockToken0Data.isWhitelisted);
      });
    });
  });
});
