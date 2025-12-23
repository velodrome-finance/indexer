import type { logger as Envio_logger } from "envio/src/Envio.gen";
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
  let originalChainConstants10: (typeof CHAIN_CONSTANTS)[10] | undefined;

  beforeEach(() => {
    mockEthClient = {
      simulateContract: jest.fn().mockResolvedValue({
        result:
          "0x0000000000000000000000000000000000000000000000000000000000000000",
      } as unknown as { result: string }),
    } as unknown as PublicClient;

    // Save the original value before mutating
    originalChainConstants10 = CHAIN_CONSTANTS[10];

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
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      } as unknown as Envio_logger,
    };
  });

  afterEach(() => {
    // Restore the original CHAIN_CONSTANTS[10] value
    if (originalChainConstants10 !== undefined) {
      CHAIN_CONSTANTS[10] = originalChainConstants10;
    } else {
      (CHAIN_CONSTANTS as Record<number, unknown>)[10] = undefined;
    }
    jest.restoreAllMocks();
  });

  describe("getTokensDeposited", () => {
    it("should be a valid effect object", () => {
      expect(typeof getTokensDeposited).toBe("object");
      expect(getTokensDeposited).toHaveProperty("name", "getTokensDeposited");
    });
  });

  describe("getIsAlive", () => {
    it("should be a valid effect object", () => {
      expect(typeof getIsAlive).toBe("object");
      expect(getIsAlive).toHaveProperty("name", "getIsAlive");
    });
  });

  describe("fetchTokensDeposited", () => {
    it("should fetch tokens deposited from contract", async () => {
      const mockSimulate = jest.mocked(mockEthClient.simulateContract);
      const rewardTokenAddress = "0x1234567890123456789012345678901234567890";
      const gaugeAddress = "0x0987654321098765432109876543210987654321";
      const blockNumber = 12345;
      const eventChainId = 10;

      // Mock the contract response with a specific balance
      mockSimulate.mockResolvedValue({
        result:
          "0x00000000000000000000000000000000000000000000000000000000000003e8", // 1000 in hex
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await fetchTokensDeposited(
        rewardTokenAddress,
        gaugeAddress,
        blockNumber,
        eventChainId,
        mockEthClient,
        mockContext.log,
      );

      expect(typeof result).toBe("bigint");
      expect(result).toBe(1000n);

      // Verify correct contract call
      expect(mockSimulate).toHaveBeenCalledTimes(1);
      const callArgs = mockSimulate.mock.calls[0][0];
      expect(callArgs).toMatchObject({
        address: rewardTokenAddress,
        functionName: "balanceOf",
        blockNumber: BigInt(blockNumber),
      });
      expect(callArgs.args).toEqual([gaugeAddress]);
    });

    it("should handle contract call errors gracefully", async () => {
      const mockSimulate = jest.mocked(mockEthClient.simulateContract);
      const rewardTokenAddress = "0x1234567890123456789012345678901234567890";
      const gaugeAddress = "0x0987654321098765432109876543210987654321";
      const blockNumber = 12345;
      const eventChainId = 10;

      // Mock simulateContract to throw an error
      mockSimulate.mockRejectedValue(new Error("Contract call failed"));

      const result = await fetchTokensDeposited(
        rewardTokenAddress,
        gaugeAddress,
        blockNumber,
        eventChainId,
        mockEthClient,
        mockContext.log,
      );

      // Should return 0n on error
      expect(typeof result).toBe("bigint");
      expect(result).toBe(0n);

      // Verify error was logged
      expect(jest.mocked(mockContext.log.error)).toHaveBeenCalled();
    });

    it("should handle undefined/null results", async () => {
      const mockSimulate = jest.mocked(mockEthClient.simulateContract);
      const rewardTokenAddress = "0x1234567890123456789012345678901234567890";
      const gaugeAddress = "0x0987654321098765432109876543210987654321";
      const blockNumber = 12345;
      const eventChainId = 10;

      // Mock simulateContract to return undefined result
      mockSimulate.mockResolvedValue({
        result: undefined,
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await fetchTokensDeposited(
        rewardTokenAddress,
        gaugeAddress,
        blockNumber,
        eventChainId,
        mockEthClient,
        mockContext.log,
      );

      expect(typeof result).toBe("bigint");
      expect(result).toBe(0n);
    });
  });

  describe("fetchIsAlive", () => {
    it("should fetch is alive status from contract when gauge is alive", async () => {
      const voterAddress = "0x1234567890123456789012345678901234567890";
      const gaugeAddress = "0x0987654321098765432109876543210987654321";
      const blockNumber = 12345;
      const eventChainId = 10;

      // Mock the contract response with true (gauge is alive)
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: true,
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await fetchIsAlive(
        voterAddress,
        gaugeAddress,
        blockNumber,
        eventChainId,
        mockEthClient,
        mockContext.log,
      );

      expect(typeof result).toBe("boolean");
      expect(result).toBe(true);

      // Verify correct contract call
      expect(mockSimulateContract).toHaveBeenCalledTimes(1);
      const callArgs = mockSimulateContract.mock.calls[0][0];
      expect(callArgs).toMatchObject({
        address: voterAddress,
        functionName: "isAlive",
        blockNumber: BigInt(blockNumber),
      });
      expect(callArgs.args).toEqual([gaugeAddress]);
    });

    it("should fetch is alive status from contract when gauge is not alive", async () => {
      const voterAddress = "0x1234567890123456789012345678901234567890";
      const gaugeAddress = "0x0987654321098765432109876543210987654321";
      const blockNumber = 12345;
      const eventChainId = 10;

      // Mock the contract response with false (gauge is not alive)
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: false,
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await fetchIsAlive(
        voterAddress,
        gaugeAddress,
        blockNumber,
        eventChainId,
        mockEthClient,
        mockContext.log,
      );

      expect(typeof result).toBe("boolean");
      expect(result).toBe(false);
    });

    it("should handle contract call errors gracefully", async () => {
      const voterAddress = "0x1234567890123456789012345678901234567890";
      const gaugeAddress = "0x0987654321098765432109876543210987654321";
      const blockNumber = 12345;
      const eventChainId = 10;

      // Mock simulateContract to throw an error
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockRejectedValue(new Error("Contract call failed"));

      const result = await fetchIsAlive(
        voterAddress,
        gaugeAddress,
        blockNumber,
        eventChainId,
        mockEthClient,
        mockContext.log,
      );

      // Should return false on error
      expect(typeof result).toBe("boolean");
      expect(result).toBe(false);

      // Verify error was logged
      expect(jest.mocked(mockContext.log.error)).toHaveBeenCalled();
    });

    it("should handle falsy results correctly", async () => {
      const voterAddress = "0x1234567890123456789012345678901234567890";
      const gaugeAddress = "0x0987654321098765432109876543210987654321";
      const blockNumber = 12345;
      const eventChainId = 10;

      // Mock simulateContract to return falsy values
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: 0, // falsy value
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await fetchIsAlive(
        voterAddress,
        gaugeAddress,
        blockNumber,
        eventChainId,
        mockEthClient,
        mockContext.log,
      );

      expect(typeof result).toBe("boolean");
      expect(result).toBe(false);
    });
  });
});
