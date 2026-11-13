import type { Chain } from "viem";
import {
  base,
  celo,
  fraxtal,
  ink,
  lisk,
  metalL2,
  mode,
  optimism,
  soneium,
  superseed,
  swellchain,
  unichain,
} from "viem/chains";

/**
 * Single source of truth for where each chain's RPC traffic goes.
 *
 * Resolution order for the PRIMARY endpoint of a chain:
 *   1. `ENVIO_<CHAIN>_RPC_URL` when set and non-empty;
 *   2. `https://lb.drpc.live/<network>/<ENVIO_DRPC_API_KEY>` when the key is set;
 *   3. otherwise {@link RpcConfigError} naming both variables.
 *
 * There is deliberately no public default for the primary: several of the old
 * defaults were dead or non-archive, and a missing variable used them silently.
 *
 * The FALLBACK endpoint is `ENVIO_<CHAIN>_FALLBACK_RPC_URL` when set (the value
 * `none` disables it), else a curated public endpoint from a different provider
 * (see {@link RPC_CHAINS}). A fallback equal to the primary is dropped, because
 * retrying the same endpoint under a different name is not a fallback.
 */

/** Static per-chain RPC metadata. */
export type RpcChainConfig = {
  chainId: number;
  /** Short name used in logs and env var names. */
  name: string;
  /** viem chain definition (used for client construction). */
  viemChain: Chain;
  /** Env var holding an explicit primary URL. */
  envKey: string;
  /** Env var holding an explicit fallback URL (`none` disables). */
  fallbackEnvKey: string;
  /** Env var overriding the primary's requests-per-second budget. */
  rpsEnvKey: string;
  /** dRPC network slug for `https://lb.drpc.live/<slug>/<key>`. */
  drpcNetwork: string;
  /**
   * Public fallback used when `fallbackEnvKey` is unset, or null for none.
   * Chosen with `scripts/check-rpc.ts --url-file` on 2026-11-13 (chain id +
   * five historical `eth_call`s per candidate). Rejected candidates: every
   * `*-rpc.publicnode.com` (HTTP 403 for archive calls; Fraxtal's is pruned),
   * `0xrpc.io/uni` (404), `rpc.ankr.com/swell` (403), `mode.drpc.org` (500s),
   * `rpc.api.lisk.com` (TLS failure from the dev box), `mainnet.superseed.xyz`
   * and `swell-mainnet.alt.technology` (do not resolve), `superseed.drpc.org`
   * (400). `*.drpc.org` entries are dRPC's free public tier: a different
   * endpoint from the keyed `lb.drpc.live` primary but the same provider.
   */
  defaultFallbackUrl: string | null;
  /** Default requests/second for the primary endpoint of this chain. */
  defaultPrimaryRps: number;
};

/** Env var holding the dRPC API key used to build primary URLs. */
export const DRPC_API_KEY_ENV = "ENVIO_DRPC_API_KEY";
/** Env var overriding the shared dRPC account budget (requests/second). */
export const DRPC_MAX_RPS_ENV = "ENVIO_DRPC_MAX_RPS";
/** Env var overriding the per-chain fallback budget (requests/second). */
export const FALLBACK_RPS_ENV = "ENVIO_FALLBACK_RPC_RPS";
/** Escape hatch for tooling that imports the effects without RPC access. */
export const SKIP_STARTUP_CHECK_ENV = "ENVIO_RPC_SKIP_STARTUP_CHECK";

/**
 * Rate-limit defaults (requests per second, counted per JSON-RPC call, not per
 * HTTP batch). Source: dRPC docs "Rate limiting" (drpc.org/docs/howitworks/ratelimiting,
 * read 2026-11-13): Pay-as-you-go 100 RPS for accounts created after
 * 2026-10-19 (older accounts keep their previous limits), Pro 300, Scale 600;
 * free public nodes ~25 RPS with a 2 s timeout and batches capped at 3 items.
 * The limit applies to the account, i.e. across all networks, so all dRPC-key
 * endpoints share {@link DEFAULT_DRPC_MAX_RPS}; the per-chain values only stop
 * one busy chain from starving the others. Non-dRPC public fallbacks publish no
 * limits we could verify, so they get a conservative {@link DEFAULT_FALLBACK_RPS}.
 */
export const DEFAULT_DRPC_MAX_RPS = 80;
export const DEFAULT_FALLBACK_RPS = 5;

const chain = (
  chainId: number,
  name: string,
  envName: string,
  viemChain: Chain,
  drpcNetwork: string,
  defaultFallbackUrl: string | null,
  defaultPrimaryRps: number,
): RpcChainConfig => ({
  chainId,
  name,
  viemChain,
  envKey: `ENVIO_${envName}_RPC_URL`,
  fallbackEnvKey: `ENVIO_${envName}_FALLBACK_RPC_URL`,
  rpsEnvKey: `ENVIO_${envName}_RPC_RPS`,
  drpcNetwork,
  defaultFallbackUrl,
  defaultPrimaryRps,
});

