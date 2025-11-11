import { expect } from "chai";
import {
  isContractRevertError,
  isOutOfGasError,
  isRateLimitError,
  sleep,
} from "../../src/Effects/Helpers";

describe("Helpers", () => {
  describe("isRateLimitError", () => {
    it("should return true for rate limit error in message", () => {
      const error = new Error("Rate limit exceeded");
      expect(isRateLimitError(error)).to.be.true;
    });

    it("should return true for '429' status code in message", () => {
      const error = new Error("HTTP 429 Too Many Requests");
      expect(isRateLimitError(error)).to.be.true;
    });

    it("should return true for 'requests per second' in message", () => {
      const error = new Error("Too many requests per second");
      expect(isRateLimitError(error)).to.be.true;
    });

    it("should return true for rate limit in stack trace", () => {
      const error = new Error("Some error");
      error.stack = "Error: Some error\n  at rate limit handler";
      expect(isRateLimitError(error)).to.be.true;
    });

    it("should return true for case-insensitive matches", () => {
      const error = new Error("RATE LIMIT EXCEEDED");
      expect(isRateLimitError(error)).to.be.true;
    });

    it("should return false for non-rate-limit errors", () => {
      const error = new Error("Network error");
      expect(isRateLimitError(error)).to.be.false;
    });

    it("should return false for null", () => {
      expect(isRateLimitError(null)).to.be.false;
    });

    it("should return false for undefined", () => {
      expect(isRateLimitError(undefined)).to.be.false;
    });

    it("should handle string errors", () => {
      expect(isRateLimitError("Rate limit exceeded")).to.be.true;
      expect(isRateLimitError("Some other error")).to.be.false;
    });

    it("should handle non-Error objects", () => {
      // Non-Error objects are stringified to "[object Object]" which doesn't contain keywords
      const errorObj = { message: "Rate limit exceeded" };
      expect(isRateLimitError(errorObj)).to.be.false;
    });
  });

  describe("isOutOfGasError", () => {
    it("should return true for 'out of gas' in message", () => {
      const error = new Error("Transaction out of gas");
      expect(isOutOfGasError(error)).to.be.true;
    });

    it("should return true for 'gas exhausted' in message", () => {
      const error = new Error("Gas exhausted during execution");
      expect(isOutOfGasError(error)).to.be.true;
    });

    it("should return true for 'gas limit' in message", () => {
      const error = new Error("Gas limit reached");
      expect(isOutOfGasError(error)).to.be.true;
    });

    it("should return true for out of gas in stack trace", () => {
      const error = new Error("Some error");
      error.stack = "Error: Some error\n  at out of gas handler";
      expect(isOutOfGasError(error)).to.be.true;
    });

    it("should return true for case-insensitive matches", () => {
      const error = new Error("OUT OF GAS");
      expect(isOutOfGasError(error)).to.be.true;
    });

    it("should return false for non-gas errors", () => {
      const error = new Error("Network error");
      expect(isOutOfGasError(error)).to.be.false;
    });

    it("should return false for null", () => {
      expect(isOutOfGasError(null)).to.be.false;
    });

    it("should return false for undefined", () => {
      expect(isOutOfGasError(undefined)).to.be.false;
    });

    it("should handle string errors", () => {
      expect(isOutOfGasError("out of gas")).to.be.true;
      expect(isOutOfGasError("Some other error")).to.be.false;
    });

    it("should handle non-Error objects", () => {
      // Non-Error objects are stringified to "[object Object]" which doesn't contain keywords
      const errorObj = { message: "gas exhausted" };
      expect(isOutOfGasError(errorObj)).to.be.false;
    });
  });

  describe("isContractRevertError", () => {
    it("should return true for 'reverted' in message", () => {
      const error = new Error("Transaction reverted");
      expect(isContractRevertError(error)).to.be.true;
    });

    it("should return true for 'revert' in message", () => {
      const error = new Error("Contract revert");
      expect(isContractRevertError(error)).to.be.true;
    });

    it("should return true for 'execution reverted' in message", () => {
      const error = new Error("Execution reverted");
      expect(isContractRevertError(error)).to.be.true;
    });

    it("should return true for revert in stack trace", () => {
      const error = new Error("Some error");
      error.stack = "Error: Some error\n  at execution reverted";
      expect(isContractRevertError(error)).to.be.true;
    });

    it("should return true for case-insensitive matches", () => {
      const error = new Error("EXECUTION REVERTED");
      expect(isContractRevertError(error)).to.be.true;
    });

    it("should return false for non-revert errors", () => {
      const error = new Error("Network error");
      expect(isContractRevertError(error)).to.be.false;
    });

    it("should return false for null", () => {
      expect(isContractRevertError(null)).to.be.false;
    });

    it("should return false for undefined", () => {
      expect(isContractRevertError(undefined)).to.be.false;
    });

    it("should handle string errors", () => {
      expect(isContractRevertError("execution reverted")).to.be.true;
      expect(isContractRevertError("Some other error")).to.be.false;
    });

    it("should handle non-Error objects", () => {
      // Non-Error objects are stringified to "[object Object]" which doesn't contain keywords
      const errorObj = { message: "reverted" };
      expect(isContractRevertError(errorObj)).to.be.false;
    });
  });

  describe("sleep", () => {
    it("should resolve after the specified time", async () => {
      const start = Date.now();
      await sleep(100);
      const end = Date.now();
      const elapsed = end - start;

      // Allow for some timing variance (should be at least 90ms but less than 150ms)
      expect(elapsed).to.be.at.least(90);
      expect(elapsed).to.be.below(150);
    });

    it("should resolve immediately for 0ms", async () => {
      const start = Date.now();
      await sleep(0);
      const end = Date.now();
      const elapsed = end - start;

      // Should be very fast (less than 10ms)
      expect(elapsed).to.be.below(10);
    });

    it("should return a Promise", () => {
      const result = sleep(100);
      expect(result).to.be.instanceOf(Promise);
    });

    it("should handle longer sleep durations", async () => {
      const start = Date.now();
      await sleep(200);
      const end = Date.now();
      const elapsed = end - start;

      // Allow for some timing variance (should be at least 190ms but less than 250ms)
      expect(elapsed).to.be.at.least(190);
      expect(elapsed).to.be.below(250);
    });
  });
});
