import { HttpRequestError, type PublicClient } from "viem";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { RPC_APP_RETRY } from "../../src/Constants";
import { ErrorType } from "../../src/Effects/Helpers";
import { RpcConfigError } from "../../src/Effects/RpcConfig";
import {
  computeRetryDelayMs,
  executeRpc,
  getRpcStats,
  isCacheableResult,
  mostCacheBlockingErrorClass,
  runWithRpcRetry,
} from "../../src/Effects/RpcGateway";
import {
  captureReadError,
  createMockEffectContext,
  failingViemClient,
  installRpcMocks,
} from "./setup";

const CHAIN = 10;
const URL = "https://example.invalid/rpc";
const http = (status: number) => new HttpRequestError({ status, url: URL });

// Real viem-shaped errors, captured once.
let changesetsError: unknown;
let revertError: unknown;
beforeEach(async () => {
  changesetsError = await captureReadError(
    failingViemClient({
      code: -32603,
      message:
        "insufficient changesets to revert to block #12272400. Available changeset range: 41491212..=41501276",
    }),
  );
  revertError = await captureReadError(
    failingViemClient({ code: -32000, message: "execution reverted" }),
  );
});

type Fn = Mock<() => Promise<unknown>>;
const client = (fn: Fn) => ({ fn }) as unknown as Partial<PublicClient>;
const call = (c: PublicClient) => (c as unknown as { fn: Fn }).fn();

