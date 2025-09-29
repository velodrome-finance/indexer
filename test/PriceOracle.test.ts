import { expect } from "chai";
import sinon from "sinon";
import { CHAIN_CONSTANTS } from "../src/Constants";
import * as PriceOracle from "../src/PriceOracle";
import { Cache } from "../src/cache";

import type { Token, handlerContext } from "../generated/src/Types.gen";

import { setupCommon } from "./EventHandlers/Pool/common";

describe("PriceOracle", () => {
  const mockContext = {
    effect: sinon.stub().callsFake(async (effectFn, input) => {
      // Mock the effect calls for testing
      if (effectFn.name === "getTokenPriceData") {
        return {
          pricePerUSDNew: 2n * 10n ** 18n,
          decimals: 18n,
        };
      }
      if (effectFn.name === "getTokenDetails") {
        return {
          name: "Test Token",
          decimals: 18,
          symbol: "TEST",
        };
      }
      return {};
    }),
    log: {
      info: sinon.stub(),
      error: sinon.stub(),
      warn: sinon.stub(),
      debug: sinon.stub(),
    },
    Token: {
      set: sinon.stub(),
      get: sinon.stub(),
      getOrThrow: sinon.stub(),
      getOrCreate: sinon.stub(),
      deleteUnsafe: sinon.stub(),
      getWhere: {
        address: {
          eq: sinon.stub(),
          gt: sinon.stub(),
        },
        chainId: {
          eq: sinon.stub(),
          gt: sinon.stub(),
        },
      },
    },
    TokenPriceSnapshot: {
      set: sinon.stub(),
      get: sinon.stub(),
      getOrThrow: sinon.stub(),
      getOrCreate: sinon.stub(),
      deleteUnsafe: sinon.stub(),
      getWhere: {
        address: {
          eq: sinon.stub(),
          gt: sinon.stub(),
        },
        chainId: {
          eq: sinon.stub(),
          gt: sinon.stub(),
        },
        lastUpdatedTimestamp: {
          eq: sinon.stub(),
          gt: sinon.stub(),
        },
      },
    },
  } as Partial<handlerContext>;

  const chainId = 10; // Optimism
  const eth_client = CHAIN_CONSTANTS[chainId].eth_client;
  const startBlock = CHAIN_CONSTANTS[chainId].oracle.startBlock;
  const blockNumber = startBlock + 1;
  const blockDatetime = new Date("2023-01-01T00:00:00Z");

  let addStub: sinon.SinonStub;
  let readStub: sinon.SinonStub;
  const { mockToken0Data } = setupCommon();

  beforeEach(() => {
    addStub = sinon.stub();
    readStub = sinon.stub().returns({
      prices: null,
    });
    const stubCache = sinon.stub(Cache, "init").returns({
      add: addStub,
      read: readStub,
    } as ReturnType<typeof Cache.init>);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("refreshTokenPrice", () => {
    let testLastUpdated: Date;

    const mockTokenPriceData = {
      pricePerUSDNew: 2n * 10n ** 18n,
      decimals: mockToken0Data.decimals,
    };

    describe("if the update interval hasn't passed", () => {
      beforeEach(async () => {
        testLastUpdated = new Date(blockDatetime.getTime());
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: testLastUpdated,
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
          1000000n,
        );
      });
      it("should not update prices if the update interval hasn't passed", async () => {
        expect((mockContext.Token?.set as sinon.SinonStub).called).to.be.false;
        expect((mockContext.TokenPriceSnapshot?.set as sinon.SinonStub).called)
          .to.be.false;
      });
    });
    describe("if the update interval has passed", () => {
      let updatedToken: Token;
      let testLastUpdated: Date;
      beforeEach(async () => {
        testLastUpdated = new Date(blockDatetime.getTime() - 61 * 60 * 1000);
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: testLastUpdated,
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
          1000000n,
        );
        updatedToken = (mockContext.Token?.set as sinon.SinonStub).lastCall
          .args[0];
      });
      it("should update prices if the update interval has passed", async () => {
        expect(updatedToken.pricePerUSDNew).to.equal(
          mockTokenPriceData.pricePerUSDNew,
        );
        expect(updatedToken.lastUpdatedTimestamp.getTime()).greaterThan(
          testLastUpdated.getTime(),
        );
      });
      it("should create a new TokenPriceSnapshot entity", async () => {
        const tokenPrice = (
          mockContext.TokenPriceSnapshot?.set as sinon.SinonStub
        ).lastCall.args[0];
        expect(tokenPrice.pricePerUSDNew).to.equal(
          mockTokenPriceData.pricePerUSDNew,
        );
        expect(tokenPrice.lastUpdatedTimestamp.getTime()).greaterThan(
          testLastUpdated.getTime(),
        );
        expect(tokenPrice.isWhitelisted).to.equal(mockToken0Data.isWhitelisted);
      });
    });
  });
});
