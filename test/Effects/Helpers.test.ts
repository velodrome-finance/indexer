import {
  BaseError,
  HttpRequestError,
  RpcRequestError,
  TimeoutError,
  encodeErrorResult,
  parseAbi,
} from "viem";
import { describe, expect, it } from "vitest";
import {
  ErrorType,
  RPC_ERROR_POLICY,
  describeRpcError,
  getErrorType,
} from "../../src/Effects/Helpers";
import { RpcConfigError } from "../../src/Effects/RpcConfig";
import {
  answeringViemClient,
  captureReadError,
  failingViemClient,
} from "./setup";

const URL = "https://lb.drpc.live/base/SECRETKEYSECRETKEYSECRETKEY";

/** Error exactly as the dRPC balancer returned it on Metal/Optimism, 2026-11-13. */
const INSUFFICIENT_CHANGESETS =
  "insufficient changesets to revert to block #12272400. Available changeset range: 41491212..=41501276";

const classifyRead = async (thrown: unknown) =>
  getErrorType(await captureReadError(failingViemClient(thrown)));

describe("getErrorType (typed viem classification)", () => {
  describe("pruned-node / historical-state errors", () => {
    it("classifies reth 'insufficient changesets' (internal error code) as historical state, not revert", async () => {
      const err = await captureReadError(
        failingViemClient({ code: -32603, message: INSUFFICIENT_CHANGESETS }),
      );
      // viem surfaces it as a revert with the provider text as the reason...
      expect((err as Error).message).toContain(
        "reverted with the following reason",
      );
      expect((err as Error).message).toContain("insufficient changesets");
      // ...but it must not be treated as a deterministic revert.
      expect(getErrorType(err)).toBe(ErrorType.HISTORICAL_STATE_NOT_AVAILABLE);
      expect(
        RPC_ERROR_POLICY[ErrorType.HISTORICAL_STATE_NOT_AVAILABLE],
      ).toEqual({
        retrySameEndpoint: true,
        tryFallback: true,
        cacheableDefault: false,
        fatal: false,
      });
    });

    it("classifies 'insufficient changesets' arriving as code 3 without revert data as historical state", async () => {
      expect(
        await classifyRead({ code: 3, message: INSUFFICIENT_CHANGESETS }),
      ).toBe(ErrorType.HISTORICAL_STATE_NOT_AVAILABLE);
    });

    it("classifies 'insufficient changesets' from an HTTP JSON-RPC response (RpcRequestError) as historical state", async () => {
      const rpcErr = new RpcRequestError({
        body: { method: "eth_call" },
        error: { code: -32603, message: INSUFFICIENT_CHANGESETS },
        url: URL,
      });
      expect(await classifyRead(rpcErr)).toBe(
        ErrorType.HISTORICAL_STATE_NOT_AVAILABLE,
      );
    });

    it.each([
      "missing trie node 7c1d0d4b9c (path ) state 0x... is not available",
      "header not found",
      "historical state not available",
    ])("classifies -32000 '%s' as historical state", async (message) => {
      expect(await classifyRead({ code: -32000, message })).toBe(
        ErrorType.HISTORICAL_STATE_NOT_AVAILABLE,
      );
    });
  });

  describe("deterministic reverts", () => {
    it("classifies a revert carrying Error(string) data as CONTRACT_REVERT", async () => {
      const data = encodeErrorResult({
        abi: parseAbi(["error Error(string)"]),
        errorName: "Error",
        args: ["not supported"],
      });
      expect(
        await classifyRead({
          code: 3,
          message: "execution reverted: not supported",
          data,
        }),
      ).toBe(ErrorType.CONTRACT_REVERT);
    });

    it("classifies -32000 'execution reverted' without data as CONTRACT_REVERT", async () => {
      expect(
        await classifyRead({ code: -32000, message: "execution reverted" }),
      ).toBe(ErrorType.CONTRACT_REVERT);
    });

    it("classifies an empty eth_call result (no contract) as CONTRACT_REVERT", async () => {
      expect(
        getErrorType(await captureReadError(answeringViemClient("0x"))),
      ).toBe(ErrorType.CONTRACT_REVERT);
    });

    it("does not treat an internal error with an arbitrary reason as a revert", async () => {
      expect(
        await classifyRead({ code: -32603, message: "upstream node crashed" }),
      ).toBe(ErrorType.UNKNOWN);
    });
  });

  describe("HTTP status", () => {
    it.each([
      [500, ErrorType.SERVER_ERROR],
      [502, ErrorType.SERVER_ERROR],
      [503, ErrorType.SERVER_ERROR],
      [429, ErrorType.RATE_LIMIT],
      [401, ErrorType.AUTH_OR_QUOTA],
      [402, ErrorType.AUTH_OR_QUOTA],
      [403, ErrorType.AUTH_OR_QUOTA],
      [404, ErrorType.ENDPOINT_ERROR],
      [408, ErrorType.TIMEOUT],
    ])("HTTP %i -> %s", async (status, expected) => {
      expect(
        await classifyRead(new HttpRequestError({ status, url: URL })),
      ).toBe(expected);
    });

    it("no status (connection failure) -> NETWORK_ERROR", async () => {
      expect(
        await classifyRead(
          new HttpRequestError({
            url: URL,
            cause: new TypeError("fetch failed"),
          }),
        ),
      ).toBe(ErrorType.NETWORK_ERROR);
    });

    it("ignores '429' and 'revert' inside the request body (calldata)", async () => {
      const err = new HttpRequestError({
        status: 503,
        url: URL,
        body: {
          method: "eth_call",
          params: [{ data: "0x429429revert429" }],
        },
      });
      expect(await classifyRead(err)).toBe(ErrorType.SERVER_ERROR);
    });
  });

  describe("JSON-RPC codes", () => {
    it.each([
      [-32005, ErrorType.RATE_LIMIT],
      [429, ErrorType.RATE_LIMIT],
      [-32601, ErrorType.METHOD_NOT_SUPPORTED],
      [-32004, ErrorType.METHOD_NOT_SUPPORTED],
      [-32602, ErrorType.INVALID_REQUEST],
    ])("code %i -> %s", async (code, expected) => {
      expect(await classifyRead({ code, message: "x" })).toBe(expected);
    });

    it("rate limit without '429' anywhere in the text is still RATE_LIMIT", async () => {
      expect(
        await classifyRead({ code: -32005, message: "slow down please" }),
      ).toBe(ErrorType.RATE_LIMIT);
    });
  });

  it("classifies viem TimeoutError as TIMEOUT", async () => {
    expect(await classifyRead(new TimeoutError({ body: {}, url: URL }))).toBe(
      ErrorType.TIMEOUT,
    );
  });

  it("classifies RpcConfigError (also when wrapped by viem) as CONFIGURATION", async () => {
    const cfg = new RpcConfigError("set ENVIO_BASE_RPC_URL");
    expect(getErrorType(cfg)).toBe(ErrorType.CONFIGURATION);
    expect(await classifyRead(cfg)).toBe(ErrorType.CONFIGURATION);
    expect(RPC_ERROR_POLICY[ErrorType.CONFIGURATION].fatal).toBe(true);
  });

  it("classifies non-viem errors and falsy values as UNKNOWN (transient)", () => {
    expect(getErrorType(new Error("revert 429 rate limit"))).toBe(
      ErrorType.UNKNOWN,
    );
    expect(getErrorType(undefined)).toBe(ErrorType.UNKNOWN);
    expect(RPC_ERROR_POLICY[ErrorType.UNKNOWN].retrySameEndpoint).toBe(true);
  });

  it("only CONTRACT_REVERT defaults are cacheable", () => {
    const cacheable = Object.entries(RPC_ERROR_POLICY)
      .filter(([, p]) => p.cacheableDefault)
      .map(([k]) => k);
    expect(cacheable).toEqual([ErrorType.CONTRACT_REVERT]);
  });
});

describe("describeRpcError", () => {
  it("includes provider details but never the URL key or request body", async () => {
    const err = await captureReadError(
      failingViemClient(
        new RpcRequestError({
          body: { params: ["0xsecretcalldata"] },
          error: { code: -32603, message: INSUFFICIENT_CHANGESETS },
          url: URL,
        }),
      ),
    );
    const text = describeRpcError(err);
    expect(text).toContain("insufficient changesets");
    expect(text).not.toContain("SECRETKEY");
    expect(text).not.toContain("secretcalldata");
  });

  it("handles plain errors and non-errors", () => {
    expect(describeRpcError(new Error("boom"))).toBe("boom");
    expect(describeRpcError("x")).toBe("x");
    expect(describeRpcError(new BaseError("short"))).toContain("short");
  });
});