/** Every chain in config.yaml, keyed by chain id. */
export const RPC_CHAINS: Readonly<Record<number, RpcChainConfig>> = {
  10: chain(
    10,
    "optimism",
    "OPTIMISM",
    optimism,
    "optimism",
    "https://mainnet.optimism.io",
    25,
  ),
  8453: chain(
    8453,
    "base",
    "BASE",
    base,
    "base",
    "https://mainnet.base.org",
    40,
  ),
  42220: chain(
    42220,
    "celo",
    "CELO",
    celo,
    "celo",
    "https://forno.celo.org",
    10,
  ),
  1868: chain(
    1868,
    "soneium",
    "SONEIUM",
    soneium,
    "soneium",
    "https://rpc.soneium.org",
    10,
  ),
  57073: chain(
    57073,
    "ink",
    "INK",
    ink,
    "ink",
    "https://rpc-gel.inkonchain.com",
    10,
  ),
  34443: chain(34443, "mode", "MODE", mode, "mode", "https://1rpc.io/mode", 10),
  1135: chain(1135, "lisk", "LISK", lisk, "lisk", "https://lisk.drpc.org", 10),
  130: chain(
    130,
    "unichain",
    "UNICHAIN",
    unichain,
    "unichain",
    "https://mainnet.unichain.org",
    10,
  ),
  252: chain(
    252,
    "fraxtal",
    "FRAXTAL",
    fraxtal,
    "fraxtal",
    "https://rpc.frax.com",
    10,
  ),
  1750: chain(
    1750,
    "metal",
    "METAL",
    metalL2,
    "metall2",
    "https://rpc.metall2.com",
    10,
  ),
  5330: chain(5330, "superseed", "SUPERSEED", superseed, "superseed", null, 10),
  1923: chain(
    1923,
    "swell",
    "SWELL",
    swellchain,
    "swell",
    "https://swell.drpc.org",
    10,
  ),
};

/** Thrown when a chain's RPC endpoint cannot be resolved from the environment. */
export class RpcConfigError extends Error {
  /**
   * @param message - Human-readable description naming the missing variable(s).
   */
  constructor(message: string) {
    super(message);
    this.name = "RpcConfigError";
  }
}

/** Where a resolved URL came from (for logs and the health check). */
export type RpcUrlSource = "env" | "drpc-key" | "default";

/** One resolved endpoint. */
export type ResolvedEndpoint = {
  url: string;
  source: RpcUrlSource;
  /** Requests-per-second budget for this endpoint on this chain. */
  rps: number;
  /** Bucket shared with other chains (e.g. one dRPC account), if any. */
  sharedBucket?: { key: string; rps: number };
  /** Max JSON-RPC calls per HTTP batch; 1 disables batching. */
  batchSize: number;
};

/** Resolved primary + optional fallback for a chain. */
export type ResolvedRpcEndpoints = {
  chainId: number;
  name: string;
  primary: ResolvedEndpoint;
  fallback: ResolvedEndpoint | null;
  /** Non-fatal configuration notes (e.g. fallback dropped as duplicate). */
  warnings: string[];
};

type Env = Readonly<Record<string, string | undefined>>;

const readEnv = (env: Env, key: string): string | undefined => {
  const v = env[key]?.trim();
  return v ? v : undefined;
};

const readPositiveNumber = (
  env: Env,
  key: string,
  fallback: number,
): number => {
  const raw = readEnv(env, key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new RpcConfigError(
      `${key} must be a positive number of requests per second, got "${raw}".`,
    );
  }
  return n;
};

