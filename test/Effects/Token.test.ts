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
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
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

      // Mock different responses for each contract call
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract
        .onFirstCall()
        .resolves({ result: "Test Token" })
        .onSecondCall()
        .resolves({ result: 18 })
        .onThirdCall()
        .resolves({ result: "TEST" });

      const result = await fetchTokenDetails(
        tokenAddress,
        chainId,
        mockEthClient,
        mockContext.log,
      );

      expect(result).to.be.an("object");
      expect(result).to.have.property("name", "Test Token");
      expect(result).to.have.property("symbol", "TEST");
      expect(result).to.have.property("decimals", 18);

      // Verify that simulateContract was called 3 times with correct parameters
      expect(mockSimulateContract.callCount).to.equal(3);
      expect(mockSimulateContract.firstCall.args[0]).to.deep.include({
        address: tokenAddress,
        functionName: "name",
      });
      expect(mockSimulateContract.secondCall.args[0]).to.deep.include({
        address: tokenAddress,
        functionName: "decimals",
      });
      expect(mockSimulateContract.thirdCall.args[0]).to.deep.include({
        address: tokenAddress,
        functionName: "symbol",
      });
    });

    it("should handle contract call errors gracefully", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;

      // Mock simulateContract to throw an error
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.rejects(new Error("Contract call failed"));

      const result = await fetchTokenDetails(
        tokenAddress,
        chainId,
        mockEthClient,
        mockContext.log,
      );

      // Should return default values on error
      expect(result).to.be.an("object");
      expect(result).to.have.property("name", "");
      expect(result).to.have.property("symbol", "");
      expect(result).to.have.property("decimals", 0);

      // Verify error was logged
      expect(mockContext.log.error).to.be.a("function");
    });

    it("should handle undefined/null results", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;

      // Mock simulateContract to return undefined results
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract
        .onFirstCall()
        .resolves({ result: undefined })
        .onSecondCall()
        .resolves({ result: null })
        .onThirdCall()
        .resolves({ result: undefined });

      const result = await fetchTokenDetails(
        tokenAddress,
        chainId,
        mockEthClient,
        mockContext.log,
      );

      expect(result).to.be.an("object");
      expect(result).to.have.property("name", "");
      expect(result).to.have.property("symbol", "");
      expect(result).to.have.property("decimals", 0);
    });
  });

  describe("fetchTokenPrice", () => {
    it("should fetch token price from V3 oracle", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const systemTokenAddress = "0x4200000000000000000000000000000000000006";
      const wethAddress = "0x4200000000000000000000000000000000000006";
      const connectors = ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"];
      const chainId = 10;
      const blockNumber = 12345;
      const gasLimit = 1000000n;

      // Ensure V3 oracle is set up correctly
      (CHAIN_CONSTANTS as Record<number, unknown>)[10] = {
        eth_client: mockEthClient,
        oracle: {
          getType: () => "v3",
          getAddress: () => "0x1234567890123456789012345678901234567890",
          getPrice: sinon.stub(),
        },
      };

      // Mock V3 oracle response
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.resolves({
        result: [
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ], // 1 in hex
      });

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
      expect(result).to.have.property("pricePerUSDNew", 1n);
      expect(result).to.have.property("priceOracleType", "v3");

      // Verify correct contract call
      expect(mockSimulateContract.calledOnce).to.be.true;
      const callArgs = mockSimulateContract.firstCall.args[0];
      expect(callArgs).to.deep.include({
        functionName: "getManyRatesWithCustomConnectors",
        gas: gasLimit,
        blockNumber: BigInt(blockNumber),
      });
      expect(callArgs.args).to.deep.equal([
        [tokenAddress],
        usdcAddress,
        false,
        [...connectors, systemTokenAddress, wethAddress, usdcAddress],
        10,
      ]);
    });

    it("should fetch token price from V2 oracle", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const systemTokenAddress = "0x4200000000000000000000000000000000000006";
      const wethAddress = "0x4200000000000000000000000000000000000006";
      const connectors = ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"];
      const chainId = 10;
      const blockNumber = 12345;
      const gasLimit = 1000000n;

      // Mock V2 oracle by changing the oracle type
      (CHAIN_CONSTANTS as Record<number, unknown>)[10] = {
        eth_client: mockEthClient,
        oracle: {
          getType: () => "V2",
          getAddress: () => "0x1234567890123456789012345678901234567890",
          getPrice: sinon.stub(),
        },
      };

      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.resolves({
        result: [
          "0x0000000000000000000000000000000000000000000000000000000000000002",
        ], // 2 in hex
      });

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
      expect(result).to.have.property("pricePerUSDNew", 2n);
      expect(result).to.have.property("priceOracleType", "v2");

      // Verify correct contract call
      expect(mockSimulateContract.calledOnce).to.be.true;
      const callArgs = mockSimulateContract.firstCall.args[0];
      expect(callArgs).to.deep.include({
        functionName: "getManyRatesWithConnectors",
        gas: gasLimit,
        blockNumber: BigInt(blockNumber),
      });
      expect(callArgs.args).to.deep.equal([
        1,
        [
          tokenAddress,
          ...connectors,
          systemTokenAddress,
          wethAddress,
          usdcAddress,
        ],
      ]);
    });

    it("should handle contract call errors gracefully", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const systemTokenAddress = "0x4200000000000000000000000000000000000006";
      const wethAddress = "0x4200000000000000000000000000000000000006";
      const connectors = ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"];
      const chainId = 10;
      const blockNumber = 12345;
      const gasLimit = 1000000n;

      // Mock simulateContract to throw an error
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.rejects(new Error("Oracle call failed"));

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

      // Should return zero price on error
      expect(result).to.be.an("object");
      expect(result).to.have.property("pricePerUSDNew", 0n);
      expect(result).to.have.property("priceOracleType", "v2");

      // Verify error was logged
      expect(mockContext.log.error).to.be.a("function");
    });

    it("should retry on out of gas errors with increased gas limit", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const systemTokenAddress = "0x4200000000000000000000000000000000000006";
      const wethAddress = "0x4200000000000000000000000000000000000006";
      const connectors: string[] = [];
      const chainId = 10;
      const blockNumber = 12345;
      const gasLimit = 1000000n;

      (CHAIN_CONSTANTS as Record<number, unknown>)[10] = {
        eth_client: mockEthClient,
        oracle: {
          getType: () => "V2",
          getAddress: () => "0x1234567890123456789012345678901234567890",
          getPrice: sinon.stub(),
        },
      };

      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      // First call fails with out of gas, second succeeds
      mockSimulateContract
        .onFirstCall()
        .rejects(new Error("out of gas: gas required exceeds: 1000000"))
        .onSecondCall()
        .resolves({
          result: [
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          ],
        });

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
        7, // maxRetries
      );

      expect(result.pricePerUSDNew).to.equal(1n);
      expect(mockSimulateContract.callCount).to.equal(2);
      // Verify second call used increased gas limit
      const secondCall = mockSimulateContract.secondCall.args[0];
      expect(secondCall.gas).to.equal(2000000n); // Doubled from 1M
    });

    it("should retry on rate limit errors with exponential backoff", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const systemTokenAddress = "0x4200000000000000000000000000000000000006";
      const wethAddress = "0x4200000000000000000000000000000000000006";
      const connectors: string[] = [];
      const chainId = 10;
      const blockNumber = 12345;
      const gasLimit = 1000000n;

      (CHAIN_CONSTANTS as Record<number, unknown>)[10] = {
        eth_client: mockEthClient,
        oracle: {
          getType: () => "V2",
          getAddress: () => "0x1234567890123456789012345678901234567890",
          getPrice: sinon.stub(),
        },
      };

      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      // First call fails with rate limit, second succeeds
      mockSimulateContract
        .onFirstCall()
        .rejects(new Error("rate limit exceeded"))
        .onSecondCall()
        .resolves({
          result: [
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          ],
        });

      const startTime = Date.now();
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
        7, // maxRetries
      );
      const endTime = Date.now();

      expect(result.pricePerUSDNew).to.equal(1n);
      expect(mockSimulateContract.callCount).to.equal(2);
      // Verify there was a delay (at least 900ms for first retry with 1s delay)
      expect(endTime - startTime).to.be.at.least(900);
    });

    it("should handle contract revert errors without retries", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const systemTokenAddress = "0x4200000000000000000000000000000000000006";
      const wethAddress = "0x4200000000000000000000000000000000000006";
      const connectors: string[] = [];
      const chainId = 10;
      const blockNumber = 12345;
      const gasLimit = 1000000n;

      (CHAIN_CONSTANTS as Record<number, unknown>)[10] = {
        eth_client: mockEthClient,
        oracle: {
          getType: () => "V2",
          getAddress: () => "0x1234567890123456789012345678901234567890",
          getPrice: sinon.stub(),
        },
      };

      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.rejects(new Error("execution reverted"));

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
        7, // maxRetries
      );

      // Should return zero price without retries
      expect(result.pricePerUSDNew).to.equal(0n);
      expect(mockSimulateContract.callCount).to.equal(1); // No retries
    });
  });
});
