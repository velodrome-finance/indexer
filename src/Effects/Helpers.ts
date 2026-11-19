import {
  AbiDecodingDataSizeInvalidError,
  AbiDecodingDataSizeTooSmallError,
  AbiDecodingZeroDataError,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  HttpRequestError,
  InvalidBytesBooleanError,
  RpcRequestError,
  TimeoutError,
} from "viem";
import { RpcConfigError } from "./RpcConfig";

/**
 * Failure classes for RPC calls. Each class has a fixed policy, see
 * {@link RPC_ERROR_POLICY}.
 */
export enum ErrorType {
  /** The EVM deterministically reverted, or the call returned no/short data
   * (no contract at the address, function not implemented). Same input, same
   * answer on any honest node: safe to cache a default. */
  CONTRACT_REVERT = "CONTRACT_REVERT",
  /** The node does not hold state for the requested block (pruned node behind
   * a load balancer, "missing trie node", "insufficient changesets", "header
   * not found"). Another node or provider can answer. */
  HISTORICAL_STATE_NOT_AVAILABLE = "HISTORICAL_STATE_NOT_AVAILABLE",
  /** HTTP 429 or JSON-RPC limit-exceeded codes. */
  RATE_LIMIT = "RATE_LIMIT",
  /** Request exceeded the transport timeout. */
  TIMEOUT = "TIMEOUT",
  /** HTTP 5xx or JSON-RPC internal error. */
  SERVER_ERROR = "SERVER_ERROR",
  /** Connection-level failure (DNS, reset, refused): no HTTP status. */
  NETWORK_ERROR = "NETWORK_ERROR",
  /** HTTP 401/402/403: bad key, exhausted quota or plan restriction. */
  AUTH_OR_QUOTA = "AUTH_OR_QUOTA",
  /** HTTP 404 or other non-retryable 4xx from the endpoint itself. */
  ENDPOINT_ERROR = "ENDPOINT_ERROR",
  /** JSON-RPC method not found / not supported by this endpoint. */
  METHOD_NOT_SUPPORTED = "METHOD_NOT_SUPPORTED",
  /** JSON-RPC parse/invalid-request/invalid-params errors. */
  INVALID_REQUEST = "INVALID_REQUEST",
  /** RPC URL missing or malformed in the environment. Fatal. */
  CONFIGURATION = "CONFIGURATION",
  /** Anything else. Treated as transient. */
  UNKNOWN = "UNKNOWN",
}

/** Retry / fallback / cache policy for one {@link ErrorType}. */
export type RpcErrorPolicy = {
  /** Retry on the same endpoint with backoff. */
  retrySameEndpoint: boolean;
  /** Try the chain's fallback endpoint once the primary gives up. */
  tryFallback: boolean;
  /** A default returned because of this class may be persisted in the effect cache. */
  cacheableDefault: boolean;
  /** Propagate instead of returning a default (configuration bugs). */
  fatal: boolean;
};

const transient: RpcErrorPolicy = {
  retrySameEndpoint: true,
  tryFallback: true,
  cacheableDefault: false,
  fatal: false,
};
const endpointBroken: RpcErrorPolicy = {
  retrySameEndpoint: false,
  tryFallback: true,
  cacheableDefault: false,
  fatal: false,
};

/** Policy table. The only cacheable class is a deterministic revert. */
export const RPC_ERROR_POLICY: Readonly<Record<ErrorType, RpcErrorPolicy>> = {
  [ErrorType.CONTRACT_REVERT]: {
    retrySameEndpoint: false,
    tryFallback: false,
    cacheableDefault: true,
    fatal: false,
  },
  // The dRPC balancer mixes archive and pruned nodes: a retry on the same URL
  // usually lands on an archive node, so retry before moving to the fallback.
  [ErrorType.HISTORICAL_STATE_NOT_AVAILABLE]: transient,
  [ErrorType.RATE_LIMIT]: transient,
  [ErrorType.TIMEOUT]: transient,
  [ErrorType.SERVER_ERROR]: transient,
  [ErrorType.NETWORK_ERROR]: transient,
  [ErrorType.UNKNOWN]: transient,
  [ErrorType.AUTH_OR_QUOTA]: endpointBroken,
  [ErrorType.ENDPOINT_ERROR]: endpointBroken,
  [ErrorType.METHOD_NOT_SUPPORTED]: endpointBroken,
  [ErrorType.INVALID_REQUEST]: endpointBroken,
  [ErrorType.CONFIGURATION]: {
    retrySameEndpoint: false,
    tryFallback: false,
    cacheableDefault: false,
    fatal: true,
  },
};

