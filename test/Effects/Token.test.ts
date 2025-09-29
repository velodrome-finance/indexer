import { expect } from "chai";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import sinon from "sinon";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS } from "../../src/Constants";
import {
  fetchTokenDetails,
  fetchTokenPrice,
  getTokenDetails,
  getTokenPrice,
  getTokenPriceData,
} from "../../src/Effects/Token";

describe("Token Effects", () => {
  let mockContext: {
    effect: (
      effect: {
        name: string;
        handler: (args: { input: unknown; context: unknown }) => unknown;
      },
      input: unknown,
    ) => unknown;
    ethClient: PublicClient;
    log: Envio_logger;
  };
  let mockEthClient: PublicClient;
  let chainConstantsStub: sinon.SinonStub;

  beforeEach(() => {
    mockEthClient = {
      simulateContract: sinon.stub().resolves({
        result: "Test Token",
      }),
    } as unknown as PublicClient;

    // Mock CHAIN_CONSTANTS by directly setting the property
    (CHAIN_CONSTANTS as Record<number, unknown>)[10] = {
      eth_client: mockEthClient,
      oracle: {
        getType: () => "V3",
        getAddress: () => "0x1234567890123456789012345678901234567890",
        getPrice: sinon.stub(),
      },
    };

    mockContext = {
      effect: (
        effect: {
          name: string;
          handler: (args: { input: unknown; context: unknown }) => unknown;
        },
        input: unknown,
      ) => effect.handler({ input, context: mockContext }),
      ethClient: mockEthClient,
      log: {
        info: sinon.stub(),
        error: sinon.stub(),
        warn: sinon.stub(),
        debug: sinon.stub(),
      } as unknown as Envio_logger,
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("getTokenDetails", () => {
    it("should be a valid effect object", () => {
      expect(getTokenDetails).to.be.an("object");
      expect(getTokenDetails).to.have.property("name", "getTokenDetails");
    });
  });

  describe("getTokenPrice", () => {
    it("should be a valid effect object", () => {
      expect(getTokenPrice).to.be.an("object");
      expect(getTokenPrice).to.have.property("name", "getTokenPrice");
    });
  });

  describe("getTokenPriceData", () => {
    it("should be a valid effect object", () => {
      expect(getTokenPriceData).to.be.an("object");
      expect(getTokenPriceData).to.have.property("name", "getTokenPriceData");
    });
  });

  describe("fetchTokenDetails", () => {
    it("should fetch token details from contract", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;

      const result = await fetchTokenDetails(
        tokenAddress,
        chainId,
        mockEthClient,
        mockContext.log,
      );

      expect(result).to.be.an("object");
      expect(result).to.have.property("name");
      expect(result).to.have.property("symbol");
      expect(result).to.have.property("decimals");
    });
  });

  describe("fetchTokenPrice", () => {
    it("should fetch token price from contract", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const systemTokenAddress = "0x4200000000000000000000000000000000000006";
      const wethAddress = "0x4200000000000000000000000000000000000006";
      const connectors = ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"];
      const chainId = 10;
      const blockNumber = 12345;
      const gasLimit = 1000000n;

      const result = await fetchTokenPrice(
        tokenAddress,
        usdcAddress,
        systemTokenAddress,
        wethAddress,
        connectors,
        chainId,
        blockNumber,
        mockEthClient,
        mockContext.log,
        gasLimit,
      );

      expect(result).to.be.an("object");
      expect(result).to.have.property("pricePerUSDNew");
      expect(result).to.have.property("priceOracleType");
    });
  });
});
