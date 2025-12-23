import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, PriceOracleType } from "../../src/Constants";
import {
  fetchTokenDetails,
  fetchTokenPrice,
  fetchTotalSupply,
  getTokenDetails,
  getTokenPrice,
  getTotalSupply,
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
    cache?: boolean;
  };
  let mockEthClient: PublicClient;

  beforeEach(() => {
    mockEthClient = {
      simulateContract: jest.fn().mockResolvedValue({
        result: "Test Token",
      }),
    } as unknown as PublicClient;

    // Mock CHAIN_CONSTANTS by directly setting the property
    (CHAIN_CONSTANTS as Record<number, unknown>)[10] = {
      eth_client: mockEthClient,
      oracle: {
        getType: () => PriceOracleType.V3, // Returns "v3" (lowercase)
        getAddress: () => "0x1234567890123456789012345678901234567890",
        getPrice: jest.fn(),
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
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      } as unknown as Envio_logger,
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getTokenDetails", () => {
    it("should be a valid effect object", () => {
      expect(typeof getTokenDetails).toBe("object");
      expect(getTokenDetails).toHaveProperty("name", "getTokenDetails");
    });
  });

  describe("getTokenPrice", () => {
    it("should be a valid effect object", () => {
      expect(typeof getTokenPrice).toBe("object");
      expect(getTokenPrice).toHaveProperty("name", "getTokenPrice");
    });
  });

  describe("getTotalSupply", () => {
    it("should be a valid effect object", () => {
      expect(typeof getTotalSupply).toBe("object");
      expect(getTotalSupply).toHaveProperty("name", "getTotalSupply");
    });
  });

  describe("fetchTotalSupply", () => {
    it("should fetch totalSupply from contract and return bigint", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 100;

      // Mock simulateContract to return a single bigint value
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: 1000000000000000000000n, // 1000 tokens (18 decimals)
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any); // Type assertion needed: jest.mocked() infers strict viem types, but we only need { result } for testing

      const result = await fetchTotalSupply(
        tokenAddress,
        chainId,
        blockNumber,
        mockEthClient,
        mockContext.log,
      );

      expect(result).toBe(1000000000000000000000n);

      // Verify that simulateContract was called with correct parameters
      expect(mockSimulateContract).toHaveBeenCalledTimes(1);
      const callArgs = mockSimulateContract.mock.calls[0][0];
      expect(callArgs).toMatchObject({
        address: tokenAddress,
        functionName: "totalSupply",
        blockNumber: BigInt(blockNumber),
      });
      expect(callArgs.args).toEqual([]);
    });

    it("should handle array result from simulateContract", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 100;

      // Mock simulateContract to return an array (some viem versions return arrays)
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: [500000000000000000000n], // Array with single value
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any); // Type assertion needed: jest.mocked() infers strict viem types, but we only need { result } for testing

      const result = await fetchTotalSupply(
        tokenAddress,
        chainId,
        blockNumber,
        mockEthClient,
        mockContext.log,
      );

      expect(result).toBe(500000000000000000000n);
    });

    it("should handle string result and convert to bigint", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 100;

      // Mock simulateContract to return a string (some viem versions return strings)
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: "2000000000000000000000", // String representation
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any); // Type assertion needed: jest.mocked() infers strict viem types, but we only need { result } for testing

      const result = await fetchTotalSupply(
        tokenAddress,
        chainId,
        blockNumber,
        mockEthClient,
        mockContext.log,
      );

      expect(result).toBe(2000000000000000000000n);
    });

    it("should handle contract call errors and throw with context", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 100;

      // Mock simulateContract to throw an error
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockRejectedValue(new Error("Contract call failed"));

      // Set cache to true initially (should be set to false on error)
      const contextWithCache = { cache: true };

      await expect(
        fetchTotalSupply(
          tokenAddress,
          chainId,
          blockNumber,
          mockEthClient,
          mockContext.log,
          contextWithCache,
        ),
      ).rejects.toThrow(
        new RegExp(
          `(?=.*getTotalSupply effect failed)(?=.*${tokenAddress})(?=.*Contract call failed)`,
        ),
      );

      // Verify cache was disabled on error
      expect(contextWithCache.cache).toBe(false);

      // Verify error was logged
      expect(jest.mocked(mockContext.log.error)).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchTokenDetails", () => {
    it("should fetch token details from contract", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;

      // Mock different responses for each contract call
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        .mockResolvedValueOnce({ result: "Test Token" } as any)
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        .mockResolvedValueOnce({ result: 18 } as any)
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        .mockResolvedValueOnce({ result: "TEST" } as any);

      const result = await fetchTokenDetails(
        tokenAddress,
        chainId,
        mockEthClient,
        mockContext.log,
      );

      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("name", "Test Token");
      expect(result).toHaveProperty("symbol", "TEST");
      expect(result).toHaveProperty("decimals", 18);

      // Verify that simulateContract was called 3 times with correct parameters
      expect(mockSimulateContract).toHaveBeenCalledTimes(3);
      expect(mockSimulateContract.mock.calls[0][0]).toMatchObject({
        address: tokenAddress,
        functionName: "name",
      });
      expect(mockSimulateContract.mock.calls[1][0]).toMatchObject({
        address: tokenAddress,
        functionName: "decimals",
      });
      expect(mockSimulateContract.mock.calls[2][0]).toMatchObject({
        address: tokenAddress,
        functionName: "symbol",
      });
    });

    it("should handle contract call errors gracefully", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;

      // Mock simulateContract to throw an error
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockRejectedValue(new Error("Contract call failed"));

      const result = await fetchTokenDetails(
        tokenAddress,
        chainId,
        mockEthClient,
        mockContext.log,
      );

      // Should return default values on error
      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("name", "");
      expect(result).toHaveProperty("symbol", "");
      expect(result).toHaveProperty("decimals", 0);

      // Verify error was logged
      expect(jest.mocked(mockContext.log.error)).toHaveBeenCalled();
    });

    it("should handle undefined/null results", async () => {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;

      // Mock simulateContract to return undefined results
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        .mockResolvedValueOnce({ result: undefined } as any) // Type assertion needed: jest.mocked() infers strict viem types
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        .mockResolvedValueOnce({ result: null } as any) // Type assertion needed: jest.mocked() infers strict viem types
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        .mockResolvedValueOnce({ result: undefined } as any); // Type assertion needed: jest.mocked() infers strict viem types

      const result = await fetchTokenDetails(
        tokenAddress,
        chainId,
        mockEthClient,
        mockContext.log,
      );

      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("name", "");
      expect(result).toHaveProperty("symbol", "");
      expect(result).toHaveProperty("decimals", 0);
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
          getPrice: jest.fn(),
        },
      };

      // Mock V3 oracle response
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: [
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ], // 1 in hex
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any); // Type assertion needed: jest.mocked() infers strict viem types, but we only need { result } for testing

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

      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("pricePerUSDNew", 1n);
      expect(result).toHaveProperty("priceOracleType", "v3");

      // Verify correct contract call
      expect(mockSimulateContract).toHaveBeenCalledTimes(1);
      const callArgs = mockSimulateContract.mock.calls[0][0];
      expect(callArgs).toMatchObject({
        functionName: "getManyRatesWithCustomConnectors",
        gas: gasLimit,
        blockNumber: BigInt(blockNumber),
      });
      expect(callArgs.args).toEqual([
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
          getType: () => PriceOracleType.V2, // Returns "v2" (lowercase)
          getAddress: () => "0x1234567890123456789012345678901234567890",
          getPrice: jest.fn(),
        },
      };

      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: [
          "0x0000000000000000000000000000000000000000000000000000000000000002",
        ], // 2 in hex
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any); // Type assertion needed: jest.mocked() infers strict viem types, but we only need { result } for testing

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

      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("pricePerUSDNew", 2n);
      expect(result).toHaveProperty("priceOracleType", "v2");

      // Verify correct contract call
      expect(mockSimulateContract).toHaveBeenCalledTimes(1);
      const callArgs = mockSimulateContract.mock.calls[0][0];
      expect(callArgs).toMatchObject({
        functionName: "getManyRatesWithConnectors",
        gas: gasLimit,
        blockNumber: BigInt(blockNumber),
      });
      expect(callArgs.args).toEqual([
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

      // Mock V2 oracle for this test
      (CHAIN_CONSTANTS as Record<number, unknown>)[10] = {
        eth_client: mockEthClient,
        oracle: {
          getType: () => PriceOracleType.V2, // Returns "v2" (lowercase)
          getAddress: () => "0x1234567890123456789012345678901234567890",
          getPrice: jest.fn(),
        },
      };

      // Mock simulateContract to throw an error
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockRejectedValue(new Error("Oracle call failed"));

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
      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("pricePerUSDNew", 0n);
      expect(result).toHaveProperty("priceOracleType", "v2");

      // Verify error was logged
      expect(jest.mocked(mockContext.log.error)).toHaveBeenCalled();
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
          getType: () => PriceOracleType.V2, // Returns "v2" (lowercase)
          getAddress: () => "0x1234567890123456789012345678901234567890",
          getPrice: jest.fn(),
        },
      };

      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      // First call fails with out of gas, second succeeds
      mockSimulateContract
        .mockRejectedValueOnce(
          new Error("out of gas: gas required exceeds: 1000000"),
        )
        .mockResolvedValueOnce({
          result: [
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          ],
          // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        } as any); // Type assertion needed: jest.mocked() infers strict viem types, but we only need { result } for testing

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

      expect(result.pricePerUSDNew).toBe(1n);
      expect(mockSimulateContract).toHaveBeenCalledTimes(2);
      // Verify second call used increased gas limit
      const secondCall = mockSimulateContract.mock.calls[1][0];
      expect(secondCall.gas).toBe(2000000n); // Doubled from 1M
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
          getType: () => PriceOracleType.V2, // Returns "v2" (lowercase)
          getAddress: () => "0x1234567890123456789012345678901234567890",
          getPrice: jest.fn(),
        },
      };

      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      // First call fails with rate limit, second succeeds
      mockSimulateContract
        .mockRejectedValueOnce(new Error("rate limit exceeded"))
        .mockResolvedValueOnce({
          result: [
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          ],
          // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        } as any); // Type assertion needed: jest.mocked() infers strict viem types, but we only need { result } for testing

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

      expect(result.pricePerUSDNew).toBe(1n);
      expect(mockSimulateContract).toHaveBeenCalledTimes(2);
      // Verify there was a delay (at least 900ms for first retry with 1s delay)
      expect(endTime - startTime).toBeGreaterThanOrEqual(900);
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
          getType: () => PriceOracleType.V2, // Returns "v2" (lowercase)
          getAddress: () => "0x1234567890123456789012345678901234567890",
          getPrice: jest.fn(),
        },
      };

      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockRejectedValue(new Error("execution reverted"));

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
      expect(result.pricePerUSDNew).toBe(0n);
      expect(mockSimulateContract).toHaveBeenCalledTimes(1); // No retries
    });
  });
});
