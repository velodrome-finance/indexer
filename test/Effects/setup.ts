/**
 * Shared test harness for Effects tests.
 *
 * `createMockEffectContext` mirrors envio's behaviour that matters for cache
 * correctness: every effect invocation gets its OWN context object whose
 * `cache` flag starts at the effect's `cache` option, so an inner effect's
 * `context.cache = false` does not leak to its caller.
 */
import {
  type Abi,
  type Chain,
  type PublicClient,
  createPublicClient,
  custom,
} from "viem";
import { optimism } from "viem/chains";
import { type Mock, vi } from "vitest";
import { CHAIN_CONSTANTS } from "../../src/Constants";
import { setFallbackRpcClientForTests } from "../../src/Effects/RpcClient";
import {
  resetRpcStatsForTests,
  setRpcSleepForTests,
} from "../../src/Effects/RpcGateway";

export type MockEffect = {
  name: string;
  handler: (args: { input: unknown; context: unknown }) => unknown;
};

type LogFn = (msg: string, params?: Record<string, unknown> | Error) => void;

export type MockLog = {
  error: Mock<LogFn>;
  warn: Mock<LogFn>;
  info: Mock<LogFn>;
};

export type MockEffectContext = {
  effect: (effect: MockEffect, input: unknown) => Promise<unknown>;
  log: MockLog;
  cache: boolean;
  /** `cache` flag left by each nested invocation, keyed by effect name. */
  childCacheFlags: Array<{ name: string; cache: boolean }>;
};

/**
 * Creates a mock effect context. Nested `context.effect` calls run the inner
 * handler with a fresh child context (sharing the log), like envio.
 *
 * @param cache - Initial value of `cache` (the effect's `cache` option).
 * @returns The mock context.
 */
export function createMockEffectContext(cache = true): MockEffectContext {
  const log: MockLog = {
    error: vi.fn<LogFn>(),
    warn: vi.fn<LogFn>(),
    info: vi.fn<LogFn>(),
  };
  const childCacheFlags: MockEffectContext["childCacheFlags"] = [];
  const make = (initialCache: boolean): MockEffectContext => {
    const ctx = {
      log,
      cache: initialCache,
      childCacheFlags,
    } as MockEffectContext;
    ctx.effect = async (effect: MockEffect, input: unknown) => {
      const child = make(true);
      const out = await effect.handler({ input, context: child });
      childCacheFlags.push({ name: effect.name, cache: child.cache });
      return out;
    };
    return ctx;
  };
  return make(cache);
}

/**
 * Runs an effect's handler directly with a fresh mock context.
 *
 * @param effect - The envio effect (has `.handler` at runtime).
 * @param input - Effect input.
 * @returns The output and the context (inspect `cache` / `log`).
 */
export async function runEffect<O = unknown>(
  effect: unknown,
  input: unknown,
): Promise<{ output: O; context: MockEffectContext }> {
  const context = createMockEffectContext(true);
  const output = (await (effect as MockEffect).handler({
    input,
    context,
  })) as O;
  return { output, context };
}

type ChainConstantsLike = Record<number, { eth_client: PublicClient }>;

/**
 * Installs mock primary/fallback clients for a chain and disables backoff
 * sleeps. Returns a restore function.
 *
 * @param chainId - Chain to mock.
 * @param primary - Primary client (any object with the methods the code under test calls).
 * @param fallback - Fallback client, or null for "no fallback".
 * @returns Function restoring the original state.
 */
export function installRpcMocks(
  chainId: number,
  primary: object,
  fallback: object | null = null,
): () => void {
  const constants = CHAIN_CONSTANTS as unknown as ChainConstantsLike;
  const original = constants[chainId];
  constants[chainId] = {
    ...original,
    eth_client: primary as PublicClient,
  };
  setFallbackRpcClientForTests(chainId, fallback as PublicClient | null);
  setRpcSleepForTests(async () => {});
  resetRpcStatsForTests();
  return () => {
    constants[chainId] = original;
    setFallbackRpcClientForTests(chainId, undefined);
    setRpcSleepForTests(undefined);
    resetRpcStatsForTests();
  };
}

/**
 * Builds a real viem client whose transport fails every request with `error`
 * (thrown exactly as an HTTP/JSON-RPC transport would), so tests exercise
 * viem's genuine error wrapping (`ContractFunctionExecutionError` → ...).
 *
 * @param error - Value thrown by the transport (plain `{code, message, data}` or a viem error).
 * @param chain - Chain for the client.
 * @returns A PublicClient.
 */
export function failingViemClient(
  error: unknown,
  chain: Chain = optimism,
): PublicClient {
  return createPublicClient({
    chain,
    transport: custom(
      {
        async request() {
          throw error;
        },
      },
      { retryCount: 0 },
    ),
  }) as PublicClient;
}

/**
 * Builds a real viem client whose transport answers `eth_call` with `result`.
 *
 * @param result - Hex returned for every eth_call.
 * @returns A PublicClient.
 */
export function answeringViemClient(result: `0x${string}`): PublicClient {
  return createPublicClient({
    chain: optimism,
    transport: custom(
      {
        async request({ method }: { method: string }) {
          if (method === "eth_call") return result;
          throw new Error(`unexpected ${method}`);
        },
      },
      { retryCount: 0 },
    ),
  }) as PublicClient;
}

/** Minimal ABI with `decimals()` for error-shape tests. */
export const DECIMALS_ABI: Abi = [
  {
    inputs: [],
    name: "decimals",
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
];

/**
 * Calls `decimals()` on `client` and returns the thrown error.
 *
 * @param client - Client from {@link failingViemClient} / {@link answeringViemClient}.
 * @returns The error viem raised (fails the test if the call succeeds).
 */
export async function captureReadError(client: PublicClient): Promise<unknown> {
  try {
    await client.readContract({
      address: "0x4200000000000000000000000000000000000006",
      abi: DECIMALS_ABI,
      functionName: "decimals",
    });
  } catch (e) {
    return e;
  }
  throw new Error("expected readContract to throw");
}