const assertHttpUrl = (url: string, varName: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RpcConfigError(`${varName} is not a valid URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new RpcConfigError(`${varName} must be an http(s) URL.`);
  }
  return url;
};

const isDrpcKeyUrl = (url: string): boolean => {
  try {
    return new URL(url).hostname === "lb.drpc.live";
  } catch {
    return false;
  }
};

const normaliseForCompare = (url: string): string =>
  url.replace(/\/+$/, "").toLowerCase();

/**
 * Resolves the primary and fallback RPC endpoints for one chain from `env`.
 * Pure: no network access, no caching.
 *
 * @param chainId - Chain to resolve.
 * @param env - Environment to read (defaults to `process.env`).
 * @returns The resolved endpoints with their rate-limit budgets.
 * @throws {RpcConfigError} When the chain is unknown or no primary URL can be built.
 */
export function resolveRpcEndpoints(
  chainId: number,
  env: Env = process.env,
): ResolvedRpcEndpoints {
  const cfg = RPC_CHAINS[chainId];
  if (!cfg) {
    throw new RpcConfigError(
      `No RPC configuration for chain ${chainId}; add it to RPC_CHAINS in src/Effects/RpcConfig.ts.`,
    );
  }
  const warnings: string[] = [];
  const drpcKey = readEnv(env, DRPC_API_KEY_ENV);
  const explicit = readEnv(env, cfg.envKey);

  let primaryUrl: string;
  let primarySource: RpcUrlSource;
  if (explicit) {
    primaryUrl = assertHttpUrl(explicit, cfg.envKey);
    primarySource = "env";
  } else if (drpcKey) {
    primaryUrl = `https://lb.drpc.live/${cfg.drpcNetwork}/${drpcKey}`;
    primarySource = "drpc-key";
  } else {
    throw new RpcConfigError(
      `RPC endpoint for chain ${chainId} (${cfg.name}) is not configured: set ${cfg.envKey} or ${DRPC_API_KEY_ENV}.`,
    );
  }

  const drpcMaxRps = readPositiveNumber(
    env,
    DRPC_MAX_RPS_ENV,
    DEFAULT_DRPC_MAX_RPS,
  );
  const fallbackRps = readPositiveNumber(
    env,
    FALLBACK_RPS_ENV,
    DEFAULT_FALLBACK_RPS,
  );
  const endpoint = (
    url: string,
    source: RpcUrlSource,
    rps: number,
    batchSize: number,
  ): ResolvedEndpoint => ({
    url,
    source,
    rps,
    batchSize,
    ...(isDrpcKeyUrl(url)
      ? { sharedBucket: { key: "drpc-account", rps: drpcMaxRps } }
      : {}),
  });

  const primary = endpoint(
    primaryUrl,
    primarySource,
    readPositiveNumber(env, cfg.rpsEnvKey, cfg.defaultPrimaryRps),
    50,
  );

  const fallbackRaw = readEnv(env, cfg.fallbackEnvKey);
  let fallback: ResolvedEndpoint | null = null;
  if (fallbackRaw?.toLowerCase() === "none") {
    fallback = null;
  } else if (fallbackRaw) {
    fallback = endpoint(
      assertHttpUrl(fallbackRaw, cfg.fallbackEnvKey),
      "env",
      fallbackRps,
      1,
    );
  } else if (cfg.defaultFallbackUrl) {
    fallback = endpoint(cfg.defaultFallbackUrl, "default", fallbackRps, 1);
  }

  if (
    fallback &&
    normaliseForCompare(fallback.url) === normaliseForCompare(primary.url)
  ) {
    warnings.push(
      `${cfg.fallbackEnvKey} equals the primary URL for chain ${chainId}; fallback disabled.`,
    );
    fallback = null;
  }
  if (!fallback) {
    warnings.push(`Chain ${chainId} (${cfg.name}) has no fallback RPC.`);
  }

  return { chainId, name: cfg.name, primary, fallback, warnings };
}

/**
 * Validates every chain's RPC configuration and returns all problems at once,
 * so an operator sees the complete list of missing variables in one start.
 *
 * @param env - Environment to read (defaults to `process.env`).
 * @returns `errors` (fatal: primary unresolvable) and `warnings` (non-fatal).
 */
export function validateRpcConfig(env: Env = process.env): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const id of Object.keys(RPC_CHAINS).map(Number)) {
    try {
      warnings.push(...resolveRpcEndpoints(id, env).warnings);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { errors, warnings };
}

/**
 * True when running under a test runner, where no RPC config is expected and
 * every RPC client is mocked.
 *
 * @param env - Environment to read (defaults to `process.env`).
 * @returns Whether a test runner is detected.
 */
export function isTestEnvironment(env: Env = process.env): boolean {
  return env.VITEST !== undefined || env.NODE_ENV === "test";
}

/**
 * Startup guard: throws one {@link RpcConfigError} listing every chain whose
 * primary RPC cannot be resolved. No-op under a test runner or when
 * `ENVIO_RPC_SKIP_STARTUP_CHECK=true` (tooling that never calls RPC).
 *
 * @param env - Environment to read (defaults to `process.env`).
 * @returns Non-fatal warnings (e.g. chains without a fallback).
 * @throws {RpcConfigError} When at least one chain has no primary RPC.
 */
export function assertRpcConfigAtStartup(env: Env = process.env): string[] {
  if (isTestEnvironment(env) || readEnv(env, SKIP_STARTUP_CHECK_ENV) === "true")
    return [];
  const { errors, warnings } = validateRpcConfig(env);
  if (errors.length > 0) {
    throw new RpcConfigError(
      `Invalid RPC configuration (${errors.length} problem(s)):\n  - ${errors.join("\n  - ")}`,
    );
  }
  return warnings;
}

/**
 * Removes credentials from an RPC URL for logs: path segments that look like
 * API keys (16+ URL-safe chars) and any query string are replaced.
 *
 * @param url - URL to redact.
 * @returns The URL with key-like segments replaced by `<redacted>`.
 */
export function redactRpcUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname
      .split("/")
      .map((seg) => (/^[A-Za-z0-9_-]{16,}$/.test(seg) ? "<redacted>" : seg))
      .join("/");
    return `${u.protocol}//${u.host}${path}${u.search ? "?<redacted>" : ""}`;
  } catch {
    return "<invalid-url>";
  }
}
