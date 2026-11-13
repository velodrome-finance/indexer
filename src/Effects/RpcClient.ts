import {
  http,
  type Chain,
  type EIP1193RequestFn,
  type PublicClient,
  type Transport,
  createPublicClient,
  createTransport,
  encodeAbiParameters,
} from "viem";
import {
  RPC_CHAINS,
  type ResolvedEndpoint,
  RpcConfigError,
  isTestEnvironment,
  redactRpcUrl,
  resolveRpcEndpoints,
} from "./RpcConfig";
import { type TokenBucket, acquireAll, getBucket } from "./RpcRateLimiter";

/** Opt-in for tests that deliberately hit a live endpoint. */
export const ALLOW_RPC_IN_TESTS_ENV = "ENVIO_RPC_ALLOW_IN_TESTS";

/**
 * Per-HTTP-request timeout. dRPC documents a 2 s cap on free nodes; paid
 * archive `eth_call`s observed on 2026-11-13 complete in well under a second,
 * so 25 s only trips on a hung connection, and the retry loop
 * (RPC_APP_RETRY) bounds total time per endpoint.
 */
export const RPC_REQUEST_TIMEOUT_MS = 25_000;

/** Which endpoint of a chain a client talks to. */
export type RpcRole = "primary" | "fallback";

/** OP-stack WETH predeploy: present on every chain except Celo. */
const WETH_PREDEPLOY = "0x4200000000000000000000000000000000000006";
const encodeString = (v: string) =>
  encodeAbiParameters([{ type: "string" }], [v]);
const WETH_CALLS: Record<string, `0x${string}`> = {
  "0x06fdde03": encodeString("Wrapped Ether"), // name()
  "0x95d89b41": encodeString("WETH"), // symbol()
  "0x313ce567": encodeAbiParameters([{ type: "uint8" }], [18]), // decimals()
};

/**
 * JSON-RPC stub used for unmocked clients under a test runner, so tests never
 * reach a real endpoint (slow, flaky, and it would spend the provider key that
 * dotenv loads from .env). It models the chain facts handler tests rely on:
 * the OP-stack WETH predeploy is an 18-decimals ERC20 ("Wrapped Ether"/"WETH")
 * on every chain but Celo; every other address has no code, so `eth_call`
 * returns no data (a deterministic "no contract" answer). Methods other than
 * chain id / block number / balance / code / call fail with {@link RpcConfigError}.
 *
 * @param chainId - Chain id reported by `eth_chainId`.
 * @returns An EIP-1193 request function.
 */
function offlineTestChainRequest(chainId: number): EIP1193RequestFn {
  const hasWeth = chainId !== 42220;
  return (async ({
    method,
    params,
  }: {
    method: string;
    params?: unknown[];
  }) => {
    const target = (params?.[0] as { to?: string } | string | undefined) ?? "";
    const to = (
      typeof target === "string" ? target : (target.to ?? "")
    ).toLowerCase();
    const isWeth = hasWeth && to === WETH_PREDEPLOY;
    switch (method) {
      case "eth_chainId":
        return `0x${chainId.toString(16)}`;
      case "eth_blockNumber":
      case "eth_getBalance":
        return "0x0";
      case "eth_getCode":
        return isWeth ? "0x6080604052" : "0x";
      case "eth_call": {
        const data = (params?.[0] as { data?: string } | undefined)?.data ?? "";
        return (isWeth && WETH_CALLS[data.slice(0, 10)]) || "0x";
      }
      default:
        throw new RpcConfigError(
          `RPC method ${method} called under a test runner; mock the client or set ${ALLOW_RPC_IN_TESTS_ENV}=true.`,
        );
    }
  }) as EIP1193RequestFn;
}

/**
 * A viem transport whose URL is resolved on the FIRST request rather than at
 * import time, so that importing `src/Constants.ts` never needs RPC env vars
 * (tests, scripts) while a real call with missing config fails with an
 * {@link import("./RpcConfig").RpcConfigError} naming the variable.
 * Every JSON-RPC call first takes a token from the chain's bucket and, for a
 * dRPC-key URL, from the shared account bucket.
 *
 * @param chainId - Chain the transport serves.
 * @param role - Primary or fallback endpoint.
 * @returns A viem {@link Transport}.
 */
