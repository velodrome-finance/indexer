import { expect } from "chai";
import { ErrorType, getErrorType, sleep } from "../../src/Effects/Helpers";

describe("Helpers", () => {
  describe("getErrorType", () => {
    it("should return RATE_LIMIT for rate limit errors", () => {
      expect(getErrorType(new Error("Rate limit exceeded"))).to.equal(
        ErrorType.RATE_LIMIT,
      );
      expect(getErrorType(new Error("HTTP 429 Too Many Requests"))).to.equal(
        ErrorType.RATE_LIMIT,
      );
      expect(getErrorType("Too many requests per second")).to.equal(
        ErrorType.RATE_LIMIT,
      );
    });

    it("should return OUT_OF_GAS for gas errors", () => {
      expect(getErrorType(new Error("Transaction out of gas"))).to.equal(
        ErrorType.OUT_OF_GAS,
      );
      expect(getErrorType(new Error("Gas exhausted"))).to.equal(
        ErrorType.OUT_OF_GAS,
      );
      expect(getErrorType("gas limit reached")).to.equal(ErrorType.OUT_OF_GAS);
      expect(
        getErrorType(new Error("out of gas: gas required exceeds: 1000000")),
      ).to.equal(ErrorType.OUT_OF_GAS);
      expect(getErrorType(new Error("gas limit exceeded"))).to.equal(
        ErrorType.OUT_OF_GAS,
      );
    });

    it("should return CONTRACT_REVERT for revert errors", () => {
      expect(getErrorType(new Error("Transaction reverted"))).to.equal(
        ErrorType.CONTRACT_REVERT,
      );
      expect(getErrorType(new Error("execution reverted"))).to.equal(
        ErrorType.CONTRACT_REVERT,
      );
      expect(getErrorType("Contract revert")).to.equal(
        ErrorType.CONTRACT_REVERT,
      );
    });

    it("should return NETWORK_ERROR for network errors", () => {
      expect(getErrorType(new Error("Network error"))).to.equal(
        ErrorType.NETWORK_ERROR,
      );

      expect(getErrorType(new Error("Connection error"))).to.equal(
        ErrorType.NETWORK_ERROR,
      );
    });

    it("should return UNKNOWN for unrecognized errors", () => {
      expect(getErrorType(new Error("Some random error"))).to.equal(
        ErrorType.UNKNOWN,
      );
    });

    it("should return UNKNOWN for null or undefined", () => {
      expect(getErrorType(null)).to.equal(ErrorType.UNKNOWN);
      expect(getErrorType(undefined)).to.equal(ErrorType.UNKNOWN);
    });

    it("should prioritize first matching error type", () => {
      // If an error matches multiple types, it should return the first one checked
      // The order is: OUT_OF_GAS, CONTRACT_REVERT, RATE_LIMIT (most specific first)
      const error1 = new Error("out of gas: gas required exceeds: 1000000");
      expect(getErrorType(error1)).to.equal(ErrorType.OUT_OF_GAS);

      // Even if it contains "exceeds", OUT_OF_GAS should match first
      const error2 = new Error("out of gas: gas required exceeds");
      expect(getErrorType(error2)).to.equal(ErrorType.OUT_OF_GAS);

      // If it's ambiguous, OUT_OF_GAS takes priority
      const error3 = new Error("rate limit out of gas");
      expect(getErrorType(error3)).to.equal(ErrorType.OUT_OF_GAS);
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
