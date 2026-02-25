import { S, createEffect } from "envio";
import {
  CHAIN_CONSTANTS,
  PriceOracleType,
  RPC_GATEWAY_PREFIX,
} from "../Constants";
import {
  GLOBAL_REQUESTS_PER_SECOND,
  RPC_APP_RETRY,
  SLOW_REQUEST_MS,
  VERY_SLOW_REQUEST_MS,
} from "../Constants";
import {
  ErrorType,
  getErrorType,
  handleEffectErrorReturn,
  sleep,
} from "./Helpers";
import { fetchRootPoolAddress } from "./fetchers/RootPool";
import { fetchSwapFee } from "./fetchers/SwapFee";
import { fetchTokenDetails, fetchTokenPrice } from "./fetchers/Token";
import { fetchTokensDeposited } from "./fetchers/Voter";

export enum EffectType {
  GET_TOKEN_DETAILS = "getTokenDetails",
  GET_TOKEN_PRICE = "getTokenPrice",
  GET_TOKENS_DEPOSITED = "getTokensDeposited",
  GET_SWAP_FEE = "getSwapFee",
  GET_ROOT_POOL_ADDRESS = "getRootPoolAddress",
}

/** Log name for a gateway operation; use sub for nested operations (e.g. "tokenDetails"). */
function rpcGatewayOpName(type: EffectType, sub?: string): string {
  return sub
    ? `${RPC_GATEWAY_PREFIX}.${type}.${sub}`
    : `${RPC_GATEWAY_PREFIX}.${type}`;
}

/**
 * Single source of truth for each gateway operation: input and output schemas.
 * When adding an operation:
 * 1) add to EffectType,
 * 2) add an entry here,
 * 3) add to RpcGatewayInputPayloadByType and RpcGatewayOutputByType below.
 */
const RPC_GATEWAY_OPERATIONS = {
  [EffectType.GET_TOKEN_DETAILS]: {
    inputSchema: {
      contractAddress: S.string,
      chainId: S.number,
    },
    outputSchema: {
      name: S.string,
      decimals: S.number,
      symbol: S.string,
    },
  },
  [EffectType.GET_TOKEN_PRICE]: {
    inputSchema: {
      tokenAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
    },
    outputSchema: {
      pricePerUSDNew: S.bigint,
      priceOracleType: S.string,
    },
  },
  [EffectType.GET_TOKENS_DEPOSITED]: {
    inputSchema: {
      rewardTokenAddress: S.string,
      gaugeAddress: S.string,
      blockNumber: S.number,
      chainId: S.number,
    },
    outputSchema: {
      value: S.optional(S.bigint),
    },
  },
  [EffectType.GET_SWAP_FEE]: {
    inputSchema: {
      poolAddress: S.string,
      factoryAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
    },
    outputSchema: {
      value: S.optional(S.bigint),
    },
  },
  [EffectType.GET_ROOT_POOL_ADDRESS]: {
    inputSchema: {
      chainId: S.number,
      factory: S.string,
      token0: S.string,
      token1: S.string,
      poolType: S.number,
    },
    outputSchema: {
      value: S.string,
    },
  },
} as const satisfies Record<
  EffectType,
  { inputSchema: object; outputSchema: object }
>;

const RPC_GATEWAY_INPUT_SCHEMA = S.union([
  RPC_GATEWAY_OPERATIONS[EffectType.GET_TOKEN_DETAILS].inputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.GET_TOKEN_PRICE].inputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.GET_TOKENS_DEPOSITED].inputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.GET_SWAP_FEE].inputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.GET_ROOT_POOL_ADDRESS].inputSchema,
]);

const RPC_GATEWAY_OUTPUT_SCHEMA = S.union([
  RPC_GATEWAY_OPERATIONS[EffectType.GET_TOKEN_DETAILS].outputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.GET_TOKEN_PRICE].outputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.GET_TOKENS_DEPOSITED].outputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.GET_SWAP_FEE].outputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.GET_ROOT_POOL_ADDRESS].outputSchema,
]);

/**
 * Input payload per operation (no discriminant). Keep in sync with {@link RPC_GATEWAY_OPERATIONS} inputSchema.
 * {@link RpcGatewayInputByType} adds `type: K` from the key so the mapping key is the type.
 */
