import { expect } from "chai";
import sinon from "sinon";
import { CHAIN_CONSTANTS } from "../src/Constants";
import * as PriceOracle from "../src/PriceOracle";

import type { Token, handlerContext } from "../generated/src/Types.gen";

import { setupCommon } from "./EventHandlers/Pool/common";

describe("PriceOracle", () => {
  const mockContext = {
    effect: sinon.stub().callsFake(async (effectFn, input) => {
      // Mock the effect calls for testing
      if (effectFn.name === "getTokenPrice") {
        return {
          pricePerUSDNew: 2n * 10n ** 18n,
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
          lt: sinon.stub(),
        },
        chainId: {
          eq: sinon.stub(),
          gt: sinon.stub(),
          lt: sinon.stub(),
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
          lt: sinon.stub(),
        },
        chainId: {
          eq: sinon.stub(),
          gt: sinon.stub(),
          lt: sinon.stub(),
        },
        lastUpdatedTimestamp: {
          eq: sinon.stub(),
          gt: sinon.stub(),
          lt: sinon.stub(),
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

    describe("when pricePerUSDNew is 0n", () => {
      let updatedToken: Token;
      beforeEach(async () => {
        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: new Date(blockDatetime.getTime()),
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
      it("should refresh price even if less than 1 hour has passed", async () => {
        expect((mockContext.Token?.set as sinon.SinonStub).called).to.be.true;
        expect(updatedToken.pricePerUSDNew).to.equal(
          mockTokenPriceData.pricePerUSDNew,
        );
      });
    });

    describe("when lastUpdatedTimestamp is missing", () => {
      let updatedToken: Token;
      beforeEach(async () => {
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: undefined,
        } as unknown as Token;
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
      it("should refresh price when lastUpdatedTimestamp is missing", async () => {
        expect((mockContext.Token?.set as sinon.SinonStub).called).to.be.true;
        expect(updatedToken.pricePerUSDNew).to.equal(
          mockTokenPriceData.pricePerUSDNew,
        );
        expect(updatedToken.lastUpdatedTimestamp).to.be.instanceOf(Date);
      });
    });

    describe("when price fetch fails", () => {
      let originalToken: Token;
      beforeEach(async () => {
        // Reset stubs first
        (mockContext.Token?.set as sinon.SinonStub).resetHistory();
        (mockContext.log?.error as sinon.SinonStub).resetHistory();

        // Mock effect to throw an error
        (mockContext.effect as sinon.SinonStub).callsFake(async (effectFn) => {
          if (effectFn.name === "getTokenPrice") {
            throw new Error("Price fetch failed");
          }
          if (effectFn.name === "getTokenDetails") {
            return {
              name: "Test Token",
              decimals: 18,
              symbol: "TEST",
            };
          }
          return {};
        });

        const testLastUpdated = new Date(
          blockDatetime.getTime() - 61 * 60 * 1000,
        );
        originalToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: testLastUpdated,
        } as Token;
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          originalToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
          1000000n,
        );
      });
      afterEach(() => {
        // Restore original effect stub behavior
        (mockContext.effect as sinon.SinonStub).callsFake(
          async (effectFn, input) => {
            if (effectFn.name === "getTokenPrice") {
              return {
                pricePerUSDNew: 2n * 10n ** 18n,
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
          },
        );
      });
      it("should log error when price fetch fails", async () => {
        // Should log error
        expect((mockContext.log?.error as sinon.SinonStub).called).to.be.true;
        const errorCall = (mockContext.log?.error as sinon.SinonStub).lastCall;
        expect(errorCall.args[0]).to.include("Error refreshing token price");
      });
      it("should not update token when price fetch fails", async () => {
        // Token.set should not be called when error occurs
        // The function catches the error and returns the original token
        const setCalls = (mockContext.Token?.set as sinon.SinonStub).getCalls();
        // Filter out any calls from previous tests
        const errorRelatedCalls = setCalls.filter(
          (call) => call.args[0]?.address === originalToken.address,
        );
        expect(errorRelatedCalls.length).to.equal(0);
      });
    });
  });

  describe("createTokenEntity", () => {
    const tokenAddress = "0x1111111111111111111111111111111111111111";
    const blockNumber = 1000000;

    beforeEach(() => {
      // Reset stubs
      (mockContext.Token?.set as sinon.SinonStub).resetHistory();
      (mockContext.effect as sinon.SinonStub).resetHistory();
    });

    it("should create a token entity with correct fields", async () => {
      const token = await PriceOracle.createTokenEntity(
        tokenAddress,
        chainId,
        blockNumber,
        mockContext as handlerContext,
      );

      expect(token).to.not.be.undefined;
      expect(token.address).to.equal(tokenAddress);
      expect(token.symbol).to.equal("TEST");
      expect(token.name).to.equal("Test Token");
      expect(token.decimals).to.equal(18n);
      expect(token.pricePerUSDNew).to.equal(0n);
      expect(token.chainId).to.equal(chainId);
      expect(token.isWhitelisted).to.be.false;
      expect(token.lastUpdatedTimestamp).to.be.instanceOf(Date);
    });

    it("should call Token.set with the created entity", async () => {
      await PriceOracle.createTokenEntity(
        tokenAddress,
        chainId,
        blockNumber,
        mockContext as handlerContext,
      );

      expect((mockContext.Token?.set as sinon.SinonStub).calledOnce).to.be.true;
      const setToken = (mockContext.Token?.set as sinon.SinonStub).lastCall
        .args[0];
      expect(setToken.address).to.equal(tokenAddress);
      expect(setToken.pricePerUSDNew).to.equal(0n);
    });

    it("should call getTokenDetails effect", async () => {
      await PriceOracle.createTokenEntity(
        tokenAddress,
        chainId,
        blockNumber,
        mockContext as handlerContext,
      );

      expect((mockContext.effect as sinon.SinonStub).calledOnce).to.be.true;
      const effectCall = (mockContext.effect as sinon.SinonStub).lastCall;
      expect(effectCall.args[1].contractAddress).to.equal(tokenAddress);
      expect(effectCall.args[1].chainId).to.equal(chainId);
    });
  });
});
