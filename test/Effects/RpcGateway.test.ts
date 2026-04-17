import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, toChecksumAddress } from "../../src/Constants";
import * as Helpers from "../../src/Effects/Helpers";
import { rpcGateway } from "../../src/Effects/RpcGateway";
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
      });
      expect(mockContext.log.error).toHaveBeenCalledTimes(1);
      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining("rpcGateway.getTokenDetails"),
        expect.any(Error),
      );
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

      expect(result).toEqual({ name: "", decimals: 18, symbol: "" });
      expect(mockContext.log.warn).not.toHaveBeenCalled();
      expect(mockContext.log.error).toHaveBeenCalledTimes(1);
      const [, loggedError] = vi.mocked(mockContext.log.error).mock.calls[0];
      expect(loggedError).toBeInstanceOf(Error);
      expect((loggedError as Error).stack).toContain("viem/internal/rpc-call");
    });

    it("should emit no failed-slow-request log when the RPC fails", async () => {
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

      // Non-retryable error surfaces exactly one uerror via executeRpcWithFallback;
      // no "Very slow failed request" extra log line.
      expect(mockContext.log.error).toHaveBeenCalledTimes(1);
      const errorMessages = vi
        .mocked(mockContext.log.error)
        .mock.calls.map((c) => c[0]);
      expect(
        errorMessages.some((m) => m.includes("Very slow failed request")),
      ).toBe(false);
      expect(mockContext.log.warn).not.toHaveBeenCalled();
    });
  });
});