type RpcGatewayInputPayloadByType = {
  [EffectType.GET_TOKEN_DETAILS]: { contractAddress: string; chainId: number };
  [EffectType.GET_TOKEN_PRICE]: {
    tokenAddress: string;
    chainId: number;
    blockNumber: number;
  };
  [EffectType.GET_TOKENS_DEPOSITED]: {
    rewardTokenAddress: string;
    gaugeAddress: string;
    blockNumber: number;
    chainId: number;
  };
  [EffectType.GET_SWAP_FEE]: {
    poolAddress: string;
    factoryAddress: string;
    chainId: number;
    blockNumber: number;
  };
  [EffectType.GET_ROOT_POOL_ADDRESS]: {
    chainId: number;
    factory: string;
    token0: string;
    token1: string;
    poolType: number;
  };
};

/**
 * Input shape per operation: for each effect type K, `{ type: K }` plus that operation's payload.
 * Forms a discriminated union so (1) callers get type-safe payloads per `type`, and (2) the gateway
 * can narrow on `input.type` and see the correct payload in each branch. Used by {@link callRpcGateway}.
 */
export type RpcGatewayInputByType = {
  [K in EffectType]: { type: K } & RpcGatewayInputPayloadByType[K];
};

/** Union of all gateway inputs (discriminated by `type`). */
type RpcGatewayInput = RpcGatewayInputByType[EffectType];

/**
 * Output payload per operation type. Used by {@link callRpcGateway} for typed return.
 * Keep in sync with {@link RPC_GATEWAY_OPERATIONS} outputSchema.
 */
export type RpcGatewayOutputByType = {
  [EffectType.GET_TOKEN_DETAILS]: {
    name: string;
    decimals: number;
    symbol: string;
  };
  [EffectType.GET_TOKEN_PRICE]: {
    pricePerUSDNew: bigint;
    priceOracleType: string;
  };
  [EffectType.GET_TOKENS_DEPOSITED]: { value: bigint | undefined };
  [EffectType.GET_SWAP_FEE]: { value: bigint | undefined };
  [EffectType.GET_ROOT_POOL_ADDRESS]: { value: string };
};

/** Union of all gateway output payloads. */
export type RpcGatewayOutput = RpcGatewayOutputByType[EffectType];

/** Context passed to gateway handler functions (log + optional cache). */
type RpcGatewayHandlerContext = {
  cache?: boolean;
  log: {
    error: (msg: string, err: Error) => void;
    warn: (msg: string) => void;
    info?: (msg: string) => void;
  };
};

const TOKEN_DETAILS_FALLBACK = { name: "", decimals: 0, symbol: "" };

/**
 * Shared RPC gateway effect: all RPC-backed operations go through this single effect
 * so they share one rate-limit bucket. Alchemy allows 100,000 CU over any 10-second
 * period (10,000 CU/s); 3840 calls × 26 CU ≈ 99,840 CU per 10s.
 * When only one category is active it gets the full capacity; when all are active they share.
 * Errors are handled by executeRpcWithFallback (log + fallback); no throw escapes the handler.
 *
 * @see executeRpcWithFallback
 * @see RpcGatewayInput - input shape per operation type
 * @see RpcGatewayOutput - output shape per operation type
 */
export const rpcGateway = createEffect(
  {
    name: "rpcGateway",
    input: RPC_GATEWAY_INPUT_SCHEMA,
    output: RPC_GATEWAY_OUTPUT_SCHEMA,
    rateLimit: {
      calls: GLOBAL_REQUESTS_PER_SECOND,
      per: "second",
    },
    cache: true,
  },
  async ({ input, context }) => {
    const i = input as RpcGatewayInput;
    const ctx: RpcGatewayHandlerContext = context;
    switch (i.type) {
      case EffectType.GET_TOKEN_DETAILS:
        return await handleGetTokenDetails(i, ctx);
      case EffectType.GET_TOKEN_PRICE:
        return await handleGetTokenPrice(i, ctx);
      case EffectType.GET_TOKENS_DEPOSITED:
        return await handleGetTokensDeposited(i, ctx);
      case EffectType.GET_SWAP_FEE:
        return await handleGetSwapFee(i, ctx);
      case EffectType.GET_ROOT_POOL_ADDRESS:
        return await handleGetRootPoolAddress(i, ctx);
      default: {
        const _exhaust: never = i;
        context.log.error(
          "rpcGateway: unexpected input type",
          new Error(
            `rpcGateway: unexpected input type ${JSON.stringify(_exhaust)}`,
          ),
        );
        return undefined as unknown as RpcGatewayOutput;
      }
    }
  },
);

