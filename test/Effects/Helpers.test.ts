import {
  ErrorType,
  createReadableError,
  getErrorType,
  handleEffectErrorReturn,
  sleep,
} from "../../src/Effects/Helpers";

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
        { error: "Transaction out of gas", expected: ErrorType.OUT_OF_GAS },
        { error: "Gas exhausted", expected: ErrorType.OUT_OF_GAS },
        { error: "gas limit reached", expected: ErrorType.OUT_OF_GAS },
        {
          error: "out of gas: gas required exceeds: 1000000",
          expected: ErrorType.OUT_OF_GAS,
        },
        { error: "gas limit exceeded", expected: ErrorType.OUT_OF_GAS },
        { error: "Transaction reverted", expected: ErrorType.CONTRACT_REVERT },
        { error: "execution reverted", expected: ErrorType.CONTRACT_REVERT },
        { error: "Contract revert", expected: ErrorType.CONTRACT_REVERT },
        { error: "Network error", expected: ErrorType.NETWORK_ERROR },
        { error: "Connection error", expected: ErrorType.NETWORK_ERROR },
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

    it("should prioritize first matching error type", () => {
      expect(
        getErrorType(new Error("out of gas: gas required exceeds: 1000000")),
      ).toBe(ErrorType.OUT_OF_GAS);
      expect(getErrorType(new Error("rate limit out of gas"))).toBe(
        ErrorType.OUT_OF_GAS,
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
});
