import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, RPC_APP_RETRY } from "../Constants";
import {
  ErrorType,
  RPC_ERROR_POLICY,
  describeRpcError,
  getErrorType,
  sleep,
} from "./Helpers";
import { createFallbackRpcClient } from "./RpcClient";
import { RpcConfigError, assertRpcConfigAtStartup } from "./RpcConfig";

/**
 * RPC execution layer shared by every effect: retry with backoff on the
 * primary endpoint, then the chain's fallback endpoint, then (only if both
 * fail) the caller's default value, which is always reported via a structured
 * log line and a counter. Nothing here caches; caching decisions live in
 * {@link import("./RpcEffect").createRpcEffect}.
 */

// Fail at startup, naming every missing variable, rather than on the first
// RPC call hours into a sync. Skipped under vitest (see assertRpcConfigAtStartup).
const startupWarnings = assertRpcConfigAtStartup();
let startupWarningsLogged = false;

/** Minimal logger shape (envio's `Logger` satisfies it). */
export type RpcLogger = {
  error: (msg: string, params?: Record<string, unknown> | Error) => void;
  warn: (msg: string, params?: Record<string, unknown> | Error) => void;
  info?: (msg: string, params?: Record<string, unknown> | Error) => void;
};

/** Anything with a logger: an effect context or a handler context. */
export type RpcCallContext = { log: RpcLogger };

/** Identifies one logical RPC operation for logs and metrics. */
export type RpcOperation = {
  /** Operation name, e.g. `getSwapFee` or `getTokenMetadata.decimals`. */
  name: string;
  chainId: number;
  /** Extra key/values for the log line (addresses, block). */
  details?: Record<string, string | number | undefined>;
};

/**
 * Result of {@link executeRpc}. `usedDefault` is true iff `value` is the
 * caller's default because no endpoint produced an answer. `errorClass` is the
 * class of the failure that produced the default (undefined on success).
 */
export type RpcResult<T> = {
  value: T;
  usedDefault: boolean;
  errorClass: ErrorType | undefined;
};

/**
 * True when a result may be persisted in the effect cache: a real answer, or
 * a default produced by a deterministic contract revert.
 *
 * @param result - Result to check.
 * @returns Whether caching it is safe.
 */
export function isCacheableResult(
  result: Pick<RpcResult<unknown>, "usedDefault" | "errorClass">,
): boolean {
  if (!result.usedDefault) return true;
  return (
    result.errorClass !== undefined &&
    RPC_ERROR_POLICY[result.errorClass].cacheableDefault
  );
}

/**
 * Of several error classes from composed legs, returns the one that should
 * drive caching: any non-cacheable class outranks a cacheable revert.
 *
 * @param classes - Per-leg classes (undefined for legs that succeeded).
 * @returns The worst class, or undefined when every leg succeeded.
 */
