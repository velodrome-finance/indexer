import type { PublicClient } from "viem";
import {
  CHAIN_CONSTANTS,
  createFallbackRpcClient,
  toChecksumAddress,
} from "../../src/Constants";
import * as Helpers from "../../src/Effects/Helpers";
import {
  executeRpcWithFallback,
  rpcGateway,
} from "../../src/Effects/RpcGateway";
import {
  type MockEffect,
  type MockEffectContext,
  createMockEffectContext,
} from "./setup";

const TEST_CHAIN_ID = 10;
const TEST_CONTRACT_ADDRESS = toChecksumAddress(
  "0x1234567890123456789012345678901234567890",
);

describe("RpcGateway", () => {
  let mockContext: MockEffectContext;
  let mockEthClient: PublicClient;
  let originalChainEntry: (typeof CHAIN_CONSTANTS)[typeof TEST_CHAIN_ID];

  beforeEach(() => {
    vi.spyOn(Helpers, "sleep").mockResolvedValue(undefined);

    mockEthClient = {
      readContract: vi.fn(),
      getCode: vi.fn(),
    } as unknown as PublicClient;

    originalChainEntry = CHAIN_CONSTANTS[TEST_CHAIN_ID];
    (
      CHAIN_CONSTANTS as Record<
        number,
        { eth_client: PublicClient; lpHelperAddress?: string }
      >
    )[TEST_CHAIN_ID] = {
      eth_client: mockEthClient,
      lpHelperAddress: toChecksumAddress(
        "0x2F44BD0Aff1826aec123cE3eA9Ce44445b64BB34",
      ),
    };

    mockContext = createMockEffectContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalChainEntry !== undefined) {
      CHAIN_CONSTANTS[TEST_CHAIN_ID] = originalChainEntry;
    } else {
      delete (CHAIN_CONSTANTS as Record<number, unknown>)[TEST_CHAIN_ID];
    }
  });

  describe("rpcGateway effect handler", () => {
    it("should return token details on getTokenDetails success", async () => {
      const readContract = vi.mocked(mockEthClient.readContract);
      readContract
        .mockResolvedValueOnce("Test Token")
        .mockResolvedValueOnce(18)
        .mockResolvedValueOnce("TKN");

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "getTokenDetails",
          chainId: TEST_CHAIN_ID,
          contractAddress: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      expect(result).toMatchObject({
        name: "Test Token",
        decimals: 18,
        symbol: "TKN",
        usedDefault: false,
        errorClass: undefined,
      });
      expect(readContract).toHaveBeenCalledTimes(3);
    });

    it("should return fallback for getTokenDetails when RPC throws (executeRpcWithFallback path)", async () => {
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("execution reverted"),
      );

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "getTokenDetails",
          chainId: TEST_CHAIN_ID,
          contractAddress: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      expect(result).toEqual({
        name: "",
        decimals: 18,
        symbol: "",
        usedDefault: true,
        errorClass: Helpers.ErrorType.CONTRACT_REVERT,
      });
      // Revert is logged (log level differentiation is cycle 8).
      expect(
        (mockContext.log.error as ReturnType<typeof vi.fn>).mock.calls.length +
          (mockContext.log.warn as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
    });

    it("returns hasCode=true when getCode returns deployed bytecode and decimals() returns a valid uint8 (issues #677 / #736 gate)", async () => {
      vi.mocked(
        mockEthClient.getCode as unknown as ReturnType<typeof vi.fn>,
      ).mockResolvedValue("0x60806040");
      vi.mocked(mockEthClient.readContract).mockResolvedValue(
        18 as unknown as never,
      );

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "hasContractBytecode",
          chainId: TEST_CHAIN_ID,
          address: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      expect(result).toEqual({
        hasCode: true,
        usedDefault: false,
        errorClass: undefined,
      });
    });

    it("returns hasCode=false when bytecode exists but decimals() reverts (issue #736 non-ERC20 gate)", async () => {
      vi.mocked(
        mockEthClient.getCode as unknown as ReturnType<typeof vi.fn>,
      ).mockResolvedValue("0x60806040");
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("execution reverted"),
      );

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "hasContractBytecode",
          chainId: TEST_CHAIN_ID,
          address: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      expect(result).toEqual({
        hasCode: false,
        usedDefault: false,
        errorClass: undefined,
      });
    });

    it("returns hasCode=false when getCode returns 0x (EOA / non-contract)", async () => {
      vi.mocked(
        mockEthClient.getCode as unknown as ReturnType<typeof vi.fn>,
      ).mockResolvedValue("0x");

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "hasContractBytecode",
          chainId: TEST_CHAIN_ID,
          address: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      expect(result).toEqual({
        hasCode: false,
        usedDefault: false,
        errorClass: undefined,
      });
    });

    it("fails open (hasCode=true) when getCode RPC throws", async () => {
      vi.mocked(
        mockEthClient.getCode as unknown as ReturnType<typeof vi.fn>,
      ).mockRejectedValue(new Error("network error"));

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "hasContractBytecode",
          chainId: TEST_CHAIN_ID,
          address: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      expect(result).toEqual({
        hasCode: true,
        usedDefault: true,
        errorClass: Helpers.ErrorType.NETWORK_ERROR,
      });
    });

    it("should log and return undefined for unexpected input type (default branch)", async () => {
      const badInput = {
        type: "unexpectedType",
        chainId: TEST_CHAIN_ID,
      } as unknown as Parameters<MockEffect["handler"]>[0]["input"];

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: badInput,
        context: mockContext,
      });

      expect(result).toBeUndefined();
      expect(mockContext.log.error).toHaveBeenCalledTimes(1);
      expect(mockContext.log.error).toHaveBeenCalledWith(
        "rpcGateway: unexpected input type",
        expect.any(Error),
      );
    });

    it("should not log slow successful requests (latency covered by /metrics)", async () => {
      const readContract = vi.mocked(mockEthClient.readContract);
      readContract
        .mockResolvedValueOnce("Slow")
        .mockResolvedValueOnce(18)
        .mockResolvedValueOnce("TKN");

      // Simulate a request that takes longer than any slow-request threshold.
      const t0 = 1000000;
      const slowMs = 60000;
      let dateNowCalls = 0;
      vi.spyOn(Date, "now").mockImplementation(() =>
        ++dateNowCalls === 1 ? t0 : t0 + slowMs,
      );

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "getTokenDetails",
          chainId: TEST_CHAIN_ID,
          contractAddress: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      expect(result).toMatchObject({
        name: "Slow",
        decimals: 18,
        symbol: "TKN",
        usedDefault: false,
      });
      expect(mockContext.log.warn).not.toHaveBeenCalled();
      expect(mockContext.log.error).not.toHaveBeenCalled();
    });

    it("should emit no intermediate log for a retry that ultimately succeeds", async () => {
      // First attempt rejects the `name` call (triggers whole-Promise.all rejection and retry).
      // All subsequent calls succeed, so the retry returns clean results.
      let firstNameCall = true;
      vi.mocked(mockEthClient.readContract).mockImplementation(
        ({ functionName }: { functionName: string }) => {
          if (functionName === "name") {
            if (firstNameCall) {
              firstNameCall = false;
              return Promise.reject(new Error("rate limit exceeded"));
            }
            return Promise.resolve("OkToken");
          }
          if (functionName === "decimals") return Promise.resolve(18);
          if (functionName === "symbol") return Promise.resolve("OK");
          return Promise.reject(new Error("unexpected call"));
        },
      );

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "getTokenDetails",
          chainId: TEST_CHAIN_ID,
          contractAddress: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      expect(result).toMatchObject({
        name: "OkToken",
        decimals: 18,
        symbol: "OK",
        usedDefault: false,
      });
      expect(mockContext.log.warn).not.toHaveBeenCalled();
      expect(mockContext.log.error).not.toHaveBeenCalled();
    });

    it("should emit exactly one error with stack trace when retries are exhausted", async () => {
      const err = new Error("rate limit exceeded");
      err.stack =
        "Error: rate limit exceeded\n    at viem/internal/rpc-call.ts:42";
      vi.mocked(mockEthClient.readContract).mockRejectedValue(err);

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "getTokenDetails",
          chainId: TEST_CHAIN_ID,
          contractAddress: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      expect(result).toEqual({
        name: "",
        decimals: 18,
        symbol: "",
        usedDefault: true,
        errorClass: Helpers.ErrorType.RATE_LIMIT,
      });
      expect(mockContext.log.warn).not.toHaveBeenCalled();
      expect(mockContext.log.error).toHaveBeenCalledTimes(1);
      const [, loggedError] = vi.mocked(mockContext.log.error).mock.calls[0];
      expect(loggedError).toBeInstanceOf(Error);
      expect((loggedError as Error).stack).toContain("viem/internal/rpc-call");
    });

    it("should emit no failed-slow-request log when the RPC fails", async () => {
      // Revert is a deterministic class — issue #692 logs these via warn,
      // not error — and the test simulates a slow failed request to verify
      // no "Very slow failed request" line piggybacks on top.
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("execution reverted"),
      );

      // Simulate a failed request that took a long time.
      const t0 = 1000000;
      const slowMs = 60000;
      let dateNowCalls = 0;
      vi.spyOn(Date, "now").mockImplementation(() =>
        ++dateNowCalls === 1 ? t0 : t0 + slowMs,
      );

      await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "getTokenDetails",
          chainId: TEST_CHAIN_ID,
          contractAddress: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      // Revert goes through warn (#692); no extra "Very slow failed request" line.
      expect(mockContext.log.warn).toHaveBeenCalledTimes(1);
      const warnMessages = vi
        .mocked(mockContext.log.warn)
        .mock.calls.map((c) => c[0]);
      expect(
        warnMessages.some((m) => m.includes("Very slow failed request")),
      ).toBe(false);
      expect(mockContext.log.error).not.toHaveBeenCalled();
    });
  });

  describe("executeRpcWithFallback", () => {
    const METHOD_ERR = new Error(
      'the method "eth_call" does not exist / is not available',
    );
    const REVERT_ERR = new Error("execution reverted");
    const STATIC_FALLBACK = { name: "", decimals: 18, symbol: "" };

    it("returns usedDefault:false when primary RPC succeeds", async () => {
      const primary = vi
        .fn()
        .mockResolvedValue({ name: "Real", decimals: 6, symbol: "REAL" });

      const result = await executeRpcWithFallback(
        mockContext,
        "op",
        { chainId: 1868 },
        STATIC_FALLBACK,
        primary,
      );

      expect(result).toMatchObject({
        value: { name: "Real", decimals: 6, symbol: "REAL" },
        usedDefault: false,
        errorClass: undefined,
      });
    });

    it("uses fallbackFn when primary exhausts retries on METHOD_NOT_SUPPORTED", async () => {
      const primary = vi.fn().mockRejectedValue(METHOD_ERR);
      const fallbackFn = vi
        .fn()
        .mockResolvedValue({ name: "X", decimals: 6, symbol: "X" });

      const result = await executeRpcWithFallback(
        mockContext,
        "op",
        { chainId: 1868 },
        STATIC_FALLBACK,
        primary,
        fallbackFn,
      );

      expect(result).toMatchObject({
        value: { name: "X", decimals: 6, symbol: "X" },
        usedDefault: false,
        errorClass: undefined,
      });
      // Primary retried up to methodNotSupportedMaxRetries (2) then handed off.
      expect(primary).toHaveBeenCalledTimes(3);
      expect(fallbackFn).toHaveBeenCalledTimes(1);
      // Hand-off warn mentions the error type we're falling back on.
      expect(mockContext.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("METHOD_NOT_SUPPORTED"),
      );
    });

    it("returns usedDefault:true when primary fails with a non-fallback-worthy error", async () => {
      const primary = vi.fn().mockRejectedValue(REVERT_ERR);
      const fallbackFn = vi.fn();

      const result = await executeRpcWithFallback(
        mockContext,
        "op",
        { chainId: 1868 },
        STATIC_FALLBACK,
        primary,
        fallbackFn,
      );

      expect(result).toMatchObject({
        value: STATIC_FALLBACK,
        usedDefault: true,
      });
      expect(fallbackFn).not.toHaveBeenCalled();
    });

    it("returns usedDefault:true when both primary and fallbackFn fail", async () => {
      const primary = vi.fn().mockRejectedValue(METHOD_ERR);
      const fallbackFn = vi.fn().mockRejectedValue(METHOD_ERR);

      const result = await executeRpcWithFallback(
        mockContext,
        "op",
        { chainId: 1868 },
        STATIC_FALLBACK,
        primary,
        fallbackFn,
      );

      expect(result).toMatchObject({
        value: STATIC_FALLBACK,
        usedDefault: true,
      });
      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining("op.fallback"),
        expect.any(Error),
      );
    });

    it("returns usedDefault:true when no fallbackFn is provided and primary fails", async () => {
      const primary = vi.fn().mockRejectedValue(METHOD_ERR);

      const result = await executeRpcWithFallback(
        mockContext,
        "op",
        { chainId: 1868 },
        STATIC_FALLBACK,
        primary,
      );

      expect(result).toMatchObject({
        value: STATIC_FALLBACK,
        usedDefault: true,
      });
    });

    it("returns errorClass:CONTRACT_REVERT when primary throws a deterministic revert", async () => {
      const primary = vi.fn().mockRejectedValue(REVERT_ERR);

      const result = await executeRpcWithFallback(
        mockContext,
        "op",
        { chainId: 1868 },
        STATIC_FALLBACK,
        primary,
      );

      expect(result.usedDefault).toBe(true);
      expect(result.errorClass).toBe(Helpers.ErrorType.CONTRACT_REVERT);
    });

    it("returns errorClass for the transient class when both primary and fallback are exhausted", async () => {
      const primary = vi.fn().mockRejectedValue(METHOD_ERR);
      const fallbackFn = vi.fn().mockRejectedValue(METHOD_ERR);

      const result = await executeRpcWithFallback(
        mockContext,
        "op",
        { chainId: 1868 },
        STATIC_FALLBACK,
        primary,
        fallbackFn,
      );

      expect(result.usedDefault).toBe(true);
      expect(result.errorClass).toBe(Helpers.ErrorType.METHOD_NOT_SUPPORTED);
    });

    it("logs a CONTRACT_REVERT fallback via log.warn, not log.error (issue #692)", async () => {
      const primary = vi.fn().mockRejectedValue(REVERT_ERR);

      await executeRpcWithFallback(
        mockContext,
        "op",
        { chainId: 1868 },
        STATIC_FALLBACK,
        primary,
      );

      expect(mockContext.log.warn).toHaveBeenCalled();
      expect(mockContext.log.error).not.toHaveBeenCalled();
    });

    it("logs a transient exhaustion via log.error, not log.warn", async () => {
      // METHOD_NOT_SUPPORTED is non-revert; exhausted primary + fallback should
      // still surface as a true error so on-call gets paged on upstream outages.
      const primary = vi.fn().mockRejectedValue(METHOD_ERR);
      const fallbackFn = vi.fn().mockRejectedValue(METHOD_ERR);

      await executeRpcWithFallback(
        mockContext,
        "op",
        { chainId: 1868 },
        STATIC_FALLBACK,
        primary,
        fallbackFn,
      );

      expect(mockContext.log.error).toHaveBeenCalled();
    });

    it("leaves errorClass unset on success", async () => {
      const primary = vi
        .fn()
        .mockResolvedValue({ name: "Real", decimals: 6, symbol: "REAL" });

      const result = await executeRpcWithFallback(
        mockContext,
        "op",
        { chainId: 1868 },
        STATIC_FALLBACK,
        primary,
      );

      expect(result.usedDefault).toBe(false);
      expect(result.errorClass).toBeUndefined();
    });
  });

  describe("createFallbackRpcClient", () => {
    it("returns a client for a supported chain (Soneium)", () => {
      const client = createFallbackRpcClient(1868);
      expect(client).not.toBeNull();
      expect(client?.chain?.id).toBe(1868);
    });

    it("returns null for an unsupported chain", () => {
      expect(createFallbackRpcClient(99999)).toBeNull();
    });

    it("caches the client across calls for the same chainId", () => {
      const a = createFallbackRpcClient(1868);
      const b = createFallbackRpcClient(1868);
      expect(a).toBe(b);
    });
  });

  // Issue #763: USDe (0x5d3a1Ff2…) was registered with createdBlock=1, so the
  // RpcGateway connector filter (c.createdBlock <= blockNumber) kept it in the
  // V1 connector list for the entire Base pre-deploy window (3219857..15768547).
  // The V1 oracle's path-finder then reverted on the empty USDe address, zeroing
  // pricePerUSDNew for whitelisted Base tokens (TOSHI, DEGEN, BRETT, HIGHER, …)
  // during Aug 2023 → Mar 2024. This test locks the createdBlock fix in place.
  describe("Base price_connectors USDe deploy-block gate (#763)", () => {
    const BASE_CHAIN_ID = 8453;
    const USDE_ADDRESS = toChecksumAddress(
      "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
    );
    const USDE_DEPLOY_BLOCK = 15768548;
    const PRE_DEPLOY_BLOCK = 15293733;

    const filteredAddresses = (blockNumber: number) =>
      CHAIN_CONSTANTS[BASE_CHAIN_ID].oracle.priceConnectors
        .filter((c) => c.createdBlock <= blockNumber)
        .map((c) => c.address);

    it("strips USDe from connectors at a Base pre-deploy block", () => {
      expect(filteredAddresses(PRE_DEPLOY_BLOCK)).not.toContain(USDE_ADDRESS);
    });

    it("strips USDe one block before its deploy block", () => {
      expect(filteredAddresses(USDE_DEPLOY_BLOCK - 1)).not.toContain(
        USDE_ADDRESS,
      );
    });

    it("includes USDe at its deploy block and after", () => {
      expect(filteredAddresses(USDE_DEPLOY_BLOCK)).toContain(USDE_ADDRESS);
    });
  });
});
