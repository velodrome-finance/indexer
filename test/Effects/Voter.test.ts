import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, toChecksumAddress } from "../../src/Constants";
import * as HelpersModule from "../../src/Effects/Helpers";
import {
  fetchTokensDeposited,
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
    vi.spyOn(HelpersModule, "sleep").mockResolvedValue(undefined);

    mockEthClient = {
      readContract: vi
        .fn()
        .mockResolvedValue(
          "0x0000000000000000000000000000000000000000000000000000000000000000",
        ),
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

  describe("fetchTokensDeposited", () => {
    it("should fetch tokens deposited from contract", async () => {
      vi.mocked(mockEthClient.readContract).mockResolvedValue(
        TEST_BALANCE_HEX as unknown as bigint,
      );

      const result = await fetchTokensDeposited(
        TEST_REWARD_TOKEN,
        TEST_GAUGE,
        TEST_BLOCK_NUMBER,
        mockEthClient,
      );

      expect(result).toBe(1000n);
      expect(mockEthClient.readContract).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(mockEthClient.readContract).mock.calls[0][0];
      expect(callArgs).toMatchObject({
        address: TEST_REWARD_TOKEN,
        functionName: "balanceOf",
        blockNumber: BigInt(TEST_BLOCK_NUMBER),
      });
      expect(callArgs.args).toEqual([TEST_GAUGE]);
    });

    it("should throw error on contract call failure", async () => {
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("Contract call failed"),
      );

      await expect(
        fetchTokensDeposited(
          TEST_REWARD_TOKEN,
          TEST_GAUGE,
          TEST_BLOCK_NUMBER,
          mockEthClient,
        ),
      ).rejects.toThrow("Contract call failed");
    });

    it("should handle undefined/null results", async () => {
      vi.mocked(mockEthClient.readContract).mockResolvedValue(
        undefined as unknown as bigint,
      );

      const result = await fetchTokensDeposited(
        TEST_REWARD_TOKEN,
        TEST_GAUGE,
        TEST_BLOCK_NUMBER,
        mockEthClient,
      );

      expect(result).toBe(0n);
    });
  });

  describe("getTokensDeposited", () => {
    it("should be a valid effect object", () => {
      expect(typeof getTokensDeposited).toBe("object");
      expect(getTokensDeposited).toHaveProperty("name", "getTokensDeposited");
    });

    it("should return undefined when rpcGateway returns no value (unit: delegation in isolation)", async () => {
      const unitContext = {
        ...mockContext,
        effect: (
          effect: {
            name: string;
            handler: (args: { input: unknown; context: unknown }) => unknown;
          },
          input: unknown,
        ) => {
          if (effect.name === "rpcGateway") {
            (
              unitContext.log as { error: (msg: string, err: Error) => void }
            ).error(
              "rpcGateway.getTokensDeposited failed",
              new Error("Simulated gateway error"),
            );
            // Gateway returns payload shape with value undefined (simulated error)
            return Promise.resolve({ value: undefined });
          }
          return effect.handler({ input, context: unitContext });
        },
      };

      const result = await unitContext.effect(
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
      expect(unitContext.log.error).toHaveBeenCalledWith(
        "rpcGateway.getTokensDeposited failed",
        expect.any(Error),
      );
    });

    it("should return undefined and log error when RPC fails (integration: full chain)", async () => {
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
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
});
