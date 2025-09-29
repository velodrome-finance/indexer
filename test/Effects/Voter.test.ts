import { expect } from "chai";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import sinon from "sinon";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS } from "../../src/Constants";
import {
  fetchIsAlive,
  fetchTokensDeposited,
  getIsAlive,
  getTokensDeposited,
} from "../../src/Effects/Voter";

describe("Voter Effects", () => {
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
        result:
          "0x0000000000000000000000000000000000000000000000000000000000000000",
      }),
    } as unknown as PublicClient;

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
        debug: sinon.stub(),
      } as unknown as Envio_logger,
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("getTokensDeposited", () => {
    it("should be a valid effect object", () => {
      expect(getTokensDeposited).to.be.an("object");
      expect(getTokensDeposited).to.have.property("name", "getTokensDeposited");
    });
  });

  describe("getIsAlive", () => {
    it("should be a valid effect object", () => {
      expect(getIsAlive).to.be.an("object");
      expect(getIsAlive).to.have.property("name", "getIsAlive");
    });
  });

  describe("fetchTokensDeposited", () => {
    it("should fetch tokens deposited from contract", async () => {
      const rewardTokenAddress = "0x1234567890123456789012345678901234567890";
      const gaugeAddress = "0x0987654321098765432109876543210987654321";
      const blockNumber = 12345;
      const eventChainId = 10;

      const result = await fetchTokensDeposited(
        rewardTokenAddress,
        gaugeAddress,
        blockNumber,
        eventChainId,
        mockEthClient,
        mockContext.log,
      );

      expect(result).to.be.a("bigint");
    });
  });

  describe("fetchIsAlive", () => {
    it("should fetch is alive status from contract", async () => {
      const voterAddress = "0x1234567890123456789012345678901234567890";
      const gaugeAddress = "0x0987654321098765432109876543210987654321";
      const blockNumber = 12345;
      const eventChainId = 10;

      const result = await fetchIsAlive(
        voterAddress,
        gaugeAddress,
        blockNumber,
        eventChainId,
        mockEthClient,
        mockContext.log,
      );

      expect(result).to.be.a("boolean");
    });
  });
});
