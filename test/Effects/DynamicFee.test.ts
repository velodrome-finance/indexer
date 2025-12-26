import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS } from "../../src/Constants";
import { fetchCurrentFee, getCurrentFee } from "../../src/Effects/DynamicFee";

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
      simulateContract: jest.fn().mockResolvedValue({
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

  describe("getCurrentFee", () => {
    it("should be a valid effect object", () => {
      expect(typeof getCurrentFee).toBe("object");
      expect(getCurrentFee).toHaveProperty("name", "getCurrentFee");
    });
  });

  describe("fetchCurrentFee", () => {
    // Define chain IDs and their corresponding dynamic fee module addresses
    const chainConfigs = [
      {
        chainId: 10,
        address: "0xd9eE4FBeE92970509ec795062cA759F8B52d6720",
        name: "Optimism",
      },
      {
        chainId: 8453,
        address: "0xDB45818A6db280ecfeB33cbeBd445423d0216b5D",
        name: "Base",
      },
      {
        chainId: 42220,
        address: "0xbcAE2d4b4E8E34a4100e69E9C73af8214a89572e",
        name: "Celo",
      },
      {
        chainId: 1868,
        address: "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F",
        name: "Soneium",
      },
      {
        chainId: 34443,
        address: "0x479Bec910d4025b4aC440ec27aCf28eac522242B",
        name: "Mode",
      },
      {
        chainId: 1135,
        address: "0xCB885Aa008031cBDb72447Bed78AF4f87a197126",
        name: "Lisk",
      },
      {
        chainId: 130,
        address: "0x6812eefC19deB79D5191b52f4B763260d9F3C238",
        name: "Unichain",
      },
      {
        chainId: 252,
        address: "0xB0922e747e906B963dBdA37647DE1Aa709B35B2d",
        name: "Fraxtal",
      },
      {
        chainId: 1750,
        address: "0x6812eefC19deB79D5191b52f4B763260d9F3C238",
        name: "Metal",
      },
      {
        chainId: 1923,
        address: "0x6812eefC19deB79D5191b52f4B763260d9F3C238",
        name: "Swell2",
      },
      {
        chainId: 57073,
        address: "0x6812eefC19deB79D5191b52f4B763260d9F3C238",
        name: "Ink",
      },
    ];

    for (const { chainId, address, name } of chainConfigs) {
      it(`should fetch current fee for ${name} (chain ${chainId})`, async () => {
        const poolAddress = "0x1234567890123456789012345678901234567890";
        const blockNumber = 12345;

        // Mock CHAIN_CONSTANTS for this chain
        (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
          chainId
        ] = {
          eth_client: mockEthClient,
        };

        // Reset and mock the contract response with a specific fee value
        const mockSimulateContract = jest.mocked(
          mockEthClient.simulateContract,
        );
        mockSimulateContract.mockClear();
        mockSimulateContract.mockResolvedValue({
          result: 600n, // current fee
          // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        } as any);

        const result = await fetchCurrentFee(
          poolAddress,
          address, // Use the correct address for this chain
          chainId,
          blockNumber,
          mockEthClient,
          mockContext.log,
        );

        expect(typeof result).toBe("bigint");
        expect(result).toBe(600n);

        // Verify correct contract call with chain-specific address
        expect(mockSimulateContract).toHaveBeenCalledTimes(1);
        const callArgs = mockSimulateContract.mock.calls[0][0];
        // Note: viem normalizes addresses to lowercase
        expect(callArgs.address.toLowerCase()).toBe(address.toLowerCase());
        expect(callArgs.functionName).toBe("getFee");
        expect(callArgs.blockNumber).toBe(BigInt(blockNumber));
        expect(callArgs.args).toEqual([poolAddress]);
      });
    }

    it("should handle contract call errors", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const dynamicFeeModuleAddress =
        "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 12345;

      // Mock simulateContract to throw an error
      const mockSimulateContract = jest.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockRejectedValue(new Error("Contract call failed"));

      await expect(
        fetchCurrentFee(
          poolAddress,
          dynamicFeeModuleAddress,
          chainId,
          blockNumber,
          mockEthClient,
          mockContext.log,
        ),
      ).rejects.toThrow("Contract call failed");

      // Verify error was logged
      expect(jest.mocked(mockContext.log.error)).toHaveBeenCalled();
    });
  });
});
