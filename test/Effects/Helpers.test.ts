import { vi } from "vitest";

// Mock Helpers before RpcGateway is loaded so runWithRpcRetry uses the mocked sleep (ESM closure).
vi.mock("../../src/Effects/Helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/Effects/Helpers")>();
  return {
    ...actual,
    sleep: vi.fn().mockImplementation((ms: number) => actual.sleep(ms)),
  };
});

import {
  ErrorType,
  createReadableError,
  getErrorType,
  handleEffectErrorReturn,
  sleep,
} from "../../src/Effects/Helpers";
import { runWithRpcRetry } from "../../src/Effects/RpcGateway";

// Common test constants
const TEST_EFFECT_NAME = "testEffect";
const TEST_CONTEXT = "[testContext]";
const TEST_DETAILS = { chainId: 10, blockNumber: 12345 };
const TEST_FALLBACK_VALUE = 0n;

describe("Helpers", () => {
  describe("getErrorType", () => {
    it("should return correct error types for different error messages", () => {
      const testCases = [
        { error: "Rate limit exceeded", expected: ErrorType.RATE_LIMIT },
        { error: "HTTP 429 Too Many Requests", expected: ErrorType.RATE_LIMIT },
        {
          error: "Too many requests per second",
          expected: ErrorType.RATE_LIMIT,
        },
        { error: "Transaction reverted", expected: ErrorType.CONTRACT_REVERT },
        { error: "execution reverted", expected: ErrorType.CONTRACT_REVERT },
        { error: "Contract revert", expected: ErrorType.CONTRACT_REVERT },
        { error: "Network error", expected: ErrorType.NETWORK_ERROR },
        { error: "Connection error", expected: ErrorType.NETWORK_ERROR },
        {
          error: "Temporary internal error. Please retry",
          expected: ErrorType.NETWORK_ERROR,
        },
        { error: "Something went wrong", expected: ErrorType.UNKNOWN },
      ];

      for (const { error, expected } of testCases) {
        // Pass string for UNKNOWN so stack trace doesn't add "error" and match NETWORK_ERROR
        const input =
          expected === ErrorType.UNKNOWN ? error : new Error(error as string);
        expect(getErrorType(input)).toBe(expected);
      }
    });

    it("should return UNKNOWN for null, undefined, or unrecognized errors", () => {
      expect(getErrorType(null)).toBe(ErrorType.UNKNOWN);
      expect(getErrorType(undefined)).toBe(ErrorType.UNKNOWN);
      expect(getErrorType("Something went wrong")).toBe(ErrorType.UNKNOWN);
    });

    it("should return first matching ErrorType when message matches multiple patterns", () => {
      // "rate limit" and "network error" both match; RATE_LIMIT is checked before NETWORK_ERROR in ERROR_KEYWORDS
      expect(getErrorType(new Error("rate limit network error"))).toBe(
        ErrorType.RATE_LIMIT,
      );
    });
  });

  describe("sleep", () => {
    it("should resolve after the specified time", async () => {
      const start = Date.now();
      await sleep(100);
      const end = Date.now();
      const elapsed = end - start;

      expect(elapsed).toBeGreaterThanOrEqual(90);
      expect(elapsed).toBeLessThan(150);
    });

    it("should resolve immediately for 0ms", async () => {
      const start = Date.now();
      await sleep(0);
      const end = Date.now();
      const elapsed = end - start;

      expect(elapsed).toBeLessThan(20);
    });

    it("should return a Promise", () => {
      expect(sleep(100)).toBeInstanceOf(Promise);
    });

    it("should handle longer sleep durations", async () => {
      const start = Date.now();
      await sleep(200);
      const end = Date.now();
      const elapsed = end - start;

      expect(elapsed).toBeGreaterThanOrEqual(190);
      expect(elapsed).toBeLessThan(250);
    });
  });

  describe("createReadableError", () => {
    it("should create error with context and details from Error instance", () => {
      const originalError = new Error("Original error message");
      originalError.stack = "Error stack trace";
      const details = { key1: "value1", key2: 123 };

      const result = createReadableError(originalError, TEST_CONTEXT, details);

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain(TEST_CONTEXT);
      expect(result.message).toContain("key1=value1");
      expect(result.message).toContain("key2=123");
      expect(result.message).toContain("Original error message");
      expect(result.stack).toBe("Error stack trace");
    });

    it("should create error from non-Error value", () => {
      const nonErrorValue = "string error";

      const result = createReadableError(nonErrorValue, TEST_CONTEXT, {
        key: "value",
      });

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain(TEST_CONTEXT);
      expect(result.message).toContain("key=value");
      expect(result.message).toContain("string error");
      expect(result.stack).toBeDefined();
      expect(result.stack).toContain("createReadableError");
    });
  });

  describe("handleEffectErrorReturn", () => {
    it("should log error and return fallback value", () => {
      const error = new Error("Test error");
      const mockLog = { error: vi.fn() };
      const context = { cache: true, log: mockLog };

      const result = handleEffectErrorReturn(
        error,
        context,
        TEST_EFFECT_NAME,
        TEST_DETAILS,
        TEST_FALLBACK_VALUE,
      );

      expect(result).toBe(TEST_FALLBACK_VALUE);
      expect(context.cache).toBe(false);
      expect(mockLog.error).toHaveBeenCalledTimes(1);
      const errorCall = mockLog.error.mock.calls[0];
      expect(errorCall[0]).toContain(`[${TEST_EFFECT_NAME}]`);
      expect(errorCall[0]).toContain("chainId=10");
      expect(errorCall[0]).toContain("blockNumber=12345");
      expect(errorCall[1]).toBeInstanceOf(Error);
    });
  });

  describe("runWithRpcRetry", () => {
    beforeEach(() => {
      vi.mocked(sleep).mockResolvedValue(undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should return result on first success", async () => {
      const fn = vi.fn().mockResolvedValue(42);
      const result = await runWithRpcRetry(fn);
      expect(result).toBe(42);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on RATE_LIMIT then succeed", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("rate limit exceeded"))
        .mockResolvedValueOnce(100n);
      const result = await runWithRpcRetry(fn);
      expect(result).toBe(100n);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should retry on NETWORK_ERROR across multiple attempts then succeed", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("Temporary internal error. Please retry"),
        )
        .mockRejectedValueOnce(new Error("connection error"))
        .mockRejectedValueOnce(new Error("socket hang up"))
        .mockResolvedValueOnce(99n);
      const result = await runWithRpcRetry(fn);
      expect(result).toBe(99n);
      expect(fn).toHaveBeenCalledTimes(4);
    });

    it("should not retry on CONTRACT_REVERT", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("execution reverted"));
      await expect(runWithRpcRetry(fn)).rejects.toThrow("execution reverted");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should throw after max retries exhausted", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("rate limit exceeded"));
      await expect(runWithRpcRetry(fn)).rejects.toThrow("rate limit exceeded");
      expect(fn).toHaveBeenCalledTimes(8); // 1 initial + 7 retries (RPC_APP_RETRY.maxRetries)
    });
  });
});
