import type { logger as Envio_logger } from "envio/src/Envio.gen";
import type { PublicClient } from "viem";
import {
  CHAIN_CONSTANTS,
  PriceOracleType,
  toChecksumAddress,
} from "../../src/Constants";
import * as HelpersEffects from "../../src/Effects/Helpers";
import {
  fetchTokenDetails,
  type fetchTokenPrice,
  getTokenDetails,
  getTokenPrice,
  roundBlockToInterval,
} from "../../src/Effects/Token";
import * as TokenEffects from "../../src/Effects/Token";

vi.mock("../../src/Effects/Token", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/Effects/Token")>();
  return { ...actual, fetchTokenPrice: vi.fn() };
});

// Common test constants
const TEST_CHAIN_ID = 10;
const TEST_BLOCK_NUMBER = 12345;
const TEST_BLOCK_NUMBER_EARLY = 100;
const TEST_TOKEN_ADDRESS = toChecksumAddress(
  "0x1234567890123456789012345678901234567890",
);
const TEST_USDC_ADDRESS = toChecksumAddress(
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
);
const TEST_SYSTEM_TOKEN = toChecksumAddress(
  "0x4200000000000000000000000000000000000006",
);
const TEST_ORACLE_ADDRESS = toChecksumAddress(
  "0x1234567890123456789012345678901234567890",
);
const TEST_PRICE_RESULT = ["1000000000000000000"];

// Helper functions will be defined inside describe block to access mockEthClient and mockContext