/** Minimal context type for callRpcGateway: any object with effect(gateway, input). */
type RpcGatewayContext = {
  effect(
    effect: typeof rpcGateway,
    input: RpcGatewayInput,
  ): Promise<RpcGatewayOutput>;
};

/**
 * Typed gateway call: pass the operation input and get the narrowed output type.
 * Use this instead of context.effect(rpcGateway, ...) so TypeScript infers the correct output from the input's `type`.
 * The main purpose of this function is to enforce type safety and avoid casting.
 * @param context - The context for the effect.
 * @param input - The input for the effect.
 * @returns The output for the effect.
 */
export async function callRpcGateway<T extends EffectType>(
  context: RpcGatewayContext,
  input: Extract<RpcGatewayInput, { type: T }>,
): Promise<RpcGatewayOutputByType[T]> {
  return context.effect(rpcGateway, input) as unknown as Promise<
    RpcGatewayOutputByType[T]
  >;
}

/**
 * Handles the GET_TOKEN_DETAILS effect.
 * @param i - The input for the effect.
 * @param context - The context for the effect.
 * @returns The token details.
 */
async function handleGetTokenDetails(
  i: RpcGatewayInputByType[EffectType.GET_TOKEN_DETAILS],
  context: RpcGatewayHandlerContext,
): Promise<RpcGatewayOutputByType[EffectType.GET_TOKEN_DETAILS]> {
  const ethClient = CHAIN_CONSTANTS[i.chainId].eth_client;
  const result = await executeRpcWithFallback(
    context,
    rpcGatewayOpName(EffectType.GET_TOKEN_DETAILS),
    { contractAddress: i.contractAddress, chainId: i.chainId },
    TOKEN_DETAILS_FALLBACK,
    () => fetchTokenDetails(i.contractAddress, ethClient),
  );
  return result;
}

/**
 * Handles the GET_TOKEN_PRICE effect.
 * @param i - The input for the effect.
 * @param context - The context for the effect.
 * @returns The token price.
 */
