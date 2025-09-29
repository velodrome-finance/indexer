import { expect } from "chai";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import sinon from "sinon";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS } from "../../src/Constants";
import {
  fetchCurrentAccumulatedFeeCL,
  fetchCurrentFee,
  fetchDynamicFeeConfig,
  getCurrentAccumulatedFeeCL,
  getCurrentFee,
  getDynamicFeeConfig,
} from "../../src/Effects/DynamicFee";

describe("Dynamic Fee Effects", () => {
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
        result: [
          "0x0000000000000000000000000000000000000000000000000000000000000190",
          "0x00000000000000000000000000000000000000000000000000000000000007d0",
          "0x0000000000000000000000000000000000000000000000000000000000989680",
        ],
      }),
    };

    // Mock CHAIN_CONSTANTS by directly setting the property
    (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[10] = {
      eth_client: mockEthClient,
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
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("getDynamicFeeConfig", () => {
    it("should be a valid effect object", () => {
      expect(getDynamicFeeConfig).to.be.an("object");
      expect(getDynamicFeeConfig).to.have.property(
        "name",
        "getDynamicFeeConfig",
      );
    });
  });

  describe("getCurrentFee", () => {
    it("should be a valid effect object", () => {
      expect(getCurrentFee).to.be.an("object");
      expect(getCurrentFee).to.have.property("name", "getCurrentFee");
    });
  });

  describe("getCurrentAccumulatedFeeCL", () => {
    it("should be a valid effect object", () => {
      expect(getCurrentAccumulatedFeeCL).to.be.an("object");
      expect(getCurrentAccumulatedFeeCL).to.have.property(
        "name",
        "getCurrentAccumulatedFeeCL",
      );
    });
  });

  describe("fetchDynamicFeeConfig", () => {
    it("should fetch dynamic fee config from contract", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 12345;

      const result = await fetchDynamicFeeConfig(
        poolAddress,
        chainId,
        blockNumber,
        mockEthClient,
        mockContext.log,
      );

      expect(result).to.be.an("object");
      expect(result).to.have.property("baseFee");
      expect(result).to.have.property("feeCap");
      expect(result).to.have.property("scalingFactor");
    });
  });

  describe("fetchCurrentFee", () => {
    it("should fetch current fee from contract", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 12345;

      const result = await fetchCurrentFee(
        poolAddress,
        chainId,
        blockNumber,
        mockEthClient,
        mockContext.log,
      );

      expect(result).to.be.an("array");
      expect(result).to.have.length(3);
    });
  });

  describe("fetchCurrentAccumulatedFeeCL", () => {
    it("should fetch accumulated fee for CL pool from contract", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 12345;

      const result = await fetchCurrentAccumulatedFeeCL(
        poolAddress,
        chainId,
        blockNumber,
        mockEthClient,
        mockContext.log,
      );

      expect(result).to.be.an("object");
      expect(result).to.have.property("token0Fees");
      expect(result).to.have.property("token1Fees");
    });
  });
});
