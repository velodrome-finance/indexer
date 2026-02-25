import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, toChecksumAddress } from "../../src/Constants";
import * as HelpersModule from "../../src/Effects/Helpers";
import { fetchSwapFee, getSwapFee } from "../../src/Effects/SwapFee";

type MockEffect = {
  name: string;
  handler: (args: { input: unknown; context: unknown }) => unknown;
};

// Common test constants
const TEST_CHAIN_ID = 10;
const TEST_BLOCK_NUMBER = 12345;
const TEST_POOL_ADDRESS = toChecksumAddress(
  "0x1234567890123456789012345678901234567890",
);
const TEST_CL_FACTORY_ADDRESS = TEST_POOL_ADDRESS;
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

describe("Swap Fee Effects", () => {
  let mockContext: {
    effect: (effect: MockEffect, input: unknown) => unknown;
    ethClient: PublicClient;
    log: Envio_logger;
  };
  let mockEthClient: PublicClient;
  let originalChainEntry:
    | (typeof CHAIN_CONSTANTS)[typeof TEST_CHAIN_ID]
    | undefined;

  beforeEach(() => {
    vi.spyOn(HelpersModule, "sleep").mockResolvedValue(undefined);

    mockEthClient = {
      readContract: vi.fn().mockResolvedValue(TEST_FEE_VALUE),
    } as unknown as PublicClient;

    originalChainEntry = CHAIN_CONSTANTS[TEST_CHAIN_ID];
    (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
      TEST_CHAIN_ID
    ] = {
      eth_client: mockEthClient,
    };

    mockContext = {
      effect: (effect: MockEffect, input: unknown) =>
        effect.handler({ input, context: mockContext }),
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
    if (originalChainEntry !== undefined) {
      CHAIN_CONSTANTS[TEST_CHAIN_ID] = originalChainEntry;
    } else {
      delete (CHAIN_CONSTANTS as Record<number, unknown>)[TEST_CHAIN_ID];
    }
    vi.restoreAllMocks();
  });

  describe("getSwapFee", () => {
    it("should be a valid effect object", () => {
      expect(typeof getSwapFee).toBe("object");
      expect(getSwapFee).toHaveProperty("name", "getSwapFee");
    });

    it("should return undefined on error", async () => {
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("Contract call failed"),
      );

      const result = await mockContext.effect(
        getSwapFee as unknown as MockEffect,
        {
          poolAddress: TEST_POOL_ADDRESS,
          factoryAddress: TEST_CL_FACTORY_ADDRESS,
          chainId: TEST_CHAIN_ID,
          blockNumber: TEST_BLOCK_NUMBER,
        },
      );

      expect(result).toBeUndefined();
      expect(mockContext.log.error).toHaveBeenCalled();
    });

    it("should return fee value on success", async () => {
      vi.mocked(mockEthClient.readContract).mockResolvedValue(TEST_FEE_VALUE);

      const result = await mockContext.effect(
        getSwapFee as unknown as MockEffect,
        {
          poolAddress: TEST_POOL_ADDRESS,
          factoryAddress: TEST_CL_FACTORY_ADDRESS,
          chainId: TEST_CHAIN_ID,
          blockNumber: TEST_BLOCK_NUMBER,
        },
      );

      expect(result).toBe(TEST_FEE_VALUE);
      expect(mockContext.log.error).not.toHaveBeenCalled();
    });
  });

  describe("fetchSwapFee", () => {
    it.each(CHAIN_CONFIGS)(
      "should fetch current fee for $name (chainId $chainId)",
      async ({ chainId, address }) => {
        const originalChainEntryForChain = (
          CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>
        )[chainId];
        (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
          chainId
        ] = {
          eth_client: mockEthClient,
        };
        try {
          vi.mocked(mockEthClient.readContract).mockClear();
          vi.mocked(mockEthClient.readContract).mockResolvedValue(
            TEST_FEE_VALUE_ALT,
          );

          const result = await fetchSwapFee(
            TEST_POOL_ADDRESS,
            address,
            TEST_BLOCK_NUMBER,
            mockEthClient,
          );

          expect(result).toBe(TEST_FEE_VALUE_ALT);
          expect(mockEthClient.readContract).toHaveBeenCalledTimes(1);
          const callArgs = vi.mocked(mockEthClient.readContract).mock
            .calls[0][0];
          expect(callArgs?.address?.toLowerCase()).toBe(address.toLowerCase());
          expect(callArgs.functionName).toBe("getSwapFee");
          expect(callArgs.blockNumber).toBe(BigInt(TEST_BLOCK_NUMBER));
          expect(callArgs.args).toEqual([TEST_POOL_ADDRESS]);
        } finally {
          if (originalChainEntryForChain !== undefined) {
            (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
              chainId
            ] = originalChainEntryForChain;
          } else {
            delete (CHAIN_CONSTANTS as Record<number, unknown>)[chainId];
          }
        }
      },
    );

    it("should handle contract call errors", async () => {
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("Contract call failed"),
      );

      await expect(
        fetchSwapFee(
          TEST_POOL_ADDRESS,
          TEST_CL_FACTORY_ADDRESS,
          TEST_BLOCK_NUMBER,
          mockEthClient,
        ),
      ).rejects.toThrow("Contract call failed");
    });

    it("should convert non-bigint result to bigint", async () => {
      vi.mocked(mockEthClient.readContract).mockResolvedValue("500");

      const result = await fetchSwapFee(
        TEST_POOL_ADDRESS,
        TEST_CL_FACTORY_ADDRESS,
        TEST_BLOCK_NUMBER,
        mockEthClient,
      );

      expect(result).toBe(500n);
    });
  });
});