async function handleGetTokenPrice(
  i: RpcGatewayInputByType[EffectType.GET_TOKEN_PRICE],
  context: RpcGatewayHandlerContext,
): Promise<RpcGatewayOutputByType[EffectType.GET_TOKEN_PRICE]> {
  const { tokenAddress, chainId, blockNumber } = i;
  const USDC_ADDRESS = CHAIN_CONSTANTS[chainId].usdc;

  if (tokenAddress === USDC_ADDRESS) {
    return {
      pricePerUSDNew: 10n ** 18n,
      priceOracleType: CHAIN_CONSTANTS[chainId].oracle
        .getType(blockNumber)
        .toString(),
    };
  }

  const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
  const [tokenDetails, USDCTokenDetails] = await Promise.all([
    executeRpcWithFallback(
      context,
      rpcGatewayOpName(EffectType.GET_TOKEN_PRICE, "tokenDetails"),
      { contractAddress: tokenAddress, chainId },
      TOKEN_DETAILS_FALLBACK,
      () => fetchTokenDetails(tokenAddress, ethClient),
    ),
    executeRpcWithFallback(
      context,
      rpcGatewayOpName(EffectType.GET_TOKEN_PRICE, "usdcDetails"),
      { contractAddress: USDC_ADDRESS, chainId },
      TOKEN_DETAILS_FALLBACK,
      () => fetchTokenDetails(USDC_ADDRESS, ethClient),
    ),
  ]);

  const ORACLE_DEPLOYED =
    CHAIN_CONSTANTS[chainId].oracle.startBlock <= blockNumber;
  if (!ORACLE_DEPLOYED) {
    context.log.info?.(
      `[getTokenPrice] Oracle not deployed, returning zero price for ${tokenAddress} on chain ${chainId} at block ${blockNumber}`,
    );
    return {
      pricePerUSDNew: 0n,
      priceOracleType: CHAIN_CONSTANTS[chainId].oracle
        .getType(blockNumber)
        .toString(),
    };
  }

  const WETH_ADDRESS = CHAIN_CONSTANTS[chainId].weth;
  const SYSTEM_TOKEN_ADDRESS =
    CHAIN_CONSTANTS[chainId].rewardToken(blockNumber);
  const connectors = CHAIN_CONSTANTS[chainId].oracle.priceConnectors
    .filter((c) => c.createdBlock <= blockNumber)
    .map((c) => c.address)
    .filter((a) => a !== tokenAddress)
    .filter((a) => a !== WETH_ADDRESS)
    .filter((a) => a !== USDC_ADDRESS)
    .filter((a) => a !== SYSTEM_TOKEN_ADDRESS);

  const operationName = rpcGatewayOpName(EffectType.GET_TOKEN_PRICE);
  const logDetails = { tokenAddress, chainId, blockNumber };
  const fallback = {
    pricePerUSDNew: 0n,
    priceOracleType: CHAIN_CONSTANTS[chainId].oracle
      .getType(blockNumber)
      .toString(),
  };
  const fetcher = () =>
    fetchTokenPrice(
      tokenAddress,
      USDC_ADDRESS,
      SYSTEM_TOKEN_ADDRESS,
      WETH_ADDRESS,
      connectors,
      chainId,
      blockNumber,
      ethClient,
    );

  const priceData = await executeRpcWithFallback(
    context,
    operationName,
    logDetails,
    fallback,
    fetcher,
  );

  let currentPrice: bigint;
  if (
    priceData.priceOracleType === PriceOracleType.V3 ||
    priceData.priceOracleType === PriceOracleType.V4
  ) {
    currentPrice =
      (priceData.pricePerUSDNew * 10n ** BigInt(tokenDetails.decimals)) /
      10n ** BigInt(USDCTokenDetails.decimals);
  } else {
    currentPrice = priceData.pricePerUSDNew;
  }

  if (currentPrice === 0n) {
    context.log.warn(
      `[getTokenPrice] Oracle returned 0 price for ${tokenAddress} on chain ${chainId} at block ${blockNumber}. This means no price path exists.`,
    );
  }

  return {
    pricePerUSDNew: currentPrice,
    priceOracleType: CHAIN_CONSTANTS[chainId].oracle
      .getType(blockNumber)
      .toString(),
  };
}

/**
 * Handles the GET_TOKENS_DEPOSITED effect.
 * @param i - The input for the effect.
 * @param context - The context for the effect.
 * @returns The tokens deposited.
 */
async function handleGetTokensDeposited(
  i: RpcGatewayInputByType[EffectType.GET_TOKENS_DEPOSITED],
  context: RpcGatewayHandlerContext,
): Promise<RpcGatewayOutputByType[EffectType.GET_TOKENS_DEPOSITED]> {
  const ethClient = CHAIN_CONSTANTS[i.chainId].eth_client;

  const operationName = rpcGatewayOpName(EffectType.GET_TOKENS_DEPOSITED);
  const logDetails = {
    gaugeAddress: i.gaugeAddress,
    blockNumber: i.blockNumber,
  };
  const fallback = undefined;
  const fetcher = () =>
    fetchTokensDeposited(
      i.rewardTokenAddress,
      i.gaugeAddress,
      i.blockNumber,
      ethClient,
    );

  const result = await executeRpcWithFallback(
    context,
    operationName,
    logDetails,
    fallback,
    fetcher,
  );

  return { value: result };
}

/**
 * Handles the GET_SWAP_FEE effect.
 * @param i - The input for the effect.
 * @param context - The context for the effect.
 * @returns The swap fee.
 */
