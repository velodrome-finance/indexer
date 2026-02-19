import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, toChecksumAddress } from "../../src/Constants";
import {
  fetchIsAlive,
  fetchTokensDeposited,
  getIsAlive,
  getTokensDeposited,
} from "../../src/Effects/Voter";

// Common test constants
const TEST_CHAIN_ID = 10;
const TEST_BLOCK_NUMBER = 12345;
const TEST_REWARD_TOKEN = toChecksumAddress(
  "0x1234567890123456789012345678901234567890",
);
const TEST_GAUGE = toChecksumAddress(
  "0x0987654321098765432109876543210987654321",
);
const TEST_VOTER = TEST_REWARD_TOKEN;
const TEST_BALANCE_HEX =
  "0x00000000000000000000000000000000000000000000000000000000000003e8"; // 1000

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
      simulateContract: vi.fn().mockResolvedValue({
        result:
          "0x0000000000000000000000000000000000000000000000000000000000000000",
      } as unknown as { result: string }),
    } as unknown as PublicClient;

    originalChainConstants10 = CHAIN_CONSTANTS[10];
    (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
      TEST_CHAIN_ID
    ] = {
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
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      } as unknown as Envio_logger,
    };
  });

  afterEach(() => {
    if (originalChainConstants10 !== undefined) {
      CHAIN_CONSTANTS[TEST_CHAIN_ID] = originalChainConstants10;
    } else {
      (CHAIN_CONSTANTS as Record<number, unknown>)[TEST_CHAIN_ID] = undefined;
    }
    vi.restoreAllMocks();
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
      vi.mocked(mockEthClient.simulateContract).mockResolvedValue({
        result: TEST_BALANCE_HEX,
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await fetchTokensDeposited(
        TEST_REWARD_TOKEN,
        TEST_GAUGE,
        TEST_BLOCK_NUMBER,
        TEST_CHAIN_ID,
        mockEthClient,
        mockContext.log,
      );

      expect(result).toBe(1000n);
      expect(mockEthClient.simulateContract).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(mockEthClient.simulateContract).mock
        .calls[0][0];
      expect(callArgs).toMatchObject({
        address: TEST_REWARD_TOKEN,
        functionName: "balanceOf",
        blockNumber: BigInt(TEST_BLOCK_NUMBER),
      });
      expect(callArgs.args).toEqual([TEST_GAUGE]);
    });

    it("should throw error on contract call failure", async () => {
      vi.mocked(mockEthClient.simulateContract).mockRejectedValue(
        new Error("Contract call failed"),
      );

      await expect(
        fetchTokensDeposited(
          TEST_REWARD_TOKEN,
          TEST_GAUGE,
          TEST_BLOCK_NUMBER,
          TEST_CHAIN_ID,
          mockEthClient,
          mockContext.log,
        ),
      ).rejects.toThrow("Contract call failed");
    });

    it("should handle undefined/null results", async () => {
      vi.mocked(mockEthClient.simulateContract).mockResolvedValue({
        result: undefined,
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await fetchTokensDeposited(
        TEST_REWARD_TOKEN,
        TEST_GAUGE,
        TEST_BLOCK_NUMBER,
        TEST_CHAIN_ID,
        mockEthClient,
        mockContext.log,
      );

      expect(result).toBe(0n);
    });
  });

  describe("fetchIsAlive", () => {
    it("should fetch is alive status from contract", async () => {
      const testCases = [
        { result: true, expected: true, description: "gauge is alive" },
        { result: false, expected: false, description: "gauge is not alive" },
        { result: 0, expected: false, description: "falsy value" },
      ];

      for (const { result, expected } of testCases) {
        vi.mocked(mockEthClient.simulateContract).mockResolvedValue({
          result,
          // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        } as any);

        const fetchResult = await fetchIsAlive(
          TEST_VOTER,
          TEST_GAUGE,
          TEST_BLOCK_NUMBER,
          TEST_CHAIN_ID,
          mockEthClient,
          mockContext.log,
        );

        expect(fetchResult).toBe(expected);
        const callArgs = vi.mocked(mockEthClient.simulateContract).mock
          .calls[0][0];
        expect(callArgs).toMatchObject({
          address: TEST_VOTER,
          functionName: "isAlive",
          blockNumber: BigInt(TEST_BLOCK_NUMBER),
        });
        expect(callArgs.args).toEqual([TEST_GAUGE]);
        vi.mocked(mockEthClient.simulateContract).mockClear();
      }
    });

    it("should throw error on contract call failure", async () => {
      vi.mocked(mockEthClient.simulateContract).mockRejectedValue(
        new Error("Contract call failed"),
      );

      await expect(
        fetchIsAlive(
          TEST_VOTER,
          TEST_GAUGE,
          TEST_BLOCK_NUMBER,
          TEST_CHAIN_ID,
          mockEthClient,
          mockContext.log,
        ),
      ).rejects.toThrow("Contract call failed");
    });
  });

  describe("getTokensDeposited", () => {
    it("should return undefined on error", async () => {
      vi.mocked(mockEthClient.simulateContract).mockRejectedValue(
        new Error("Contract call failed"),
      );

      const result = await mockContext.effect(
        getTokensDeposited as unknown as {
          name: string;
          handler: (args: { input: unknown; context: unknown }) => unknown;
        },
        {
          rewardTokenAddress: TEST_REWARD_TOKEN,
          gaugeAddress: TEST_GAUGE,
          blockNumber: TEST_BLOCK_NUMBER,
          eventChainId: TEST_CHAIN_ID,
        },
      );

      expect(result).toBeUndefined();
      expect(mockContext.log.error).toHaveBeenCalled();
    });
  });

  describe("getIsAlive", () => {
    it("should return undefined on error", async () => {
      vi.mocked(mockEthClient.simulateContract).mockRejectedValue(
        new Error("Contract call failed"),
      );

      const result = await mockContext.effect(
        getIsAlive as unknown as {
          name: string;
          handler: (args: { input: unknown; context: unknown }) => unknown;
        },
        {
          voterAddress: TEST_VOTER,
          gaugeAddress: TEST_GAUGE,
          blockNumber: TEST_BLOCK_NUMBER,
          eventChainId: TEST_CHAIN_ID,
        },
      );

      expect(result).toBeUndefined();
      expect(mockContext.log.error).toHaveBeenCalled();
    });
  });
});