describe("executeRpc", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("returns the primary answer", async () => {
    const primary = vi.fn().mockResolvedValue(7n);
    restore = installRpcMocks(CHAIN, client(primary));
    const ctx = createMockEffectContext();
    const r = await executeRpc(ctx, { name: "op", chainId: CHAIN }, 0n, call);
    expect(r).toEqual({ value: 7n, usedDefault: false, errorClass: undefined });
    expect(getRpcStats()[CHAIN].primary_ok).toBe(1);
  });

  it("retries a pruned-node error on the same endpoint before succeeding (no fallback, no default)", async () => {
    const primary = vi
      .fn()
      .mockRejectedValueOnce(changesetsError)
      .mockRejectedValueOnce(changesetsError)
      .mockResolvedValue(6);
    const fallback = vi.fn();
    restore = installRpcMocks(CHAIN, client(primary), client(fallback));
    const r = await executeRpc(
      createMockEffectContext(),
      { name: "op", chainId: CHAIN },
      18,
      call,
    );
    expect(r.value).toBe(6);
    expect(r.usedDefault).toBe(false);
    expect(primary).toHaveBeenCalledTimes(3);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("moves a persistent pruned-node error to the fallback endpoint after maxAttempts", async () => {
    const primary = vi.fn().mockRejectedValue(changesetsError);
    const fallback = vi.fn().mockResolvedValue(6);
    restore = installRpcMocks(CHAIN, client(primary), client(fallback));
    const ctx = createMockEffectContext();
    const r = await executeRpc(ctx, { name: "op", chainId: CHAIN }, 18, call);
    expect(primary).toHaveBeenCalledTimes(RPC_APP_RETRY.maxAttempts);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ value: 6, usedDefault: false, errorClass: undefined });
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("HISTORICAL_STATE_NOT_AVAILABLE"),
      expect.objectContaining({ event: "rpc.primary_failed" }),
    );
    expect(getRpcStats()[CHAIN].fallback_ok).toBe(1);
  });

  it("never returns a cacheable default for a pruned-node error", async () => {
    const primary = vi.fn().mockRejectedValue(changesetsError);
    const fallback = vi.fn().mockRejectedValue(changesetsError);
    restore = installRpcMocks(CHAIN, client(primary), client(fallback));
    const ctx = createMockEffectContext();
    const r = await executeRpc(ctx, { name: "op", chainId: CHAIN }, 18, call);
    expect(r.usedDefault).toBe(true);
    expect(r.errorClass).toBe(ErrorType.HISTORICAL_STATE_NOT_AVAILABLE);
    expect(isCacheableResult(r)).toBe(false);
    expect(ctx.log.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: "rpc.default_used",
        chainId: CHAIN,
        errorClass: ErrorType.HISTORICAL_STATE_NOT_AVAILABLE,
        cacheable: false,
        endpoint: "fallback",
      }),
    );
    expect(getRpcStats()[CHAIN].default_transient).toBe(1);
  });

  it("does not retry or fall back on a deterministic revert; the default is cacheable", async () => {
    const primary = vi.fn().mockRejectedValue(revertError);
    const fallback = vi.fn();
    restore = installRpcMocks(CHAIN, client(primary), client(fallback));
    const ctx = createMockEffectContext();
    const r = await executeRpc(ctx, { name: "op", chainId: CHAIN }, 18, call);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(r).toEqual({
      value: 18,
      usedDefault: true,
      errorClass: ErrorType.CONTRACT_REVERT,
    });
    expect(isCacheableResult(r)).toBe(true);
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: "rpc.default_used", cacheable: true }),
    );
    expect(ctx.log.error).not.toHaveBeenCalled();
    expect(getRpcStats()[CHAIN].default_revert).toBe(1);
  });

  it.each([401, 403, 404])(
    "sends HTTP %i straight to the fallback without retrying the primary",
    async (status) => {
      const primary = vi.fn().mockRejectedValue(http(status));
      const fallback = vi.fn().mockResolvedValue(1);
      restore = installRpcMocks(CHAIN, client(primary), client(fallback));
      const r = await executeRpc(
        createMockEffectContext(),
        { name: "op", chainId: CHAIN },
        0,
        call,
      );
      expect(primary).toHaveBeenCalledTimes(1);
      expect(r.value).toBe(1);
    },
  );

  it.each([500, 502, 503, 429])(
    "retries HTTP %i on the primary, then uses the fallback",
    async (status) => {
      const primary = vi.fn().mockRejectedValue(http(status));
      const fallback = vi.fn().mockResolvedValue(1);
      restore = installRpcMocks(CHAIN, client(primary), client(fallback));
      const r = await executeRpc(
        createMockEffectContext(),
        { name: "op", chainId: CHAIN },
        0,
        call,
      );
      expect(primary).toHaveBeenCalledTimes(RPC_APP_RETRY.maxAttempts);
      expect(r.value).toBe(1);
    },
  );

  it("returns a non-cacheable default when there is no fallback", async () => {
    const primary = vi.fn().mockRejectedValue(http(503));
    restore = installRpcMocks(CHAIN, client(primary), null);
    const r = await executeRpc(
      createMockEffectContext(),
      { name: "op", chainId: CHAIN, details: { pool: "0xabc", block: 5 } },
      undefined,
      call,
    );
    expect(r.usedDefault).toBe(true);
    expect(r.errorClass).toBe(ErrorType.SERVER_ERROR);
    expect(isCacheableResult(r)).toBe(false);
  });

  it("caches a revert reported by the fallback after a transient primary failure", async () => {
    const primary = vi.fn().mockRejectedValue(http(502));
    const fallback = vi.fn().mockRejectedValue(revertError);
    restore = installRpcMocks(CHAIN, client(primary), client(fallback));
    const r = await executeRpc(
      createMockEffectContext(),
      { name: "op", chainId: CHAIN },
      0,
      call,
    );
    expect(r.errorClass).toBe(ErrorType.CONTRACT_REVERT);
    expect(isCacheableResult(r)).toBe(true);
  });

  it("throws configuration errors instead of returning a default", async () => {
    const primary = vi
      .fn()
      .mockRejectedValue(new RpcConfigError("set ENVIO_OPTIMISM_RPC_URL"));
    restore = installRpcMocks(CHAIN, client(primary), null);
    await expect(
      executeRpc(
        createMockEffectContext(),
        { name: "op", chainId: CHAIN },
        0,
        call,
      ),
    ).rejects.toThrow("ENVIO_OPTIMISM_RPC_URL");
  });

  it("emits a per-chain rpc.stats summary at most once a minute", async () => {
    const primary = vi.fn().mockResolvedValue(1);
    restore = installRpcMocks(CHAIN, client(primary));
    const ctx = createMockEffectContext();
    const now = Date.now();
    const spy = vi.spyOn(Date, "now");
    try {
      spy.mockReturnValue(now + 61_000);
      await executeRpc(ctx, { name: "op", chainId: CHAIN }, 0, call);
      await executeRpc(ctx, { name: "op", chainId: CHAIN }, 0, call);
      const statsLogs = ctx.log.info.mock.calls.filter(
        ([, p]) => (p as { event?: string })?.event === "rpc.stats",
      );
      expect(statsLogs.length).toBeLessThanOrEqual(1);
      spy.mockReturnValue(now + 125_000);
      await executeRpc(ctx, { name: "op", chainId: CHAIN }, 0, call);
      expect(ctx.log.info).toHaveBeenLastCalledWith(
        `[rpc.stats] chain=${CHAIN}`,
        expect.objectContaining({
          event: "rpc.stats",
          chainId: CHAIN,
          primary_ok: 2,
          transientDefaultRate: 0,
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("throws for an unknown chain", async () => {
    await expect(
      executeRpc(
        createMockEffectContext(),
        { name: "op", chainId: 999999 },
        0,
        call,
      ),
    ).rejects.toBeInstanceOf(RpcConfigError);
  });
});

describe("runWithRpcRetry", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("rethrows a non-retryable error immediately", async () => {
    restore = installRpcMocks(CHAIN, {});
    const fn = vi.fn().mockRejectedValue(http(403));
    await expect(runWithRpcRetry(fn)).rejects.toBeInstanceOf(HttpRequestError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("treats unknown errors as transient", async () => {
    restore = installRpcMocks(CHAIN, {});
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("weird"))
      .mockResolvedValue("ok");
    await expect(runWithRpcRetry(fn, onRetry)).resolves.toBe("ok");
    expect(onRetry).toHaveBeenCalledWith(ErrorType.UNKNOWN);
  });
});

describe("computeRetryDelayMs", () => {
  it("is jittered within [cap/2, cap] and capped", () => {
    expect(computeRetryDelayMs(0, ErrorType.SERVER_ERROR, () => 0)).toBe(250);
    expect(computeRetryDelayMs(0, ErrorType.SERVER_ERROR, () => 1)).toBe(500);
    expect(computeRetryDelayMs(0, ErrorType.RATE_LIMIT, () => 1)).toBe(1000);
    expect(computeRetryDelayMs(2, ErrorType.SERVER_ERROR, () => 1)).toBe(2000);
    expect(computeRetryDelayMs(20, ErrorType.TIMEOUT, () => 1)).toBe(
      RPC_APP_RETRY.maxDelayMs,
    );
  });
});

describe("cache helpers", () => {
  it("isCacheableResult: real answers and revert defaults only", () => {
    expect(
      isCacheableResult({ usedDefault: false, errorClass: undefined }),
    ).toBe(true);
    expect(
      isCacheableResult({
        usedDefault: true,
        errorClass: ErrorType.CONTRACT_REVERT,
      }),
    ).toBe(true);
    for (const t of [
      ErrorType.TIMEOUT,
      ErrorType.RATE_LIMIT,
      ErrorType.SERVER_ERROR,
      ErrorType.AUTH_OR_QUOTA,
      ErrorType.HISTORICAL_STATE_NOT_AVAILABLE,
      ErrorType.UNKNOWN,
    ]) {
      expect(isCacheableResult({ usedDefault: true, errorClass: t })).toBe(
        false,
      );
    }
    expect(
      isCacheableResult({ usedDefault: true, errorClass: undefined }),
    ).toBe(false);
  });

  it("mostCacheBlockingErrorClass prefers non-cacheable classes", () => {
    expect(mostCacheBlockingErrorClass(undefined, undefined)).toBeUndefined();
    expect(
      mostCacheBlockingErrorClass(ErrorType.CONTRACT_REVERT, ErrorType.TIMEOUT),
    ).toBe(ErrorType.TIMEOUT);
    expect(
      mostCacheBlockingErrorClass(undefined, ErrorType.CONTRACT_REVERT),
    ).toBe(ErrorType.CONTRACT_REVERT);
  });
});