/**
 * Provider messages meaning "this node lacks state for that block". Matched
 * ONLY against the provider's own error text (`RpcRequestError.details`, or the
 * `reason` viem copies from it into a data-less revert), never against the
 * full message, stack, URL or request body, so calldata cannot trigger it.
 * Structured codes cannot express this: geth/reth/erigon report it as -32000,
 * -32603 or even as an execution-revert-shaped error with no revert data.
 */
const STATE_UNAVAILABLE_PATTERN =
  /insufficient changesets|missing trie node|header not found|unknown block|block not found|historical state|state histor(y|ies)|state (is )?(not available|unavailable)|required historical state|first available state|old data not available|distance to target block exceeds|pruned/i;

/** Provider text for a genuine EVM revert without revert data. */
const EXECUTION_REVERTED_PATTERN = /^execution reverted\b/i;

const RATE_LIMIT_CODES = new Set([429, -32005, -32029, -32090]);
const METHOD_CODES = new Set([-32601, -32004, 4200]);
const INVALID_REQUEST_CODES = new Set([-32700, -32600, -32602]);
const AUTH_CODES = new Set([4100]);
const EXECUTION_REVERTED_CODE = 3;

/** Return data shorter/odder than the ABI says: deterministic for that contract. */
const CURSOR_DECODE_ERRORS = new Set([
  "PositionOutOfBoundsError",
  "NegativeOffsetError",
  "RecursiveReadLimitExceededError",
]);

const hasNumericCode = (e: unknown): e is { code: number } =>
  typeof (e as { code?: unknown })?.code === "number";

/** Deepest error in the `cause` chain matching `pred` (viem's walk returns the outermost). */
function innermost(
  error: unknown,
  pred: (e: unknown) => boolean,
): unknown | undefined {
  let found: unknown;
  let cur: unknown = error;
  for (let depth = 0; cur && depth < 32; depth++) {
    if (pred(cur)) found = cur;
    cur = (cur as { cause?: unknown }).cause;
  }
  return found;
}

function classifyProviderText(text: string | undefined): ErrorType | null {
  if (!text) return null;
  if (STATE_UNAVAILABLE_PATTERN.test(text))
    return ErrorType.HISTORICAL_STATE_NOT_AVAILABLE;
  return null;
}

function classifyRevert(err: ContractFunctionRevertedError): ErrorType {
  // Revert data (even "0x") means the EVM ran the call and reverted.
  if (err.raw !== undefined) return ErrorType.CONTRACT_REVERT;
  const byText = classifyProviderText(err.reason);
  if (byText) return byText;
  if (err.reason === undefined || EXECUTION_REVERTED_PATTERN.test(err.reason))
    return ErrorType.CONTRACT_REVERT;
  // viem turns any code-3/-32603 response into a "revert"; without revert data
  // and with a non-revert reason it is a node-side failure, not the contract.
  return ErrorType.UNKNOWN;
}

function classifyRpcCode(code: number, details: string | undefined): ErrorType {
  const byText = classifyProviderText(details);
  if (byText) return byText;
  if (code === EXECUTION_REVERTED_CODE) return ErrorType.CONTRACT_REVERT;
  if (code === -32000 && details && EXECUTION_REVERTED_PATTERN.test(details))
    return ErrorType.CONTRACT_REVERT;
  if (RATE_LIMIT_CODES.has(code)) return ErrorType.RATE_LIMIT;
  if (METHOD_CODES.has(code)) return ErrorType.METHOD_NOT_SUPPORTED;
  if (INVALID_REQUEST_CODES.has(code)) return ErrorType.INVALID_REQUEST;
  if (AUTH_CODES.has(code)) return ErrorType.AUTH_OR_QUOTA;
  if (code === -32603) return ErrorType.SERVER_ERROR;
  return ErrorType.UNKNOWN;
}

function classifyHttpStatus(status: number | undefined): ErrorType {
  if (status === undefined) return ErrorType.NETWORK_ERROR;
  if (status === 429) return ErrorType.RATE_LIMIT;
  if (status === 408) return ErrorType.TIMEOUT;
  if (status === 401 || status === 402 || status === 403)
    return ErrorType.AUTH_OR_QUOTA;
  if (status >= 500) return ErrorType.SERVER_ERROR;
  if (status >= 400) return ErrorType.ENDPOINT_ERROR;
  return ErrorType.UNKNOWN;
}

