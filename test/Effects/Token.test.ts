import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, PriceOracleType } from "../../src/Constants";
import * as ErrorsEffects from "../../src/Effects/Errors";
import * as HelpersEffects from "../../src/Effects/Helpers";
import {
  fetchTokenDetails,
  fetchTokenPrice,
  getTokenDetails,
  getTokenPrice,
} from "../../src/Effects/Token";
import * as TokenEffects from "../../src/Effects/Token";

// Common test constants
const TEST_CHAIN_ID = 10;
const TEST_BLOCK_NUMBER = 12345;
const TEST_BLOCK_NUMBER_EARLY = 100;
const TEST_GAS_LIMIT = 1000000n;
const TEST_TOKEN_ADDRESS = "0x1234567890123456789012345678901234567890";
const TEST_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TEST_SYSTEM_TOKEN = "0x4200000000000000000000000000000000000006";
const TEST_ORACLE_ADDRESS = "0x1234567890123456789012345678901234567890";
const TEST_PRICE_RESULT = ["1000000000000000000"];

// Helper functions will be defined inside describe block to access mockEthClient and mockContext

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

  // Helper to setup chain constants
  const setupChainConstants = (
    oracleType: PriceOracleType = PriceOracleType.V3,
    options: {
      startBlock?: number;
      priceConnectors?: Array<{ address: string; createdBlock: number }>;
      weth?: string;
      usdc?: string;
      rewardToken?: string | (() => string);
    } = {},
  ) => {
    (CHAIN_CONSTANTS as Record<number, unknown>)[TEST_CHAIN_ID] = {
      eth_client: mockEthClient,
      weth: options.weth ?? TEST_SYSTEM_TOKEN,
      usdc: options.usdc ?? TEST_USDC_ADDRESS,
      rewardToken:
        options.rewardToken ?? vi.fn().mockReturnValue(TEST_SYSTEM_TOKEN),
      oracle: {
        startBlock: options.startBlock ?? 0,
        getType: () => oracleType,
        getAddress: () => TEST_ORACLE_ADDRESS,
        getPrice: vi.fn(),
        priceConnectors: options.priceConnectors ?? [],
      },
    };
  };

  // Helper to mock Date.now() for slow request simulation
  const mockSlowDateNow = (
    attemptDuration: number,
    overallDuration?: number,
  ) => {
    const originalDateNow = Date.now;
    let callCount = 0;
    const baseTime = 1000000;
    Date.now = vi.fn(() => {
      callCount++;
      if (callCount === 1) return baseTime;
      if (callCount === 2) return baseTime;
      if (callCount === 3) return baseTime + attemptDuration;
      return baseTime + (overallDuration ?? attemptDuration);
    });
    return originalDateNow;
  };

  // Helper to setup token details mock
  const setupTokenDetailsMock = (usdc: string) => {
    const originalEffect = mockContext.effect;
    mockContext.effect = async (effectDef: unknown, input: unknown) => {
      if (effectDef === getTokenDetails) {
        const addr = (input as { contractAddress: string }).contractAddress;
        return addr.toLowerCase() === usdc.toLowerCase()
          ? { name: "USDC", symbol: "USDC", decimals: 6 }
          : { name: "TKN", symbol: "TKN", decimals: 18 };
      }
      return originalEffect(effectDef as never, input);
    };
  };

  beforeEach(() => {
    mockEthClient = {
      simulateContract: vi.fn().mockResolvedValue({
        result: "Test Token",
      }),
    } as unknown as PublicClient;

    setupChainConstants();
    vi.spyOn(HelpersEffects, "sleep").mockResolvedValue(undefined);

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

    it("should return 1e18 price for USDC without calling oracle", async () => {
      setupChainConstants(PriceOracleType.V3, { usdc: TEST_USDC_ADDRESS });

      const fetchSpy = vi.spyOn(TokenEffects, "fetchTokenPrice");

      const result = await mockContext.effect(getTokenPrice as never, {
        tokenAddress: TEST_USDC_ADDRESS,
        chainId: TEST_CHAIN_ID,
        blockNumber: TEST_BLOCK_NUMBER,
      });

      expect(result).toEqual({
        pricePerUSDNew: 10n ** 18n,
        priceOracleType: PriceOracleType.V3.toString(),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("should return 0 price when oracle is not deployed", async () => {
      setupChainConstants(PriceOracleType.V3, { startBlock: 999999 });

      const fetchSpy = vi.spyOn(TokenEffects, "fetchTokenPrice");

      const result = await mockContext.effect(getTokenPrice as never, {
        tokenAddress: TEST_TOKEN_ADDRESS,
        chainId: TEST_CHAIN_ID,
        blockNumber: TEST_BLOCK_NUMBER_EARLY,
      });

      expect(result).toEqual({
        pricePerUSDNew: 0n,
        priceOracleType: PriceOracleType.V3.toString(),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockContext.log.info).toHaveBeenCalled();
    });

    it("should convert V3 oracle price decimals and warn on zero price + slow effect", async () => {
      setupChainConstants(PriceOracleType.V3);
      setupTokenDetailsMock(TEST_USDC_ADDRESS);

      vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(6001);
      vi.spyOn(TokenEffects, "fetchTokenPrice").mockResolvedValue({
        pricePerUSDNew: 0n,
        priceOracleType: PriceOracleType.V3.toString(),
      });

      const result = await mockContext.effect(getTokenPrice as never, {
        tokenAddress: TEST_TOKEN_ADDRESS,
        chainId: TEST_CHAIN_ID,
        blockNumber: TEST_BLOCK_NUMBER,
      });

      expect(result).toEqual({
        pricePerUSDNew: 0n,
        priceOracleType: PriceOracleType.V3.toString(),
      });
      expect(mockContext.log.warn).toHaveBeenCalled();
    });

    it("should handle fetchTokenPrice errors via effect catch and return 0 price", async () => {
      setupChainConstants(PriceOracleType.V3);
      setupTokenDetailsMock(TEST_USDC_ADDRESS);

      vi.spyOn(TokenEffects, "fetchTokenPrice").mockRejectedValue(
        new Error("oracle failure"),
      );

      const result = await mockContext.effect(getTokenPrice as never, {
        tokenAddress: TEST_TOKEN_ADDRESS,
        chainId: TEST_CHAIN_ID,
        blockNumber: TEST_BLOCK_NUMBER,
      });

      expect(result).toEqual({
        pricePerUSDNew: 0n,
        priceOracleType: PriceOracleType.V3.toString(),
      });
      expect(mockContext.log.error).toHaveBeenCalled();
    });

    it("should use V2 oracle path and filter SYSTEM_TOKEN_ADDRESS from connectors", async () => {
      setupChainConstants(PriceOracleType.V2, {
        rewardToken: vi.fn().mockReturnValue(TEST_SYSTEM_TOKEN),
        priceConnectors: [
          {
            address: "0x1111111111111111111111111111111111111111",
            createdBlock: 0,
          },
          { address: TEST_SYSTEM_TOKEN, createdBlock: 0 },
          {
            address: "0x2222222222222222222222222222222222222222",
            createdBlock: 0,
          },
        ],
      });
      setupTokenDetailsMock(TEST_USDC_ADDRESS);

      const mockSimulateContract = vi.mocked(mockEthClient.simulateContract);
      mockSimulateContract.mockResolvedValue({
        result: [
          "0x0000000000000000000000000000000000000000000000001bc16d674ec80000",
        ],
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      const result = await mockContext.effect(getTokenPrice as never, {
        tokenAddress: TEST_TOKEN_ADDRESS,
        chainId: TEST_CHAIN_ID,
        blockNumber: TEST_BLOCK_NUMBER,
      });

      expect(mockSimulateContract).toHaveBeenCalled();
      const callArgs = mockSimulateContract.mock.calls[0][0];
      expect(callArgs.functionName).toBe("getManyRatesWithConnectors");
      const tokenAddressArray = (callArgs.args as unknown[])[1] as string[];
      const connectorsInArray = tokenAddressArray.slice(
        tokenAddressArray.findIndex(
          (a) => a.toLowerCase() === TEST_TOKEN_ADDRESS.toLowerCase(),
        ) + 1,
        tokenAddressArray.findIndex(
          (a) => a.toLowerCase() === TEST_SYSTEM_TOKEN.toLowerCase(),
        ),
      );
      expect(connectorsInArray).toHaveLength(2);
      expect(connectorsInArray).not.toContain(TEST_SYSTEM_TOKEN);
      expect(result).toEqual({
        pricePerUSDNew: 2000000000000000000n,
        priceOracleType: PriceOracleType.V2.toString(),
      });
    });

    it("should hit catch block when fetchTokenPrice throws", async () => {
      let getTypeCallCount = 0;
      const mockOracle = {
        startBlock: 0,
        getType: vi.fn(() => {
          getTypeCallCount++;
          if (getTypeCallCount === 1) throw new Error("getType failure");
          return PriceOracleType.V3;
        }),
        getAddress: () => TEST_ORACLE_ADDRESS,
        getPrice: vi.fn(),
        priceConnectors: [],
      };

      setupChainConstants(PriceOracleType.V3, {});
      (CHAIN_CONSTANTS as Record<number, { oracle: unknown }>)[
        TEST_CHAIN_ID
      ].oracle = mockOracle;
      setupTokenDetailsMock(TEST_USDC_ADDRESS);

      vi.mocked(mockEthClient.simulateContract).mockResolvedValue({
        result: TEST_PRICE_RESULT as unknown,
      } as never);

      const result = await mockContext.effect(getTokenPrice as never, {
        tokenAddress: TEST_TOKEN_ADDRESS,
        chainId: TEST_CHAIN_ID,
        blockNumber: TEST_BLOCK_NUMBER,
      });

      expect(result).toEqual({
        pricePerUSDNew: 0n,
        priceOracleType: PriceOracleType.V3.toString(),
      });
      expect(mockContext.log.error).toHaveBeenCalled();
    });
  });

  describe("fetchTokenDetails", () => {
    it("should fetch token details from contract", async () => {
      vi.mocked(mockEthClient.simulateContract)
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        .mockResolvedValueOnce({ result: "Test Token" } as any)
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        .mockResolvedValueOnce({ result: 18 } as any)
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        .mockResolvedValueOnce({ result: "TEST" } as any);

      const result = await fetchTokenDetails(
        TEST_TOKEN_ADDRESS,
        mockEthClient,
        mockContext.log,
      );

      expect(result).toEqual({
        name: "Test Token",
        symbol: "TEST",
        decimals: 18,
      });
      expect(mockEthClient.simulateContract).toHaveBeenCalledTimes(3);
    });

    it("should handle errors and undefined/null results", async () => {
      const testCases = [
        {
          mock: () =>
            vi
              .mocked(mockEthClient.simulateContract)
              .mockRejectedValue(new Error("Contract call failed")),
          expected: { name: "", symbol: "", decimals: 0 },
        },
        {
          mock: () =>
            vi
              .mocked(mockEthClient.simulateContract)
              // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
              .mockResolvedValueOnce({ result: undefined } as any)
              // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
              .mockResolvedValueOnce({ result: null } as any)
              // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
              .mockResolvedValueOnce({ result: undefined } as any),
          expected: { name: "", symbol: "", decimals: 0 },
        },
      ];

      for (const { mock, expected } of testCases) {
        mock();
        const result = await fetchTokenDetails(
          TEST_TOKEN_ADDRESS,
          mockEthClient,
          mockContext.log,
        );
        expect(result).toEqual(expected);
      }
    });
  });

  describe("fetchTokenPrice", () => {
    it("should fetch token price from V3 and V2 oracles", async () => {
      const testCases = [
        {
          oracleType: PriceOracleType.V3,
          functionName: "getManyRatesWithCustomConnectors",
          result: [
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          ],
          expectedPrice: 1n,
          expectedType: PriceOracleType.V3,
        },
        {
          oracleType: PriceOracleType.V2,
          functionName: "getManyRatesWithConnectors",
          result: [
            "0x0000000000000000000000000000000000000000000000000000000000000002",
          ],
          expectedPrice: 2n,
          expectedType: "v2",
        },
      ];

      for (const testCase of testCases) {
        setupChainConstants(testCase.oracleType);
        vi.mocked(mockEthClient.simulateContract).mockResolvedValue({
          result: testCase.result,
          // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        } as any);

        const result = await fetchTokenPrice(
          TEST_TOKEN_ADDRESS,
          TEST_USDC_ADDRESS,
          TEST_SYSTEM_TOKEN,
          TEST_SYSTEM_TOKEN,
          [],
          TEST_CHAIN_ID,
          TEST_BLOCK_NUMBER,
          mockEthClient,
          mockContext.log,
          TEST_GAS_LIMIT,
          7,
        );

        expect(result).toEqual({
          pricePerUSDNew: testCase.expectedPrice,
          priceOracleType: testCase.expectedType,
        });
        const callArgs = vi.mocked(mockEthClient.simulateContract).mock
          .calls[0][0];
        expect(callArgs.functionName).toBe(testCase.functionName);
        vi.mocked(mockEthClient.simulateContract).mockClear();
      }
    });

    it("should handle contract call errors gracefully", async () => {
      setupChainConstants(PriceOracleType.V2);
      vi.mocked(mockEthClient.simulateContract).mockRejectedValue(
        new Error("Oracle call failed"),
      );

      const result = await fetchTokenPrice(
        TEST_TOKEN_ADDRESS,
        TEST_USDC_ADDRESS,
        TEST_SYSTEM_TOKEN,
        TEST_SYSTEM_TOKEN,
        [],
        TEST_CHAIN_ID,
        TEST_BLOCK_NUMBER,
        mockEthClient,
        mockContext.log,
        TEST_GAS_LIMIT,
        7,
      );

      expect(result).toEqual({
        pricePerUSDNew: 0n,
        priceOracleType: "v2",
      });
      expect(mockContext.log.error).toHaveBeenCalled();
    });

    it("should retry on out of gas errors with increased gas limit", async () => {
      setupChainConstants(PriceOracleType.V2);
      vi.mocked(mockEthClient.simulateContract)
        .mockRejectedValueOnce(
          new Error("out of gas: gas required exceeds: 1000000"),
        )
        .mockResolvedValueOnce({
          result: [
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          ],
          // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        } as any);

      const result = await fetchTokenPrice(
        TEST_TOKEN_ADDRESS,
        TEST_USDC_ADDRESS,
        TEST_SYSTEM_TOKEN,
        TEST_SYSTEM_TOKEN,
        [],
        TEST_CHAIN_ID,
        TEST_BLOCK_NUMBER,
        mockEthClient,
        mockContext.log,
        TEST_GAS_LIMIT,
        7,
      );

      expect(result.pricePerUSDNew).toBe(1n);
      expect(mockEthClient.simulateContract).toHaveBeenCalledTimes(2);
      const secondCall = vi.mocked(mockEthClient.simulateContract).mock
        .calls[1][0];
      expect(secondCall.gas).toBe(2000000n);
    });

    it("should retry on rate limit errors with exponential backoff", async () => {
      setupChainConstants(PriceOracleType.V2);
      const sleepSpy = vi
        .spyOn(HelpersEffects, "sleep")
        .mockResolvedValue(undefined);
      vi.mocked(mockEthClient.simulateContract)
        .mockRejectedValueOnce(new Error("rate limit exceeded"))
        .mockResolvedValueOnce({
          result: [
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          ],
          // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        } as any);

      const result = await fetchTokenPrice(
        TEST_TOKEN_ADDRESS,
        TEST_USDC_ADDRESS,
        TEST_SYSTEM_TOKEN,
        TEST_SYSTEM_TOKEN,
        [],
        TEST_CHAIN_ID,
        TEST_BLOCK_NUMBER,
        mockEthClient,
        mockContext.log,
        TEST_GAS_LIMIT,
        7,
      );

      expect(result.pricePerUSDNew).toBe(1n);
      expect(mockEthClient.simulateContract).toHaveBeenCalledTimes(2);
      expect(sleepSpy).toHaveBeenCalled();
      expect(sleepSpy.mock.calls[0]?.[0]).toBe(1000);
    });

    it("should handle contract revert errors without retries", async () => {
      setupChainConstants(PriceOracleType.V2);
      vi.mocked(mockEthClient.simulateContract).mockRejectedValue(
        new Error("execution reverted"),
      );

      const result = await fetchTokenPrice(
        TEST_TOKEN_ADDRESS,
        TEST_USDC_ADDRESS,
        TEST_SYSTEM_TOKEN,
        TEST_SYSTEM_TOKEN,
        [],
        TEST_CHAIN_ID,
        TEST_BLOCK_NUMBER,
        mockEthClient,
        mockContext.log,
        TEST_GAS_LIMIT,
        7,
      );

      expect(result.pricePerUSDNew).toBe(0n);
      expect(mockEthClient.simulateContract).toHaveBeenCalledTimes(1);
    });

    it("should log warnings for slow successful requests (V3 and V2)", async () => {
      const testCases = [
        { oracleType: PriceOracleType.V3 },
        { oracleType: PriceOracleType.V2 },
      ];

      for (const { oracleType } of testCases) {
        setupChainConstants(oracleType);
        const restoreDateNow = mockSlowDateNow(6000);
        vi.mocked(mockEthClient.simulateContract).mockResolvedValue({
          result: TEST_PRICE_RESULT,
          // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        } as any);

        await fetchTokenPrice(
          TEST_TOKEN_ADDRESS,
          TEST_USDC_ADDRESS,
          TEST_SYSTEM_TOKEN,
          TEST_SYSTEM_TOKEN,
          [],
          TEST_CHAIN_ID,
          TEST_BLOCK_NUMBER,
          mockEthClient,
          mockContext.log,
          TEST_GAS_LIMIT,
          7,
        );

        expect(mockContext.log.warn).toHaveBeenCalledWith(
          expect.stringContaining("Slow request detected"),
        );
        Date.now = restoreDateNow;
        vi.mocked(mockContext.log.warn).mockClear();
      }
    });

    it("should log warning for slow failed requests", async () => {
      setupChainConstants(PriceOracleType.V3);
      const sleepSpy = vi
        .spyOn(HelpersEffects, "sleep")
        .mockResolvedValue(undefined);
      const restoreDateNow = mockSlowDateNow(6000);
      vi.mocked(mockEthClient.simulateContract)
        .mockRejectedValueOnce(new Error("network error"))
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
        .mockResolvedValue({ result: TEST_PRICE_RESULT } as any);

      await fetchTokenPrice(
        TEST_TOKEN_ADDRESS,
        TEST_USDC_ADDRESS,
        TEST_SYSTEM_TOKEN,
        TEST_SYSTEM_TOKEN,
        [],
        TEST_CHAIN_ID,
        TEST_BLOCK_NUMBER,
        mockEthClient,
        mockContext.log,
        TEST_GAS_LIMIT,
        7,
      );

      expect(mockContext.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("Slow failed request"),
      );
      Date.now = restoreDateNow;
      sleepSpy.mockRestore();
    });

    it("should log error for very slow successful requests", async () => {
      setupChainConstants(PriceOracleType.V2);
      const restoreDateNow = mockSlowDateNow(1000, 35000);
      vi.mocked(mockEthClient.simulateContract).mockResolvedValue({
        result: TEST_PRICE_RESULT,
        // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
      } as any);

      await fetchTokenPrice(
        TEST_TOKEN_ADDRESS,
        TEST_USDC_ADDRESS,
        TEST_SYSTEM_TOKEN,
        TEST_SYSTEM_TOKEN,
        [],
        TEST_CHAIN_ID,
        TEST_BLOCK_NUMBER,
        mockEthClient,
        mockContext.log,
        TEST_GAS_LIMIT,
        7,
      );

      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining("Very slow request"),
      );
      Date.now = restoreDateNow;
    });

    it("should retry rate limit errors with correct delays", async () => {
      const testCases = [
        { failures: 6, expectedDelay: 30000, attempt: 5 },
        { failures: 7, expectedDelay: 60000, attempt: 6 },
      ];

      for (const { failures, expectedDelay } of testCases) {
        setupChainConstants(PriceOracleType.V3);
        const sleepSpy = vi
          .spyOn(HelpersEffects, "sleep")
          .mockResolvedValue(undefined);
        const mockSimulateContract = vi.mocked(mockEthClient.simulateContract);
        mockSimulateContract.mockReset().mockImplementation(() => {
          if (mockSimulateContract.mock.calls.length <= failures) {
            return Promise.reject(new Error("rate limit exceeded"));
          }
          // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
          return Promise.resolve({ result: TEST_PRICE_RESULT } as any);
        });

        await fetchTokenPrice(
          TEST_TOKEN_ADDRESS,
          TEST_USDC_ADDRESS,
          TEST_SYSTEM_TOKEN,
          TEST_SYSTEM_TOKEN,
          [],
          TEST_CHAIN_ID,
          TEST_BLOCK_NUMBER,
          mockEthClient,
          mockContext.log,
          TEST_GAS_LIMIT,
          7,
        );

        expect(sleepSpy).toHaveBeenCalledWith(expectedDelay);
        sleepSpy.mockRestore();
      }
    });

    it("should retry network errors with correct delays", async () => {
      const testCases = [
        { failures: 6, expectedDelay: 15000 },
        { failures: 7, expectedDelay: 30000 },
      ];

      for (const { failures, expectedDelay } of testCases) {
        setupChainConstants(PriceOracleType.V3);
        const sleepSpy = vi
          .spyOn(HelpersEffects, "sleep")
          .mockResolvedValue(undefined);
        const mockSimulateContract = vi.mocked(mockEthClient.simulateContract);
        mockSimulateContract.mockReset().mockImplementation(() => {
          if (mockSimulateContract.mock.calls.length <= failures) {
            return Promise.reject(new Error("network error"));
          }
          // biome-ignore lint/suspicious/noExplicitAny: viem mock return shape not needed in tests
          return Promise.resolve({ result: TEST_PRICE_RESULT } as any);
        });

        await fetchTokenPrice(
          TEST_TOKEN_ADDRESS,
          TEST_USDC_ADDRESS,
          TEST_SYSTEM_TOKEN,
          TEST_SYSTEM_TOKEN,
          [],
          TEST_CHAIN_ID,
          TEST_BLOCK_NUMBER,
          mockEthClient,
          mockContext.log,
          TEST_GAS_LIMIT,
          7,
        );

        expect(sleepSpy).toHaveBeenCalledWith(expectedDelay);
        sleepSpy.mockRestore();
      }
    });
  });
});
