import { expect } from "chai";
import sinon from "sinon";
import { CHAIN_CONSTANTS } from "../src/Constants";
import * as Erc20 from "../src/Erc20";
import * as PriceOracle from "../src/PriceOracle";
import { Cache } from "../src/cache";

import { setupCommon } from "./EventHandlers/Pool/common";

describe("PriceOracle", () => {
  let mockContext: any;
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
      prices: null,
    });
    const stubCache = sinon.stub(Cache, "init").returns({
      add: addStub,
      read: readStub,
    } as any);

    mockContext = {
      Token: { set: sinon.stub(), get: sinon.stub() },
      TokenPriceSnapshot: { set: sinon.stub(), get: sinon.stub() },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("getTokenPriceData", () => {
    describe("for USD like tokens", () => {
      describe("on Fraxtal", () => {
        let mockERC20Details: sinon.SinonStub;
        const expectedDiff = 100000n;
        const callData = {
          tokenAddress: "0xFc00000000000000000000000000000000000001",
          blockNumber: 17845899,
          chainId: 252,
        };
        beforeEach(() => {
          mockERC20Details = sinon.stub(Erc20, "getErc20TokenDetails").returns({
            decimals: 18n,
            name: "FRAX",
            symbol: "FRAX",
          } as any);
        });

        it("should return the correct hardcoded $1 price data for chain USDC", async () => {
          const priceData = await PriceOracle.getTokenPriceData(
            callData.tokenAddress,
            callData.blockNumber,
            callData.chainId,
          );
          const diff = priceData.pricePerUSDNew - 10n ** 18n;
          expect(diff < expectedDiff).to.be.true;
        });
      });
    });
  });

  describe("refreshTokenPrice", () => {
    let mockERC20Details: sinon.SinonStub;
    let testLastUpdated: Date;

    const mockTokenPriceData: any = {
      pricePerUSDNew: 2n * 10n ** 18n,
      decimals: mockToken0Data.decimals,
    };

    beforeEach(() => {
      mockContract = sinon
        .stub(CHAIN_CONSTANTS[chainId].eth_client, "simulateContract")
        .returns({
          result: [
            mockTokenPriceData.pricePerUSDNew.toString(),
            "2000000000000000000",
          ],
        } as any);
      mockERC20Details = sinon.stub(Erc20, "getErc20TokenDetails").returns({
        decimals: mockTokenPriceData.decimals,
      } as any);
    });

    describe("if the update interval hasn't passed", () => {
      let updatedToken: any;
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
          mockContext,
        );
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
          mockContext,
        );
        updatedToken = mockContext.Token.set.lastCall.args[0];
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
        const tokenPrice = mockContext.TokenPriceSnapshot.set.lastCall.args[0];
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

  describe("read_prices", () => {
    describe("integration test", () => {
      describe("Fraxtal Suite", () => {
        let mockERC20Details: sinon.SinonStub;
        const chainId = 252;

        describe("Scenarion USDC", () => {
          beforeEach(() => {
            mockERC20Details = sinon
              .stub(Erc20, "getErc20TokenDetails")
              .onCall(0)
              .returns({
                decimals: 6n,
                name: "USDC",
                symbol: "USDC",
              } as any)
              .onCall(1)
              .returns({
                decimals: 18n,
                name: "FRAX",
                symbol: "FRAX",
              } as any);
          });

          afterEach(() => {
            mockERC20Details.restore();
          });
          it("should return the correct prices", async () => {
            const test = {
              tokenAddress: "0xDcc0F2D8F90FDe85b10aC1c8Ab57dc0AE946A543",
              chainId: chainId,
              blockNumber: 18371605,
            };
            const price = await PriceOracle.getTokenPriceData(
              test.tokenAddress,
              test.blockNumber,
              test.chainId,
            );
            expect(price.pricePerUSDNew).to.equal(996633595813270431n); // Close to 10 ** 18
          });
        });
        describe("Scenario WETH", () => {
          beforeEach(() => {
            mockERC20Details = sinon
              .stub(Erc20, "getErc20TokenDetails")
              .onCall(0)
              .returns({
                decimals: 18n,
                name: "WETH",
                symbol: "WETH",
              } as any)
              .onCall(1)
              .returns({
                decimals: 18n,
                name: "FRAX",
                symbol: "FRAX",
              } as any);
          });

          afterEach(() => {
            mockERC20Details.restore();
          });
          it("should return the correct prices", async () => {
            const test = {
              tokenAddress: CHAIN_CONSTANTS[chainId].weth,
              chainId: chainId,
              blockNumber: 18028605,
            };
            const price = await PriceOracle.getTokenPriceData(
              test.tokenAddress,
              test.blockNumber,
              test.chainId,
            );
            expect(price.pricePerUSDNew).to.equal(2063950680307235736469n);
          });
        });
      });
      describe("Base Suite", () => {
        let mockERC20Details: sinon.SinonStub;
        const chainId = 8453;
        const test = {
          tokenAddress: CHAIN_CONSTANTS[chainId].weth,
        };

        describe("WETH", () => {
          beforeEach(() => {
            mockERC20Details = sinon
              .stub(Erc20, "getErc20TokenDetails")
              .onCall(0)
              .returns({
                decimals: 18n,
                name: "WETH",
                symbol: "WETH",
              } as any)
              .onCall(1)
              .returns({
                decimals: 6n,
                name: "USDC",
                symbol: "USDC",
              } as any);
          });

          afterEach(() => {
            mockERC20Details.restore();
          });

          it("Old should return the correct prices", async () => {
            const blockNumber = 19862773 - 120;
            const price = await PriceOracle.getTokenPriceData(
              test.tokenAddress,
              blockNumber,
              chainId,
            );
            expect(price.pricePerUSDNew).to.equal(2294389397280012597629n);
          });
          it("New should return the correct prices by converting to 18 decimals", async () => {
            const blockNumber = 28070572;
            const price = await PriceOracle.getTokenPriceData(
              test.tokenAddress,
              blockNumber,
              chainId,
            );
            expect(price.pricePerUSDNew).to.equal(2067268302000000000000n);
          });
        });
      });
    });
  });
});