/**
 * Classifies a thrown value using viem's typed errors: `BaseError.walk` over
 * the cause chain, `HttpRequestError.status`, JSON-RPC `code`, and the
 * revert's raw data. Never inspects message or stack text, except the
 * provider's own error string for state-unavailable responses (see
 * {@link STATE_UNAVAILABLE_PATTERN}).
 *
 * @param error - The thrown value.
 * @returns The {@link ErrorType}; {@link ErrorType.UNKNOWN} (transient) when nothing matches.
 */
export function getErrorType(error: unknown): ErrorType {
  if (error instanceof RpcConfigError) return ErrorType.CONFIGURATION;
  if (!(error instanceof BaseError)) return ErrorType.UNKNOWN;
  // viem wraps non-viem errors thrown by a transport in UnknownRpcError.
  if (error.walk((e) => e instanceof RpcConfigError))
    return ErrorType.CONFIGURATION;

  if (error.walk((e) => e instanceof TimeoutError)) return ErrorType.TIMEOUT;

  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (revert) return classifyRevert(revert as ContractFunctionRevertedError);

  if (
    error.walk(
      (e) =>
        e instanceof ContractFunctionZeroDataError ||
        e instanceof AbiDecodingZeroDataError ||
        e instanceof AbiDecodingDataSizeTooSmallError ||
        e instanceof AbiDecodingDataSizeInvalidError ||
        e instanceof InvalidBytesBooleanError ||
        // viem's cursor errors are not exported from the package root.
        (e instanceof BaseError && CURSOR_DECODE_ERRORS.has(e.name)),
    )
  ) {
    return ErrorType.CONTRACT_REVERT;
  }

  const httpErr = error.walk((e) => e instanceof HttpRequestError) as
    | HttpRequestError
    | undefined;
  if (httpErr) return classifyHttpStatus(httpErr.status);

  const rpcRequest = error.walk((e) => e instanceof RpcRequestError) as
    | RpcRequestError
    | undefined;
  // Innermost code wins: viem wraps unrecognised codes in UnknownRpcError (-1).
  const coded = innermost(error, hasNumericCode) as
    | { code: number; details?: string; message?: string }
    | undefined;
  const code = rpcRequest?.code ?? coded?.code;
  if (code !== undefined) {
    // Provider text: RpcRequestError.details, or the raw JSON-RPC error object's
    // message (custom/EIP-1193 transports), never a viem BaseError's formatted message.
    const details =
      rpcRequest?.details ??
      (coded instanceof BaseError ? coded.details : coded?.message);
    return classifyRpcCode(code, details);
  }
  return ErrorType.UNKNOWN;
}

/**
 * Returns the retry/fallback/cache policy for a thrown value.
 *
 * @param error - The thrown value.
 * @returns The {@link RpcErrorPolicy} of its class.
 */
export function getErrorPolicy(error: unknown): RpcErrorPolicy {
  return RPC_ERROR_POLICY[getErrorType(error)];
}

/**
 * Resolves after a given delay. Used for retry backoff in RPC operations.
 *
 * @param ms - Delay in milliseconds before the promise resolves.
 * @returns A promise that resolves with `undefined` after `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Short, single-line description of an RPC failure for logs: the viem short
 * message plus the provider's details when present. Never includes the
 * request body or URL (which may carry an API key).
 *
 * @param error - The thrown value.
 * @returns A one-line summary, truncated to 300 characters.
 */
export function describeRpcError(error: unknown): string {
  let text: string;
  if (error instanceof BaseError) {
    const rpc = error.walk((e) => e instanceof RpcRequestError) as
      | RpcRequestError
      | undefined;
    const http = error.walk((e) => e instanceof HttpRequestError) as
      | HttpRequestError
      | undefined;
    const revert = error.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | undefined;
    const parts = [error.shortMessage];
    if (revert?.reason) parts.push(`reason=${revert.reason}`);
    if (rpc) parts.push(`code=${rpc.code} details=${rpc.details}`);
    if (http) parts.push(`http=${http.status ?? "none"}`);
    text = parts.join(" | ");
  } else if (error instanceof Error) {
    text = error.message;
  } else {
    text = String(error);
  }
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 300 ? `${oneLine.slice(0, 297)}...` : oneLine;
}