function lazyRateLimitedTransport(chainId: number, role: RpcRole): Transport {
  return ({ chain }) => {
    let inner: { request: EIP1193RequestFn } | undefined;
    let limiters: TokenBucket[] = [];

    const init = (): { request: EIP1193RequestFn } => {
      if (inner) return inner;
      // Tests must not reach a real endpoint (slow, flaky, and dotenv loads
      // the provider key from .env in tests too). Unmocked clients see an
      // empty chain instead; tests needing real values mock eth_client.
      if (
        isTestEnvironment() &&
        process.env[ALLOW_RPC_IN_TESTS_ENV] !== "true"
      ) {
        inner = { request: offlineTestChainRequest(chainId) };
        return inner;
      }
      const resolved = resolveRpcEndpoints(chainId);
      const endpoint: ResolvedEndpoint | null =
        role === "primary" ? resolved.primary : resolved.fallback;
      if (!endpoint) {
        throw new RpcConfigError(
          `Chain ${chainId} has no ${role} RPC endpoint.`,
        );
      }
      limiters = [getBucket(`${chainId}:${role}`, endpoint.rps)];
      if (endpoint.sharedBucket) {
        limiters.push(
          getBucket(endpoint.sharedBucket.key, endpoint.sharedBucket.rps),
        );
      }
      inner = http(endpoint.url, {
        batch:
          endpoint.batchSize > 1 ? { batchSize: endpoint.batchSize } : false,
        timeout: RPC_REQUEST_TIMEOUT_MS,
        retryCount: 0,
      })({ chain, retryCount: 0, timeout: RPC_REQUEST_TIMEOUT_MS });
      return inner;
    };

    const request = (async (args) => {
      const transport = init();
      await acquireAll(limiters);
      return transport.request(args);
    }) as EIP1193RequestFn;

    return createTransport({
      key: `rpc-${role}`,
      name: `${role} RPC (chain ${chainId})`,
      type: "http",
      retryCount: 0,
      timeout: RPC_REQUEST_TIMEOUT_MS,
      request,
    });
  };
}

/**
 * Builds the primary viem client for a chain. Used for `CHAIN_CONSTANTS[id].eth_client`.
 * Construction never touches the environment; the URL is resolved lazily.
 *
 * @param chainId - Chain id present in {@link RPC_CHAINS}.
 * @returns A viem PublicClient for the chain's primary endpoint.
 * @throws When the chain id is not in {@link RPC_CHAINS} (programming error).
 */
export function createPrimaryRpcClient(chainId: number): PublicClient {
  const cfg = RPC_CHAINS[chainId];
  if (!cfg) throw new Error(`No RPC configuration for chain ${chainId}`);
  return createPublicClient({
    chain: cfg.viemChain satisfies Chain as Chain,
    transport: lazyRateLimitedTransport(chainId, "primary"),
  }) as PublicClient;
}

const fallbackClients = new Map<number, PublicClient | null>();

/**
 * Returns the cached fallback client for a chain, or null when the chain has
 * no fallback (unknown chain, `ENVIO_<CHAIN>_FALLBACK_RPC_URL=none`, fallback
 * equal to primary, or primary itself unresolvable).
 *
 * @param chainId - Chain to get the fallback client for.
 * @returns A viem PublicClient or null.
 */
export function createFallbackRpcClient(chainId: number): PublicClient | null {
  if (fallbackClients.has(chainId)) return fallbackClients.get(chainId) ?? null;
  const cfg = RPC_CHAINS[chainId];
  let client: PublicClient | null = null;
  // No second endpoint under tests unless one is injected.
  if (cfg && !isTestEnvironment()) {
    let hasFallback = false;
    try {
      hasFallback = resolveRpcEndpoints(chainId).fallback !== null;
    } catch {
      hasFallback = false;
    }
    if (hasFallback) {
      client = createPublicClient({
        chain: cfg.viemChain satisfies Chain as Chain,
        transport: lazyRateLimitedTransport(chainId, "fallback"),
      }) as PublicClient;
    }
  }
  fallbackClients.set(chainId, client);
  return client;
}

/**
 * Overrides (or with `undefined`, clears) the cached fallback client for a
 * chain. Tests only.
 *
 * @param chainId - Chain to override.
 * @param client - Client to return, null for "no fallback", undefined to reset.
 * @returns Nothing.
 */
export function setFallbackRpcClientForTests(
  chainId: number,
  client: PublicClient | null | undefined,
): void {
  if (client === undefined) fallbackClients.delete(chainId);
  else fallbackClients.set(chainId, client);
}

/**
 * Describes the endpoints a chain will use, with credentials redacted.
 *
 * @param chainId - Chain to describe.
 * @returns e.g. `primary=https://lb.drpc.live/base/<redacted> (drpc-key) fallback=https://mainnet.base.org (default)`.
 */
export function describeRpcEndpoints(chainId: number): string {
  const r = resolveRpcEndpoints(chainId);
  const fb = r.fallback
    ? `${redactRpcUrl(r.fallback.url)} (${r.fallback.source})`
    : "none";
  return `primary=${redactRpcUrl(r.primary.url)} (${r.primary.source}) fallback=${fb}`;
}
