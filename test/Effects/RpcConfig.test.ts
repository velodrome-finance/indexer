import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRPC_MAX_RPS,
  DEFAULT_FALLBACK_RPS,
  RPC_CHAINS,
  RpcConfigError,
  assertRpcConfigAtStartup,
  isTestEnvironment,
  redactRpcUrl,
  resolveRpcEndpoints,
  validateRpcConfig,
} from "../../src/Effects/RpcConfig";

const KEY = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";

describe("RPC_CHAINS", () => {
  it("covers every chain in config.yaml", () => {
    expect(
      Object.keys(RPC_CHAINS)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([
      1, 10, 130, 252, 1135, 1750, 1868, 1923, 4663, 5042, 5330, 8453, 34443,
      42161, 42220, 57073,
    ]);
  });

  it("uses the dRPC network slugs verified against eth_chainId", () => {
    expect(RPC_CHAINS[1750].drpcNetwork).toBe("metall2");
    expect(RPC_CHAINS[5330].envKey).toBe("ENVIO_SUPERSEED_RPC_URL");
    expect(RPC_CHAINS[1].drpcNetwork).toBe("ethereum");
    expect(RPC_CHAINS[42161].drpcNetwork).toBe("arbitrum");
    expect(RPC_CHAINS[4663].drpcNetwork).toBe("robinhood");
    expect(RPC_CHAINS[5042].drpcNetwork).toBe("arc");
    expect(RPC_CHAINS[4663].viemChain.id).toBe(4663);
    expect(RPC_CHAINS[5042].viemChain.id).toBe(5042);
  });

  it("has no dead defaults from the old DefaultRPC table", () => {
    const dead = [
      "0xrpc.io/uni",
      "rpc.ankr.com",
      "base.publicnode.com",
      "publicnode.com",
    ];
    for (const c of Object.values(RPC_CHAINS)) {
      for (const d of dead) {
        expect(c.defaultFallbackUrl ?? "").not.toContain(d);
      }
    }
  });
});

describe("resolveRpcEndpoints", () => {
  it("prefers the explicit per-chain variable", () => {
    const r = resolveRpcEndpoints(8453, {
      ENVIO_BASE_RPC_URL: "https://my-node.example/base",
      ENVIO_DRPC_API_KEY: KEY,
    });
    expect(r.primary).toMatchObject({
      url: "https://my-node.example/base",
      source: "env",
    });
    expect(r.primary.sharedBucket).toBeUndefined();
  });

  it("builds the primary from ENVIO_DRPC_API_KEY when the per-chain variable is unset or empty", () => {
    const r = resolveRpcEndpoints(1750, {
      ENVIO_METAL_RPC_URL: "  ",
      ENVIO_DRPC_API_KEY: KEY,
    });
    expect(r.primary.url).toBe(`https://lb.drpc.live/metall2/${KEY}`);
    expect(r.primary.source).toBe("drpc-key");
    expect(r.primary.sharedBucket).toEqual({
      key: "drpc-account",
      rps: DEFAULT_DRPC_MAX_RPS,
    });
  });

  it("throws a clear error naming both variables when nothing is configured", () => {
    expect(() => resolveRpcEndpoints(5330, {})).toThrow(RpcConfigError);
    expect(() => resolveRpcEndpoints(5330, {})).toThrow(
      /ENVIO_SUPERSEED_RPC_URL or ENVIO_DRPC_API_KEY/,
    );
  });

  it("rejects malformed URLs and rate limits", () => {
    expect(() =>
      resolveRpcEndpoints(10, { ENVIO_OPTIMISM_RPC_URL: "not a url" }),
    ).toThrow(/ENVIO_OPTIMISM_RPC_URL is not a valid URL/);
    expect(() =>
      resolveRpcEndpoints(10, {
        ENVIO_DRPC_API_KEY: KEY,
        ENVIO_OPTIMISM_RPC_RPS: "-1",
      }),
    ).toThrow(/ENVIO_OPTIMISM_RPC_RPS/);
  });

  it("uses a different-provider default fallback, unbatched, at the conservative rate", () => {
    const r = resolveRpcEndpoints(8453, { ENVIO_DRPC_API_KEY: KEY });
    expect(r.fallback?.url).toBe(RPC_CHAINS[8453].defaultFallbackUrl);
    expect(r.fallback?.url).not.toContain("drpc");
    expect(r.fallback?.batchSize).toBe(1);
    expect(r.fallback?.rps).toBe(DEFAULT_FALLBACK_RPS);
  });

  it("honours an explicit fallback and 'none'", () => {
    expect(
      resolveRpcEndpoints(10, {
        ENVIO_DRPC_API_KEY: KEY,
        ENVIO_OPTIMISM_FALLBACK_RPC_URL: "https://other.example/op",
      }).fallback?.url,
    ).toBe("https://other.example/op");
    const none = resolveRpcEndpoints(10, {
      ENVIO_DRPC_API_KEY: KEY,
      ENVIO_OPTIMISM_FALLBACK_RPC_URL: "none",
    });
    expect(none.fallback).toBeNull();
    expect(none.warnings.join()).toContain("no fallback");
  });

  it("drops a fallback identical to the primary", () => {
    const r = resolveRpcEndpoints(10, {
      ENVIO_OPTIMISM_RPC_URL: "https://same.example/op/",
      ENVIO_OPTIMISM_FALLBACK_RPC_URL: "https://SAME.example/op",
    });
    expect(r.fallback).toBeNull();
    expect(r.warnings.join()).toContain("equals the primary");
  });

  it("throws for an unknown chain", () => {
    expect(() => resolveRpcEndpoints(999, {})).toThrow(/No RPC configuration/);
  });
});

describe("validateRpcConfig / assertRpcConfigAtStartup", () => {
  it("lists every chain with a missing primary in one pass", () => {
    const { errors } = validateRpcConfig({
      ENVIO_BASE_RPC_URL: "https://b.example",
    });
    expect(errors).toHaveLength(15);
    expect(errors.join("\n")).toContain("ENVIO_OPTIMISM_RPC_URL");
    expect(errors.join("\n")).not.toContain("ENVIO_BASE_RPC_URL or");
  });

  it("passes with only the dRPC key", () => {
    expect(validateRpcConfig({ ENVIO_DRPC_API_KEY: KEY }).errors).toEqual([]);
  });

  it("throws outside tests and is a no-op under vitest or with the skip flag", () => {
    expect(() => assertRpcConfigAtStartup({})).toThrow(
      /Invalid RPC configuration \(16 problem/,
    );
    expect(assertRpcConfigAtStartup({ VITEST: "true" })).toEqual([]);
    expect(
      assertRpcConfigAtStartup({ ENVIO_RPC_SKIP_STARTUP_CHECK: "true" }),
    ).toEqual([]);
    expect(isTestEnvironment({ NODE_ENV: "test" })).toBe(true);
  });
});

describe("redactRpcUrl", () => {
  it("removes key-like path segments and query strings", () => {
    expect(redactRpcUrl(`https://lb.drpc.live/base/${KEY}`)).toBe(
      "https://lb.drpc.live/base/<redacted>",
    );
    expect(redactRpcUrl("https://x.example/rpc?apikey=123")).toBe(
      "https://x.example/rpc?<redacted>",
    );
    expect(redactRpcUrl("nope")).toBe("<invalid-url>");
  });
});