async function handleGetSwapFee(
  i: RpcGatewayInputByType[EffectType.GET_SWAP_FEE],
  context: RpcGatewayHandlerContext,
): Promise<RpcGatewayOutputByType[EffectType.GET_SWAP_FEE]> {
  const ethClient = CHAIN_CONSTANTS[i.chainId].eth_client;

  const operationName = rpcGatewayOpName(EffectType.GET_SWAP_FEE);
  const logDetails = {
    poolAddress: i.poolAddress,
    factoryAddress: i.factoryAddress,
    blockNumber: i.blockNumber,
  };
  const fallback = undefined;
  const fetcher = () =>
    fetchSwapFee(i.poolAddress, i.factoryAddress, i.blockNumber, ethClient);

  const result = await executeRpcWithFallback(
    context,
    operationName,
    logDetails,
    fallback,
    fetcher,
  );

  return { value: result };
}

/**
 * Handles the GET_ROOT_POOL_ADDRESS effect.
 * @param i - The input for the effect.
 * @param context - The context for the effect.
 * @returns The root pool address.
 */
async function handleGetRootPoolAddress(
  i: RpcGatewayInputByType[EffectType.GET_ROOT_POOL_ADDRESS],
  context: RpcGatewayHandlerContext,
): Promise<RpcGatewayOutputByType[EffectType.GET_ROOT_POOL_ADDRESS]> {
  const ethClient = CHAIN_CONSTANTS[i.chainId].eth_client;
  const lpHelperAddress = CHAIN_CONSTANTS[i.chainId].lpHelperAddress;

  const operationName = rpcGatewayOpName(EffectType.GET_ROOT_POOL_ADDRESS);
  const logDetails = { chainId: i.chainId, factory: i.factory };
  const fallback = "";
  const fetcher = () =>
    fetchRootPoolAddress(
      ethClient,
      lpHelperAddress,
      i.factory,
      i.token0,
      i.token1,
      i.poolType,
    );

  const result = await executeRpcWithFallback(
    context,
    operationName,
    logDetails,
    fallback,
    fetcher,
  );

  return { value: result };
}

/**
 * Runs an RPC operation with retry; on any throw, logs via {@link handleEffectErrorReturn}
 * and returns the fallback. Centralises "retry then log + default" so the caller never throws.
 * Use this for all RPC gateway operations so errors are consistent and the indexer never crashes.
 *
 * @param context - Effect context with optional cache flag and log (error + warn). Cache is set to false on error.
 * @param operationName - Identifier for logging (use {@link rpcGatewayOpName} for gateway operations).
 * @param logDetails - Key-value pairs included in error messages and retry logs.
 * @param fallback - Value returned when the operation throws (after retries are exhausted).
 * @param fn - Async function that performs the RPC call (e.g. a fetcher). No arguments; close over args in the caller.
 * @returns The result of `fn()`, or `fallback` if `fn` throws and the error is handled.
 */
export async function executeRpcWithFallback<T>(
  context: {
    cache?: boolean;
    log: {
      error: (msg: string, err: Error) => void;
      warn: (msg: string) => void;
    };
  },
  operationName: string,
  logDetails: Record<string, string | number>,
  fallback: T,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const retryAndLoggingOptions = {
      log: {
        warn: context.log.warn,
        error: (msg: string) => context.log.error(msg, new Error(msg)),
      },
      operationName,
      logDetails,
    };

    return await runWithRpcRetry(retryAndLoggingOptions, fn);
  } catch (error) {
    return handleEffectErrorReturn(
      error,
      context,
      operationName,
      logDetails,
      fallback,
    );
  }
}

/**
 * Runs an async RPC operation with retries on retryable errors. Retries on
 * {@link ErrorType.RATE_LIMIT} and {@link ErrorType.NETWORK_ERROR} with
 * error-type-aware exponential backoff (caps from {@link RPC_APP_RETRY}).
 * Non-retryable errors or exhausted retries are rethrown for the caller to handle
 * (e.g. via {@link handleEffectErrorReturn}). Logs slow requests (>5s warn, >30s error).
 *
 * @param options - Configuration for retry and logging.
 * @param options.log - Logger with required `warn` and optional `error` (single-arg: message string).
 * @param options.operationName - Optional name for log prefixes (use {@link rpcGatewayOpName} for gateway ops).
 * @param options.logDetails - Optional key-value pairs included in log messages.
 * @param fn - Async function that performs the RPC call. Invoked on each attempt.
 * @returns The result of `fn()` when it resolves successfully.
 * @throws Rethrows the last error when retries are exhausted or the error is not retryable.
 */
