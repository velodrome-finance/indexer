import * as ConstantsModule from "../../src/Constants";
import {
  createFallbackClient,
  shouldUseFallbackRPC,
} from "../../src/Effects/Errors";

describe("Errors", () => {
  describe("createFallbackClient", () => {
    it("should return null when no public RPC URL is available", () => {
      const result = createFallbackClient(99999);
      expect(result).toBeNull();
    });

    it("should return null when chain ID is not in chainIdToChain map", () => {
      const getDefaultRPCSpy = jest
        .spyOn(ConstantsModule, "getDefaultRPCByChainId")
        .mockReturnValue("https://rpc.example.com");

      const result = createFallbackClient(1);
      expect(result).toBeNull();

      getDefaultRPCSpy.mockRestore();
    });
  });

  describe("shouldUseFallbackRPC", () => {
    it("should return true for historical state errors", () => {
      const testCases = [
        "historical state is not available",
        "state histories haven't been fully indexed",
        "state histories",
        "Missing or invalid parameters: state histories",
      ];

      for (const message of testCases) {
        expect(shouldUseFallbackRPC(new Error(message))).toBe(true);
      }
    });

    it("should return true for temporary RPC errors", () => {
      const testCases = [
        "Temporary internal error",
        "RPC Request failed",
        "Please retry",
      ];

      for (const message of testCases) {
        expect(shouldUseFallbackRPC(new Error(message))).toBe(true);
      }
    });

    it("should return true for rate limit/timeout errors", () => {
      const testCases = ["rate limit exceeded", "request timeout", "ETIMEDOUT"];

      for (const message of testCases) {
        expect(shouldUseFallbackRPC(new Error(message))).toBe(true);
      }
    });

    it("should return false for other errors", () => {
      const testCases = ["Some other error", "Contract reverted"];

      for (const message of testCases) {
        expect(shouldUseFallbackRPC(new Error(message))).toBe(false);
      }
    });

    it("should handle non-Error values", () => {
      expect(shouldUseFallbackRPC("rate limit exceeded")).toBe(true);
      expect(shouldUseFallbackRPC("historical state not available")).toBe(true);
      expect(shouldUseFallbackRPC("Some other error")).toBe(false);
    });
  });
});
