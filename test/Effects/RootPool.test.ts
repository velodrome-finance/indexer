import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, toChecksumAddress } from "../../src/Constants";
import {
  fetchRootPoolAddress,
  getRootPoolAddress,
} from "../../src/Effects/RootPool";

describe("RootPool Effects", () => {
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

  const mockLpHelperAddress = toChecksumAddress(
    "0x2F44BD0Aff1826aec123cE3eA9Ce44445b64BB34",
  );
  const mockFactory = toChecksumAddress(
    "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
  );
  const mockToken0 = toChecksumAddress(
    "0xDcc0F2D8F90FDe85b10aC1c8Ab57dc0AE946A543",
  );
  const mockToken1 = toChecksumAddress(
    "0xFc00000000000000000000000000000000000001",
  );
  const mockType = 0;
  const mockRootPoolAddress = toChecksumAddress(
    "0x98dcff98d17f21e35211c923934924af65fbdd66",
  );

  let originalChainConstants252: unknown;

  beforeEach(() => {
    originalChainConstants252 = (
      CHAIN_CONSTANTS as Record<number, unknown>
    )[252];

    mockEthClient = {
      simulateContract: vi.fn().mockResolvedValue({
        result: mockRootPoolAddress.toLowerCase(), // viem returns lowercase
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any),
    } as unknown as PublicClient;

    // Mock CHAIN_CONSTANTS for Fraxtal (chainId 252)
    (
      CHAIN_CONSTANTS as Record<
        number,
        { eth_client: PublicClient; lpHelperAddress: string }
      >
    )[252] = {
      eth_client: mockEthClient,
      lpHelperAddress: mockLpHelperAddress,
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
    if (originalChainConstants252 === undefined) {
      (CHAIN_CONSTANTS as Record<number, unknown>)[252] = undefined;
    } else {
      (CHAIN_CONSTANTS as Record<number, unknown>)[252] =
        originalChainConstants252;
    }
  });

  describe("getRootPoolAddress", () => {
    it("should be a valid effect object", () => {
      expect(typeof getRootPoolAddress).toBe("object");
      expect(getRootPoolAddress).toHaveProperty("name", "getRootPoolAddress");
    });
  });

  describe("fetchRootPoolAddress", () => {
    it("should fetch root pool address and return checksummed format", async () => {
      const result = await fetchRootPoolAddress(
        mockEthClient,
        mockLpHelperAddress,
        mockFactory,
        mockToken0,
        mockToken1,
        mockType,
        mockContext.log,
      );

      expect(typeof result).toBe("string");
      // Should return checksummed address (use actual checksummed value)
      const expectedChecksummed = toChecksumAddress(mockRootPoolAddress);
      expect(result).toBe(expectedChecksummed);

      // Verify simulateContract was called
      const mockSimulateContract = vi.mocked(mockEthClient.simulateContract);
      expect(mockSimulateContract).toHaveBeenCalledTimes(1);
    });

    it("should handle array result from simulateContract", async () => {
      // Mock simulateContract to return an array (some viem versions return arrays)
      const mockSimulateContract = vi.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: [mockRootPoolAddress.toLowerCase()], // Array with single value
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await fetchRootPoolAddress(
        mockEthClient,
        mockLpHelperAddress,
        mockFactory,
        mockToken0,
        mockToken1,
        mockType,
        mockContext.log,
      );

      expect(typeof result).toBe("string");
      const expectedChecksummed = toChecksumAddress(mockRootPoolAddress);
      expect(result).toBe(expectedChecksummed);
    });

    it("should handle direct string result from simulateContract", async () => {
      // Mock simulateContract to return a direct string
      const mockSimulateContract = vi.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: mockRootPoolAddress.toLowerCase(),
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await fetchRootPoolAddress(
        mockEthClient,
        mockLpHelperAddress,
        mockFactory,
        mockToken0,
        mockToken1,
        mockType,
        mockContext.log,
      );

      expect(typeof result).toBe("string");
      const expectedChecksummed = toChecksumAddress(mockRootPoolAddress);
      expect(result).toBe(expectedChecksummed);
    });

    it("should handle contract call errors", async () => {
      const mockSimulateContract = vi.mocked(mockEthClient.simulateContract);
      const error = new Error("Contract call failed");
      mockSimulateContract.mockRejectedValue(error);

      await expect(
        fetchRootPoolAddress(
          mockEthClient,
          mockLpHelperAddress,
          mockFactory,
          mockToken0,
          mockToken1,
          mockType,
          mockContext.log,
        ),
      ).rejects.toThrow("Contract call failed");
    });

    it("should normalize lowercase addresses to checksum format", async () => {
      const lowercaseAddress = "0xabcdef1234567890abcdef1234567890abcdef12";
      const mockSimulateContract = vi.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: lowercaseAddress,
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await fetchRootPoolAddress(
        mockEthClient,
        mockLpHelperAddress,
        mockFactory,
        mockToken0,
        mockToken1,
        mockType,
        mockContext.log,
      );

      // Should be checksummed (use actual checksummed value)
      const expectedChecksummed = toChecksumAddress(lowercaseAddress);
      expect(result).toBe(expectedChecksummed);
      expect(result).not.toBe(lowercaseAddress);
    });

    it("should return empty string and log error when address is null/undefined", async () => {
      const mockSimulateContract = vi.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: null,
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await fetchRootPoolAddress(
        mockEthClient,
        mockLpHelperAddress,
        mockFactory,
        mockToken0,
        mockToken1,
        mockType,
        mockContext.log,
      );

      // Should return empty string instead of throwing
      expect(result).toBe("");

      // Should log an error
      const mockError = vi.mocked(mockContext.log.error);
      expect(mockError).toHaveBeenCalledTimes(1);
      expect(mockError).toHaveBeenCalledWith(
        "[fetchRootPoolAddress] No root pool address found. Returning empty address",
      );
    });
  });
});