describe("roundBlockToInterval", () => {
  describe("chainId 1 (mainnet, 12s block time, 300 blocks/hour)", () => {
    it("should return block number when it is already on interval boundary", () => {
      expect(roundBlockToInterval(3600, 1)).toBe(3600);
      expect(roundBlockToInterval(0, 1)).toBe(0);
    });

    it("should round down to interval boundary", () => {
      expect(roundBlockToInterval(3601, 1)).toBe(3600);
      expect(roundBlockToInterval(3899, 1)).toBe(3600);
    });
  });

  describe("other chains (2s block time, 1800 blocks/hour)", () => {
    it("should return block number when it is already on interval boundary", () => {
      expect(roundBlockToInterval(1800, 10)).toBe(1800);
      expect(roundBlockToInterval(0, 10)).toBe(0);
    });

    it("should round down to interval boundary", () => {
      expect(roundBlockToInterval(1801, 10)).toBe(1800);
      expect(roundBlockToInterval(3599, 10)).toBe(1800);
    });
  });
});

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
      destinationToken?: string;
      destinationTokenDecimals?: number;
      rewardToken?: string | (() => string);
    } = {},
  ) => {
    (CHAIN_CONSTANTS as Record<number, unknown>)[TEST_CHAIN_ID] = {
      eth_client: mockEthClient,
      weth: options.weth ?? TEST_SYSTEM_TOKEN,
      destinationToken: options.destinationToken ?? TEST_USDC_ADDRESS,
      destinationTokenDecimals: options.destinationTokenDecimals ?? 6,
      rewardToken:
        options.rewardToken ?? vi.fn().mockReturnValue(TEST_SYSTEM_TOKEN),
      oracle: {
        startBlock: options.startBlock ?? 0,
        getType: () => oracleType,
        getAddress: () => TEST_ORACLE_ADDRESS,
        getPrice: vi.fn(),
        priceConnectors: options.priceConnectors ?? [],
      },
      stablecoins: new Set<string>(),
    };
  };

  // Helper to mock Date.now() for slow request simulation (fetchTokenPrice calls it at start and after readContract); returns restore fn
  const mockSlowDateNow = (
    durationMs: number,
    secondCallDuration?: number,
  ): (() => void) => {
    let callCount = 0;
    const baseTime = 1000000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => {
      callCount++;
      if (callCount === 1) return baseTime;
      return baseTime + (secondCallDuration ?? durationMs);
    });
    return () => spy.mockRestore();
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
      readContract: vi.fn().mockResolvedValue("Test Token"),
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
      setupChainConstants(PriceOracleType.V3, {
        destinationToken: TEST_USDC_ADDRESS,
      });
      vi.mocked(TokenEffects.fetchTokenPrice).mockClear();

      const result = await mockContext.effect(getTokenPrice as never, {
        tokenAddress: TEST_USDC_ADDRESS,
        chainId: TEST_CHAIN_ID,
        blockNumber: TEST_BLOCK_NUMBER,
      });

      expect(result).toEqual({
        pricePerUSDNew: 10n ** 18n,
        priceOracleType: PriceOracleType.V3.toString(),
      });
      expect(TokenEffects.fetchTokenPrice).not.toHaveBeenCalled();
    });

    it("should return 1e18 price for known stablecoins without calling oracle", async () => {
      const stablecoinAddress = toChecksumAddress(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      setupChainConstants(PriceOracleType.V3, {});
      // Add the stablecoin to the chain's set
      (CHAIN_CONSTANTS as Record<number, { stablecoins: Set<string> }>)[
        TEST_CHAIN_ID
      ].stablecoins.add(stablecoinAddress.toLowerCase());
      vi.mocked(TokenEffects.fetchTokenPrice).mockClear();

      const result = await mockContext.effect(getTokenPrice as never, {
        tokenAddress: stablecoinAddress,
        chainId: TEST_CHAIN_ID,
        blockNumber: TEST_BLOCK_NUMBER,
      });

      expect(result).toEqual({
        pricePerUSDNew: 10n ** 18n,
        priceOracleType: PriceOracleType.V3.toString(),
      });
      expect(TokenEffects.fetchTokenPrice).not.toHaveBeenCalled();
    });

    it("should return 0 price when oracle is not deployed", async () => {
      setupChainConstants(PriceOracleType.V3, { startBlock: 999999 });
      vi.mocked(TokenEffects.fetchTokenPrice).mockClear();

      const result = await mockContext.effect(getTokenPrice as never, {
        tokenAddress: TEST_TOKEN_ADDRESS,
        chainId: TEST_CHAIN_ID,
        blockNumber: TEST_BLOCK_NUMBER_EARLY,
      });

      expect(result).toEqual({
        pricePerUSDNew: 0n,
        priceOracleType: PriceOracleType.V3.toString(),
      });
      expect(TokenEffects.fetchTokenPrice).not.toHaveBeenCalled();
      expect(mockContext.log.info).toHaveBeenCalled();
    });

    it("should convert V3 oracle price decimals and warn on zero price + slow effect", async () => {
      setupChainConstants(PriceOracleType.V3);
      setupTokenDetailsMock(TEST_USDC_ADDRESS);

      vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(6001);
      vi.mocked(TokenEffects.fetchTokenPrice).mockResolvedValue({
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

      vi.mocked(TokenEffects.fetchTokenPrice).mockRejectedValue(
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
            address: toChecksumAddress(
              "0x1111111111111111111111111111111111111111",
            ),
            createdBlock: 0,
          },
          { address: TEST_SYSTEM_TOKEN, createdBlock: 0 },
          {
            address: toChecksumAddress(
              "0x2222222222222222222222222222222222222222",
            ),
            createdBlock: 0,
          },
        ],
      });
      // RpcGateway calls fetchTokenDetails x2 then fetchTokenPrice; set up 6 token-detail reads then oracle
      const mockReadContract = vi.mocked(mockEthClient.readContract);
      mockReadContract
        .mockResolvedValueOnce("TKN" as unknown as string)
        .mockResolvedValueOnce(18 as unknown as number)
        .mockResolvedValueOnce("TKN" as unknown as string)
        .mockResolvedValueOnce("USDC" as unknown as string)
        .mockResolvedValueOnce(6 as unknown as number)
        .mockResolvedValueOnce("USDC" as unknown as string)
        .mockResolvedValue([
          "0x0000000000000000000000000000000000000000000000001bc16d674ec80000",
        ] as unknown as readonly bigint[]);

      const result = await mockContext.effect(getTokenPrice as never, {
        tokenAddress: TEST_TOKEN_ADDRESS,
        chainId: TEST_CHAIN_ID,
        blockNumber: TEST_BLOCK_NUMBER,
      });

      expect(mockReadContract).toHaveBeenCalled();
      // First 6 calls are fetchTokenDetails (name, decimals, symbol x2); 7th is oracle
      const oracleCall = mockReadContract.mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { functionName?: string }).functionName ===
          "getManyRatesWithConnectors",
      );
      expect(oracleCall).toBeDefined();
      const callArgs = oracleCall?.[0] as unknown as {
        functionName: string;
        args: readonly unknown[];
      };
      const tokenAddressArray = callArgs.args[1] as string[];
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
          // First getType is when building fallback; second is inside fetchTokenPrice
          if (getTypeCallCount === 2) throw new Error("getType failure");
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

      // RpcGateway calls fetchTokenDetails x2 then fetchTokenPrice; getType throws on 2nd call (inside fetchTokenPrice)
      vi.mocked(mockEthClient.readContract)
        .mockResolvedValueOnce("TKN" as unknown as string)
        .mockResolvedValueOnce(18 as unknown as number)
        .mockResolvedValueOnce("TKN" as unknown as string)
        .mockResolvedValueOnce("USDC" as unknown as string)
        .mockResolvedValueOnce(6 as unknown as number)
        .mockResolvedValueOnce("USDC" as unknown as string)
        .mockResolvedValue(TEST_PRICE_RESULT as unknown as readonly bigint[]);

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
      vi.mocked(mockEthClient.readContract)
        .mockResolvedValueOnce("Test Token" as unknown as string)
        .mockResolvedValueOnce(18 as unknown as number)
        .mockResolvedValueOnce("TEST" as unknown as string);

      const result = await fetchTokenDetails(TEST_TOKEN_ADDRESS, mockEthClient);

      expect(result).toEqual({
        name: "Test Token",
        symbol: "TEST",
        decimals: 18,
      });
      expect(mockEthClient.readContract).toHaveBeenCalledTimes(3);
    });

    it("should throw on contract call errors (gateway logs and returns default)", async () => {
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("Contract call failed"),
      );

      await expect(
        fetchTokenDetails(TEST_TOKEN_ADDRESS, mockEthClient),
      ).rejects.toThrow("Contract call failed");
    });

    it("should return default fields for undefined/null results", async () => {
      vi.mocked(mockEthClient.readContract)
        .mockResolvedValueOnce(undefined as unknown as string)
        .mockResolvedValueOnce(null as unknown as number)
        .mockResolvedValueOnce(undefined as unknown as string);

      const result = await fetchTokenDetails(TEST_TOKEN_ADDRESS, mockEthClient);
      expect(result).toEqual({ name: "", symbol: "", decimals: 18 });
    });
  });

  describe("fetchTokenPrice", () => {
    let realFetchTokenPrice: typeof fetchTokenPrice;

    beforeAll(async () => {
      const actual = await vi.importActual<
        typeof import("../../src/Effects/Token")
      >("../../src/Effects/Token");
      realFetchTokenPrice = actual.fetchTokenPrice;
    });

    it("should fetch token price from V3, V4 and V2 oracles", async () => {
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
          oracleType: PriceOracleType.V4,
          functionName: "getManyRatesWithCustomConnectors",
          result: [
            "0x0000000000000000000000000000000000000000000000000000000000000003",
          ],
          expectedPrice: 3n,
          expectedType: PriceOracleType.V4,
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
        vi.mocked(mockEthClient.readContract).mockResolvedValue(
          testCase.result as unknown as readonly bigint[],
        );

        const result = await realFetchTokenPrice(
          TEST_TOKEN_ADDRESS,
          TEST_USDC_ADDRESS,
          TEST_SYSTEM_TOKEN,
          TEST_SYSTEM_TOKEN,
          [],
          TEST_CHAIN_ID,
          TEST_BLOCK_NUMBER,
          mockEthClient,
        );

        expect(result).toEqual({
          pricePerUSDNew: testCase.expectedPrice,
          priceOracleType: testCase.expectedType,
        });
        const callArgs = vi.mocked(mockEthClient.readContract).mock.calls[0][0];
        expect(callArgs.functionName).toBe(testCase.functionName);
        vi.mocked(mockEthClient.readContract).mockClear();
      }
    });

    it("should throw on contract call errors (retries handled by RpcGateway)", async () => {
      setupChainConstants(PriceOracleType.V2);
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("Oracle call failed"),
      );

      await expect(
        realFetchTokenPrice(
          TEST_TOKEN_ADDRESS,
          TEST_USDC_ADDRESS,
          TEST_SYSTEM_TOKEN,
          TEST_SYSTEM_TOKEN,
          [],
          TEST_CHAIN_ID,
          TEST_BLOCK_NUMBER,
          mockEthClient,
        ),
      ).rejects.toThrow("Oracle call failed");
      expect(mockEthClient.readContract).toHaveBeenCalledTimes(1);
    });

    it("should throw on out of gas errors (no retry in fetcher)", async () => {
      setupChainConstants(PriceOracleType.V2);
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("out of gas: gas required exceeds: 1000000"),
      );

      await expect(
        realFetchTokenPrice(
          TEST_TOKEN_ADDRESS,
          TEST_USDC_ADDRESS,
          TEST_SYSTEM_TOKEN,
          TEST_SYSTEM_TOKEN,
          [],
          TEST_CHAIN_ID,
          TEST_BLOCK_NUMBER,
          mockEthClient,
        ),
      ).rejects.toThrow("out of gas");
      expect(mockEthClient.readContract).toHaveBeenCalledTimes(1);
    });

    it("should throw on rate limit error (retries are in runWithRpcRetry)", async () => {
      setupChainConstants(PriceOracleType.V2);
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("rate limit exceeded"),
      );

      await expect(
        realFetchTokenPrice(
          TEST_TOKEN_ADDRESS,
          TEST_USDC_ADDRESS,
          TEST_SYSTEM_TOKEN,
          TEST_SYSTEM_TOKEN,
          [],
          TEST_CHAIN_ID,
          TEST_BLOCK_NUMBER,
          mockEthClient,
        ),
      ).rejects.toThrow("rate limit exceeded");
      expect(mockEthClient.readContract).toHaveBeenCalledTimes(1);
    });

    it("should throw on contract revert (no retry in fetcher)", async () => {
      setupChainConstants(PriceOracleType.V2);
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("execution reverted"),
      );

      await expect(
        realFetchTokenPrice(
          TEST_TOKEN_ADDRESS,
          TEST_USDC_ADDRESS,
          TEST_SYSTEM_TOKEN,
          TEST_SYSTEM_TOKEN,
          [],
          TEST_CHAIN_ID,
          TEST_BLOCK_NUMBER,
          mockEthClient,
        ),
      ).rejects.toThrow("execution reverted");
      expect(mockEthClient.readContract).toHaveBeenCalledTimes(1);
    });

    it("should return result for slow successful requests (V3 and V2); slow-request logging is in RpcGateway", async () => {
      const testCases = [
        { oracleType: PriceOracleType.V3 },
        { oracleType: PriceOracleType.V2 },
      ];

      for (const { oracleType } of testCases) {
        setupChainConstants(oracleType);
        const restoreDateNow = mockSlowDateNow(6000);
        vi.mocked(mockEthClient.readContract).mockResolvedValue(
          TEST_PRICE_RESULT as unknown as readonly bigint[],
        );

        const result = await realFetchTokenPrice(
          TEST_TOKEN_ADDRESS,
          TEST_USDC_ADDRESS,
          TEST_SYSTEM_TOKEN,
          TEST_SYSTEM_TOKEN,
          [],
          TEST_CHAIN_ID,
          TEST_BLOCK_NUMBER,
          mockEthClient,
        );

        expect(result.pricePerUSDNew).toBeDefined();
        restoreDateNow();
        vi.mocked(mockEthClient.readContract).mockClear();
      }
    });

    it("should throw for slow failed requests; slow-request logging is in RpcGateway", async () => {
      setupChainConstants(PriceOracleType.V3);
      const restoreDateNow = mockSlowDateNow(6000);
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("network error"),
      );

      await expect(
        realFetchTokenPrice(
          TEST_TOKEN_ADDRESS,
          TEST_USDC_ADDRESS,
          TEST_SYSTEM_TOKEN,
          TEST_SYSTEM_TOKEN,
          [],
          TEST_CHAIN_ID,
          TEST_BLOCK_NUMBER,
          mockEthClient,
        ),
      ).rejects.toThrow("network error");
      restoreDateNow();
    });

    it("should return result for very slow successful requests; very-slow logging is in RpcGateway", async () => {
      setupChainConstants(PriceOracleType.V2);
      const restoreDateNow = mockSlowDateNow(1000, 35000);
      vi.mocked(mockEthClient.readContract).mockResolvedValue(
        TEST_PRICE_RESULT as unknown as readonly bigint[],
      );

      const result = await realFetchTokenPrice(
        TEST_TOKEN_ADDRESS,
        TEST_USDC_ADDRESS,
        TEST_SYSTEM_TOKEN,
        TEST_SYSTEM_TOKEN,
        [],
        TEST_CHAIN_ID,
        TEST_BLOCK_NUMBER,
        mockEthClient,
      );

      expect(result.pricePerUSDNew).toBeDefined();
      restoreDateNow();
    });
  });
});