export function mostCacheBlockingErrorClass(
  ...classes: (ErrorType | undefined)[]
): ErrorType | undefined {
  const present = classes.filter((c): c is ErrorType => c !== undefined);
  if (present.length === 0) return undefined;
  return (
    present.find((c) => !RPC_ERROR_POLICY[c].cacheableDefault) ?? present[0]
  );
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Outcome of one {@link executeRpc} call. */
export type RpcOutcome =
  | "primary_ok"
  | "fallback_ok"
  | "default_revert"
  | "default_transient";

type ChainStats = Record<RpcOutcome, number> & {
  primaryFailures: number;
  retries: number;
};

const stats = new Map<number, ChainStats>();
const STATS_LOG_INTERVAL_MS = 60_000;
let lastStatsLog = Date.now();

const emptyStats = (): ChainStats => ({
  primary_ok: 0,
  fallback_ok: 0,
  default_revert: 0,
  default_transient: 0,
  primaryFailures: 0,
  retries: 0,
});

const chainStats = (chainId: number): ChainStats => {
  let s = stats.get(chainId);
  if (!s) {
    s = emptyStats();
    stats.set(chainId, s);
  }
  return s;
};

/**
 * Snapshot of the process-wide RPC counters, per chain. `default_transient`
 * is the number an operator should alert on: each one is a value the indexer
 * computed from a stand-in because no RPC answered.
 *
 * @returns A copy of the counters keyed by chain id.
 */
export function getRpcStats(): Record<number, ChainStats> {
  return Object.fromEntries(
    [...stats.entries()].map(([k, v]) => [k, { ...v }]),
  );
}

/** Resets counters (tests only). @returns Nothing. */
export function resetRpcStatsForTests(): void {
  stats.clear();
  lastStatsLog = Date.now();
}

function maybeLogStats(context: RpcCallContext): void {
  if (!startupWarningsLogged) {
    startupWarningsLogged = true;
    for (const w of startupWarnings) context.log.warn(`[rpc.config] ${w}`);
  }
  const now = Date.now();
  if (now - lastStatsLog < STATS_LOG_INTERVAL_MS) return;
  lastStatsLog = now;
  // Call through the logger object (envio's methods may rely on `this`).
  const log = (msg: string, params: Record<string, unknown>) =>
    context.log.info
      ? context.log.info(msg, params)
      : context.log.warn(msg, params);
  for (const [chainId, s] of stats) {
    const total =
      s.primary_ok + s.fallback_ok + s.default_revert + s.default_transient;
    log(`[rpc.stats] chain=${chainId}`, {
      event: "rpc.stats",
      chainId,
      total,
      ...s,
      fallbackRate: total ? (s.fallback_ok + s.default_transient) / total : 0,
      transientDefaultRate: total ? s.default_transient / total : 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

let sleepImpl: (ms: number) => Promise<void> = sleep;

/**
 * Replaces the backoff sleep (tests only, to avoid real delays).
 *
 * @param fn - Replacement sleep, or undefined to restore the real one.
 * @returns Nothing.
 */
export function setRpcSleepForTests(
  fn: ((ms: number) => Promise<void>) | undefined,
): void {
  sleepImpl = fn ?? sleep;
}

/**
 * Backoff delay before retry number `attempt` (0-based): exponential with
 * full jitter, capped. Rate limits start from a longer base.
 *
 * @param attempt - Retry index (0 for the first retry).
 * @param errorType - Class of the failure being retried.
 * @param random - Jitter source in [0, 1).
 * @returns Delay in milliseconds.
 */
export function computeRetryDelayMs(
  attempt: number,
  errorType: ErrorType,
  random: () => number = Math.random,
): number {
  const base =
    errorType === ErrorType.RATE_LIMIT
      ? RPC_APP_RETRY.rateLimitBaseDelayMs
      : RPC_APP_RETRY.baseDelayMs;
  const ceiling = Math.min(base * 2 ** attempt, RPC_APP_RETRY.maxDelayMs);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/**
 * Runs `fn` against one endpoint, retrying classes whose policy allows it, up
 * to {@link RPC_APP_RETRY}.maxAttempts attempts in total.
 *
 * @param fn - The RPC call. Invoked once per attempt.
 * @param onRetry - Called before each retry (for metrics).
 * @returns The first successful result.
 * @throws The last error when it is not retryable or attempts are exhausted.
 */
export async function runWithRpcRetry<T>(
  fn: () => Promise<T>,
  onRetry?: (errorType: ErrorType) => void,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const errorType = getErrorType(error);
      const policy = RPC_ERROR_POLICY[errorType];
      if (
        !policy.retrySameEndpoint ||
        attempt + 1 >= RPC_APP_RETRY.maxAttempts
      ) {
        throw error;
      }
      onRetry?.(errorType);
      await sleepImpl(computeRetryDelayMs(attempt, errorType));
    }
  }
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

const detailsSuffix = (details: RpcOperation["details"]): string =>
  Object.entries(details ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}=${v}`)
    .join("");

/**
 * Executes one RPC operation on a chain: primary endpoint with retries, then
 * the fallback endpoint with retries for any primary failure that is not a
 * deterministic revert, then `defaultValue`.
 *
 * Every default is logged once with a structured payload
 * (`event: "rpc.default_used"`, chain, operation, error class, cacheable) and
 * counted in {@link getRpcStats}; deterministic reverts log at warn, all other
 * defaults at error. Configuration errors are thrown, never defaulted.
 *
 * @param context - Effect or handler context (for logging).
 * @param op - Operation identity for logs/metrics.
 * @param defaultValue - Value returned when no endpoint answers.
 * @param call - Performs the RPC with the given client.
 * @returns `{ value, usedDefault, errorClass }`.
 * @throws {RpcConfigError} When the chain's RPC is not configured.
 */
export async function executeRpc<T>(
  context: RpcCallContext,
  op: RpcOperation,
  defaultValue: T,
  call: (client: PublicClient) => Promise<T>,
): Promise<RpcResult<T>> {
  maybeLogStats(context);
  const s = chainStats(op.chainId);
  const onRetry = () => {
    s.retries++;
  };
  const primary = CHAIN_CONSTANTS[op.chainId]?.eth_client;
  if (!primary) {
    throw new RpcConfigError(`Unsupported chainId: ${op.chainId}`);
  }

  let finalError: unknown;
  let endpoint: "primary" | "fallback" = "primary";
  try {
    const value = await runWithRpcRetry(() => call(primary), onRetry);
    s.primary_ok++;
    return { value, usedDefault: false, errorClass: undefined };
  } catch (primaryError) {
    finalError = primaryError;
    const primaryType = getErrorType(primaryError);
    const policy = RPC_ERROR_POLICY[primaryType];
    if (policy.fatal) throw primaryError;
    if (primaryType !== ErrorType.CONTRACT_REVERT) s.primaryFailures++;

    const fallbackClient = policy.tryFallback
      ? createFallbackRpcClient(op.chainId)
      : null;
    if (fallbackClient) {
      context.log.warn(
        `[rpc] ${op.name} chain=${op.chainId} primary failed (${primaryType}); trying fallback.${detailsSuffix(op.details)}`,
        {
          event: "rpc.primary_failed",
          op: op.name,
          chainId: op.chainId,
          errorClass: primaryType,
          error: describeRpcError(primaryError),
        },
      );
      endpoint = "fallback";
      try {
        const value = await runWithRpcRetry(
          () => call(fallbackClient),
          onRetry,
        );
        s.fallback_ok++;
        return { value, usedDefault: false, errorClass: undefined };
      } catch (fallbackError) {
        if (getErrorType(fallbackError) === ErrorType.CONFIGURATION)
          throw fallbackError;
        finalError = fallbackError;
      }
    }
  }

  const errorClass = getErrorType(finalError);
  const cacheable = RPC_ERROR_POLICY[errorClass].cacheableDefault;
  if (cacheable) s.default_revert++;
  else s.default_transient++;
  const message = `[rpc] ${op.name} chain=${op.chainId} returned default after ${endpoint} failed (${errorClass}).${detailsSuffix(op.details)} ${describeRpcError(finalError)}`;
  const params = {
    event: "rpc.default_used",
    op: op.name,
    chainId: op.chainId,
    errorClass,
    endpoint,
    cacheable,
    ...op.details,
  };
  if (cacheable) context.log.warn(message, params);
  else context.log.error(message, params);
  return { value: defaultValue, usedDefault: true, errorClass };
}
