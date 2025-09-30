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

      // Mock the contract response with specific values
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.resolves({
        result: [
          400n, // baseFee
          2000n, // feeCap
          10000000n, // scalingFactor
        ],
      });

      const result = await fetchDynamicFeeConfig(
        poolAddress,
        chainId,
        blockNumber,
        mockEthClient,
        mockContext.log,
      );

      expect(result).to.be.an("object");
      expect(result).to.have.property("baseFee", 400n);
      expect(result).to.have.property("feeCap", 2000n);
      expect(result).to.have.property("scalingFactor", 10000000n);

      // Verify correct contract call
      expect(mockSimulateContract.calledOnce).to.be.true;
      const callArgs = mockSimulateContract.firstCall.args[0];
      expect(callArgs).to.deep.include({
        address: "0xd9eE4FBeE92970509ec795062cA759F8B52d6720", // DYNAMIC_FEE_MODULE_ADDRESS
        functionName: "dynamicFeeConfig",
        blockNumber: BigInt(blockNumber),
      });
      expect(callArgs.args).to.deep.equal([poolAddress]);
    });

    it("should handle contract call errors", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 12345;

      // Mock simulateContract to throw an error
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.rejects(new Error("Contract call failed"));

      try {
        await fetchDynamicFeeConfig(
          poolAddress,
          chainId,
          blockNumber,
          mockEthClient,
          mockContext.log,
        );
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal("Contract call failed");
      }

      // Verify error was logged
      expect(mockContext.log.error).to.be.a("function");
    });
  });

  describe("fetchCurrentFee", () => {
    it("should fetch current fee from contract", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 12345;

      // Mock the contract response with a specific fee value
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.resolves({
        result: 600n, // current fee
      });

      const result = await fetchCurrentFee(
        poolAddress,
        chainId,
        blockNumber,
        mockEthClient,
        mockContext.log,
      );

      expect(result).to.be.a("bigint");
      expect(result).to.equal(600n);

      // Verify correct contract call
      expect(mockSimulateContract.calledOnce).to.be.true;
      const callArgs = mockSimulateContract.firstCall.args[0];
      expect(callArgs).to.deep.include({
        address: "0xd9eE4FBeE92970509ec795062cA759F8B52d6720", // DYNAMIC_FEE_MODULE_ADDRESS
        functionName: "getFee",
        blockNumber: BigInt(blockNumber),
      });
      expect(callArgs.args).to.deep.equal([poolAddress]);
    });

    it("should handle contract call errors", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 12345;

      // Mock simulateContract to throw an error
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.rejects(new Error("Contract call failed"));

      try {
        await fetchCurrentFee(
          poolAddress,
          chainId,
          blockNumber,
          mockEthClient,
          mockContext.log,
        );
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal("Contract call failed");
      }

      // Verify error was logged
      expect(mockContext.log.error).to.be.a("function");
    });
  });

  describe("fetchCurrentAccumulatedFeeCL", () => {
    it("should fetch accumulated fee for CL pool from contract", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 12345;

      // Mock the contract response with specific fee values
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.resolves({
        result: [
          1000n, // token0Fees
          2000n, // token1Fees
        ],
      });

      const result = await fetchCurrentAccumulatedFeeCL(
        poolAddress,
        chainId,
        blockNumber,
        mockEthClient,
        mockContext.log,
      );

      expect(result).to.be.an("object");
      expect(result).to.have.property("token0Fees", 1000n);
      expect(result).to.have.property("token1Fees", 2000n);

      // Verify correct contract call
      expect(mockSimulateContract.calledOnce).to.be.true;
      const callArgs = mockSimulateContract.firstCall.args[0];
      expect(callArgs).to.deep.include({
        address: poolAddress,
        functionName: "gaugeFees",
        blockNumber: BigInt(blockNumber),
      });
      expect(callArgs.args).to.deep.equal([]);
    });

    it("should handle contract call errors", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 12345;

      // Mock simulateContract to throw an error
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.rejects(new Error("Contract call failed"));

      try {
        await fetchCurrentAccumulatedFeeCL(
          poolAddress,
          chainId,
          blockNumber,
          mockEthClient,
          mockContext.log,
        );
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal("Contract call failed");
      }

      // Verify error was logged
      expect(mockContext.log.error).to.be.a("function");
    });
  });
});
