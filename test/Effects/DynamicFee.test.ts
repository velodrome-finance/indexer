import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, toChecksumAddress } from "../../src/Constants";
import { fetchCurrentFee, getCurrentFee } from "../../src/Effects/DynamicFee";

// Common test constants
const TEST_CHAIN_ID = 10;
const TEST_BLOCK_NUMBER = 12345;
const TEST_POOL_ADDRESS = toChecksumAddress(
  "0x1234567890123456789012345678901234567890",
);
const TEST_DYNAMIC_FEE_MODULE = TEST_POOL_ADDRESS;
const TEST_FEE_VALUE = 500n;
const TEST_FEE_VALUE_ALT = 600n;

// Chain configurations for dynamic fee module addresses
const CHAIN_CONFIGS = [
  {
    chainId: 10,
    address: toChecksumAddress("0xd9eE4FBeE92970509ec795062cA759F8B52d6720"),
    name: "Optimism",
  },
  {
    chainId: 8453,
    address: toChecksumAddress("0xDB45818A6db280ecfeB33cbeBd445423d0216b5D"),
    name: "Base",
  },
  {
    chainId: 42220,
    address: toChecksumAddress("0xbcAE2d4b4E8E34a4100e69E9C73af8214a89572e"),
    name: "Celo",
  },
  {
    chainId: 1868,
    address: toChecksumAddress("0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F"),
    name: "Soneium",
  },
  {
    chainId: 34443,
    address: toChecksumAddress("0x479Bec910d4025b4aC440ec27aCf28eac522242B"),
    name: "Mode",
  },
  {
    chainId: 1135,
    address: toChecksumAddress("0xCB885Aa008031cBDb72447Bed78AF4f87a197126"),
    name: "Lisk",
  },
  {
    chainId: 130,
    address: toChecksumAddress("0x6812eefC19deB79D5191b52f4B763260d9F3C238"),
    name: "Unichain",
  },
  {
    chainId: 252,
    address: toChecksumAddress("0xB0922e747e906B963dBdA37647DE1Aa709B35B2d"),
    name: "Fraxtal",
  },
  {
    chainId: 1750,
    address: toChecksumAddress("0x6812eefC19deB79D5191b52f4B763260d9F3C238"),
    name: "Metal",
  },
  {
    chainId: 1923,
    address: toChecksumAddress("0x6812eefC19deB79D5191b52f4B763260d9F3C238"),
    name: "Swell2",
  },
  {
    chainId: 57073,
    address: toChecksumAddress("0x6812eefC19deB79D5191b52f4B763260d9F3C238"),
    name: "Ink",
  },
];

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

  beforeEach(() => {
    mockEthClient = {
      simulateContract: vi.fn().mockResolvedValue({
        result: [
          "0x0000000000000000000000000000000000000000000000000000000000000190",
          "0x00000000000000000000000000000000000000000000000000000000000007d0",
          "0x0000000000000000000000000000000000000000000000000000000000989680",
        ],
      }),
    } as unknown as PublicClient;

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
    vi.restoreAllMocks();
  });

  describe("getCurrentFee", () => {
    it("should be a valid effect object", () => {
      expect(typeof getCurrentFee).toBe("object");
      expect(getCurrentFee).toHaveProperty("name", "getCurrentFee");
    });

    it("should return undefined on error", async () => {
      vi.mocked(mockEthClient.simulateContract).mockRejectedValue(
        new Error("Contract call failed"),
      );

      const result = await mockContext.effect(
        getCurrentFee as unknown as {
          name: string;
          handler: (args: { input: unknown; context: unknown }) => unknown;
        },
        {
          poolAddress: TEST_POOL_ADDRESS,
          dynamicFeeModuleAddress: TEST_DYNAMIC_FEE_MODULE,
          chainId: TEST_CHAIN_ID,
          blockNumber: TEST_BLOCK_NUMBER,
        },
      );

      expect(result).toBeUndefined();
      expect(mockContext.log.error).toHaveBeenCalled();
    });

    it("should return fee value on success", async () => {
      vi.mocked(mockEthClient.simulateContract).mockResolvedValue({
        result: TEST_FEE_VALUE,
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await mockContext.effect(
        getCurrentFee as unknown as {
          name: string;
          handler: (args: { input: unknown; context: unknown }) => unknown;
        },
        {
          poolAddress: TEST_POOL_ADDRESS,
          dynamicFeeModuleAddress: TEST_DYNAMIC_FEE_MODULE,
          chainId: TEST_CHAIN_ID,
          blockNumber: TEST_BLOCK_NUMBER,
        },
      );

      expect(result).toBe(TEST_FEE_VALUE);
      expect(mockContext.log.error).not.toHaveBeenCalled();
    });
  });

  describe("fetchCurrentFee", () => {
    it.each(CHAIN_CONFIGS)(
      "should fetch current fee for $name (chainId $chainId)",
      async ({ chainId, address }) => {
        (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
          chainId
        ] = {
          eth_client: mockEthClient,
        };

        vi.mocked(mockEthClient.simulateContract).mockClear();
        vi.mocked(mockEthClient.simulateContract).mockResolvedValue({
          result: TEST_FEE_VALUE_ALT,
          // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        } as any);

        const result = await fetchCurrentFee(
          TEST_POOL_ADDRESS,
          address,
          chainId,
          TEST_BLOCK_NUMBER,
          mockEthClient,
          mockContext.log,
        );

        expect(result).toBe(TEST_FEE_VALUE_ALT);
        expect(mockEthClient.simulateContract).toHaveBeenCalledTimes(1);
        const callArgs = vi.mocked(mockEthClient.simulateContract).mock
          .calls[0][0];
        expect(callArgs.address.toLowerCase()).toBe(address.toLowerCase());
        expect(callArgs.functionName).toBe("getFee");
        expect(callArgs.blockNumber).toBe(BigInt(TEST_BLOCK_NUMBER));
        expect(callArgs.args).toEqual([TEST_POOL_ADDRESS]);
      },
    );

    it("should handle contract call errors", async () => {
      vi.mocked(mockEthClient.simulateContract).mockRejectedValue(
        new Error("Contract call failed"),
      );

      await expect(
        fetchCurrentFee(
          TEST_POOL_ADDRESS,
          TEST_DYNAMIC_FEE_MODULE,
          TEST_CHAIN_ID,
          TEST_BLOCK_NUMBER,
          mockEthClient,
          mockContext.log,
        ),
      ).rejects.toThrow("Contract call failed");
    });

    it("should convert non-bigint result to bigint", async () => {
      vi.mocked(mockEthClient.simulateContract).mockResolvedValue({
        result: "500",
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await fetchCurrentFee(
        TEST_POOL_ADDRESS,
        TEST_DYNAMIC_FEE_MODULE,
        TEST_CHAIN_ID,
        TEST_BLOCK_NUMBER,
        mockEthClient,
        mockContext.log,
      );

      expect(result).toBe(500n);
    });
  });
});