export async function runWithRpcRetry<T>(
  options: {
    log: { warn: (msg: string) => void; error?: (msg: string) => void };
    operationName?: string;
    logDetails?: Record<string, string | number>;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const { maxRetries, rateLimit, network } = RPC_APP_RETRY;
  const detailSuffix = formatDetailsSuffix(options.logDetails);
  const prefix = getRetryLogPrefix(options.operationName);

  let attempt = 0;
  while (true) {
    const startTime = Date.now();

    try {
      const result = await fn();
      const durationMs = Date.now() - startTime;

      logSlowRequestIfNeeded(
        options.log,
        prefix,
        detailSuffix,
        durationMs,
        "request",
      );

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      logSlowRequestIfNeeded(
        options.log,
        prefix,
        detailSuffix,
        durationMs,
        "failed request",
      );

      const errorType = getErrorType(error);
      const isRetryable =
        (errorType === ErrorType.RATE_LIMIT ||
          errorType === ErrorType.NETWORK_ERROR) &&
        attempt < maxRetries;

      if (!isRetryable) {
        throw error;
      }

      const delayMs = computeRetryDelayMs(
        attempt,
        errorType,
        rateLimit,
        network,
      );

      attempt++;

      options.log.warn(
        `${prefix} ${errorType} (attempt ${attempt}/${maxRetries + 1})${detailSuffix}. Retrying in ${delayMs}ms...`,
      );

      await sleep(delayMs);
    }
  }
}

/** Builds the " key1=val1, key2=val2" suffix for retry/slow-request log lines, or "".
 *
 * @param logDetails - Details to format.
 * @returns The formatted logDetails suffix.
 */
function formatDetailsSuffix(
  logDetails: Record<string, string | number> | undefined,
): string {
  if (!logDetails) return "";
  const part = Object.entries(logDetails)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return part ? ` ${part}` : "";
}

/** Log prefix for runWithRpcRetry messages.
 *
 * @param operationName - Operation name for the message.
 * @returns Log prefix for the message.
 */
function getRetryLogPrefix(operationName: string | undefined): string {
  return operationName
    ? `[runWithRpcRetry:${operationName}]`
    : "[runWithRpcRetry]";
}

/** Logs slow or very-slow request when duration exceeds thresholds.
 *
 * @param log - Logger with required `warn` and optional `error` (single-arg: message string).
 * @param prefix - Log prefix for the message.
 * @param detailSuffix - Details suffix for the message.
 * @param durationMs - Duration in milliseconds.
 * @param kind - Kind of request ("request" or "failed request").
 * @returns void
 */

function logSlowRequestIfNeeded(
  log: { warn: (msg: string) => void; error?: (msg: string) => void },
  prefix: string,
  detailSuffix: string,
  durationMs: number,
  kind: "request" | "failed request",
): void {
  const label = kind === "request" ? "request" : "failed request";
  if (durationMs > VERY_SLOW_REQUEST_MS && log.error) {
    log.error(`${prefix} Very slow ${label}: ${durationMs}ms${detailSuffix}`);
  } else if (durationMs > SLOW_REQUEST_MS) {
    log.warn(`${prefix} Slow ${label}: ${durationMs}ms${detailSuffix}`);
  }
}

/** Computes delay in ms for the next retry attempt (exponential backoff with cap).
 *
 * @param attempt - The attempt number.
 * @param errorType - The error type.
 * @param rateLimit - The rate limit configuration.
 * @param network - The network configuration.
 * @returns The delay in milliseconds.
 */
function computeRetryDelayMs(
  attempt: number,
  errorType: ErrorType,
  rateLimit: { capMs: number },
  network: { capMs: number },
): number {
  const baseMs = errorType === ErrorType.RATE_LIMIT ? 1000 : 500;
  const capMs =
    errorType === ErrorType.RATE_LIMIT ? rateLimit.capMs : network.capMs;
  return Math.min(baseMs * 2 ** attempt, capMs);
}
