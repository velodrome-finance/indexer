import { S, createEffect } from "envio";
import {
  CHAIN_CONSTANTS,
  PriceOracleType,
  RPC_GATEWAY_PREFIX,
  TOKEN_DETAILS_FALLBACK,
  createFallbackRpcClient,
} from "../Constants";
import { GLOBAL_REQUESTS_PER_SECOND, RPC_APP_RETRY } from "../Constants";
import {
  ErrorType,
  getErrorType,
  handleEffectErrorReturn,
  sleep,
} from "./Helpers";
import { fetchHasContractBytecode } from "./fetchers/Bytecode";
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
  HAS_CONTRACT_BYTECODE = "hasContractBytecode",
}

/** Log name for a gateway operation; use sub for nested operations (e.g. "tokenDetails"). */
function rpcGatewayOpName(type: EffectType, sub?: string): string {
  return sub
    ? `${RPC_GATEWAY_PREFIX}.${type}.${sub}`
    : `${RPC_GATEWAY_PREFIX}.${type}`;
}

/**
 * Single source of truth for each gateway operation: input and output schemas.
 * Each inputSchema includes a literal `type` field so that RPC_GATEWAY_INPUT_SCHEMA
 * (S.union of these schemas) is a proper discriminated union: the runtime validates
 * and preserves `type`, and the handler's switch (i.type) receives it intact.
 * When adding an operation:
 * 1) add to EffectType,
 * 2) add an entry here,
 * 3) add to RpcGatewayInputPayloadByType and RpcGatewayOutputByType below.
 */
const RPC_GATEWAY_OPERATIONS = {
  [EffectType.GET_TOKEN_DETAILS]: {
    inputSchema: {
      type: S.schema(EffectType.GET_TOKEN_DETAILS),
      contractAddress: S.string,
      chainId: S.number,
    },
    outputSchema: {
      name: S.string,
      decimals: S.number,
      symbol: S.string,
      usedDefault: S.boolean,
      errorClass: S.optional(S.string),
    },
  },
  [EffectType.GET_TOKEN_PRICE]: {
    inputSchema: {
      type: S.schema(EffectType.GET_TOKEN_PRICE),
      tokenAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
    },
    outputSchema: {
      pricePerUSDNew: S.bigint,
      priceOracleType: S.string,
      usedDefault: S.boolean,
      errorClass: S.optional(S.string),
    },
  },
  [EffectType.GET_TOKENS_DEPOSITED]: {
    inputSchema: {
      type: S.schema(EffectType.GET_TOKENS_DEPOSITED),
      rewardTokenAddress: S.string,
      gaugeAddress: S.string,
      blockNumber: S.number,
      chainId: S.number,
    },
    outputSchema: {
      value: S.optional(S.bigint),
      usedDefault: S.boolean,
      errorClass: S.optional(S.string),
    },
  },
  [EffectType.GET_SWAP_FEE]: {
    inputSchema: {
      type: S.schema(EffectType.GET_SWAP_FEE),
      poolAddress: S.string,
      factoryAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
    },
    outputSchema: {
      value: S.optional(S.bigint),
      usedDefault: S.boolean,
      errorClass: S.optional(S.string),
    },
  },
  [EffectType.GET_ROOT_POOL_ADDRESS]: {
    inputSchema: {
      type: S.schema(EffectType.GET_ROOT_POOL_ADDRESS),
      chainId: S.number,
      factory: S.string,
      token0: S.string,
      token1: S.string,
      poolType: S.number,
    },
    outputSchema: {
      value: S.string,
      usedDefault: S.boolean,
      errorClass: S.optional(S.string),
    },
  },
  [EffectType.HAS_CONTRACT_BYTECODE]: {
    inputSchema: {
      type: S.schema(EffectType.HAS_CONTRACT_BYTECODE),
      address: S.string,
      chainId: S.number,
    },
    outputSchema: {
      hasCode: S.boolean,
      usedDefault: S.boolean,
      errorClass: S.optional(S.string),
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
  RPC_GATEWAY_OPERATIONS[EffectType.HAS_CONTRACT_BYTECODE].inputSchema,
]);

const RPC_GATEWAY_OUTPUT_SCHEMA = S.union([
  RPC_GATEWAY_OPERATIONS[EffectType.GET_TOKEN_DETAILS].outputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.GET_TOKEN_PRICE].outputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.GET_TOKENS_DEPOSITED].outputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.GET_SWAP_FEE].outputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.GET_ROOT_POOL_ADDRESS].outputSchema,
  RPC_GATEWAY_OPERATIONS[EffectType.HAS_CONTRACT_BYTECODE].outputSchema,
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
  [EffectType.HAS_CONTRACT_BYTECODE]: {
    address: string;
    chainId: number;
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
    usedDefault: boolean;
    errorClass: string | undefined;
  };
  [EffectType.GET_TOKEN_PRICE]: {
    pricePerUSDNew: bigint;
    priceOracleType: string;
    usedDefault: boolean;
    errorClass: string | undefined;
  };
  [EffectType.GET_TOKENS_DEPOSITED]: {
    value: bigint | undefined;
    usedDefault: boolean;
    errorClass: string | undefined;
  };
  [EffectType.GET_SWAP_FEE]: {
    value: bigint | undefined;
    usedDefault: boolean;
    errorClass: string | undefined;
  };
  [EffectType.GET_ROOT_POOL_ADDRESS]: {
    value: string;
    usedDefault: boolean;
    errorClass: string | undefined;
  };
  [EffectType.HAS_CONTRACT_BYTECODE]: {
    hasCode: boolean;
    usedDefault: boolean;
    errorClass: string | undefined;
  };
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
    cache: false,
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
      case EffectType.HAS_CONTRACT_BYTECODE:
        return await handleHasContractBytecode(i, ctx);
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
  const operationName = rpcGatewayOpName(EffectType.GET_TOKEN_DETAILS);
  const logDetails = { contractAddress: i.contractAddress, chainId: i.chainId };
  const fallback = TOKEN_DETAILS_FALLBACK;
  const fetcher = () => {
    const chain = CHAIN_CONSTANTS[i.chainId];
    if (!chain) {
      throw new Error(`Unsupported chainId: ${i.chainId}`);
    }
    return fetchTokenDetails(i.contractAddress, chain.eth_client);
  };
  const fallbackClient = createFallbackRpcClient(i.chainId);
  const fallbackFetcher = fallbackClient
    ? () => fetchTokenDetails(i.contractAddress, fallbackClient)
    : undefined;

  const { value, usedDefault, errorClass } = await executeRpcWithFallback(
    context,
    operationName,
    logDetails,
    fallback,
    fetcher,
    fallbackFetcher,
  );

  return { ...value, usedDefault, errorClass };
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
  const chain = CHAIN_CONSTANTS[chainId];
  if (!chain) {
    context.log.error(
      "Unsupported chainId in getTokenPrice",
      new Error(`Unsupported chainId: ${chainId}`),
    );
    return {
      pricePerUSDNew: 0n,
      priceOracleType: "unknown",
      usedDefault: true,
      errorClass: ErrorType.UNKNOWN,
    };
  }
  const DESTINATION_TOKEN_ADDRESS = chain.destinationToken;

  if (tokenAddress === DESTINATION_TOKEN_ADDRESS) {
    return {
      pricePerUSDNew: 10n ** 18n,
      priceOracleType: chain.oracle.getType(blockNumber).toString(),
      usedDefault: false,
      errorClass: undefined,
    };
  }

  if (chain.stablecoins.has(tokenAddress.toLowerCase())) {
    return {
      pricePerUSDNew: 10n ** 18n,
      priceOracleType: chain.oracle.getType(blockNumber).toString(),
      usedDefault: false,
      errorClass: undefined,
    };
  }

  const DESTINATION_TOKEN_DETAILS_FALLBACK = {
    name: "DestinationToken",
    symbol: "DestinationToken",
    decimals: chain.destinationTokenDecimals,
  };

  const fallbackClient = createFallbackRpcClient(chainId);

  const [tokenDetails, destinationTokenDetails] = await Promise.all([
    executeRpcWithFallback(
      context,
      rpcGatewayOpName(EffectType.GET_TOKEN_PRICE, "tokenDetails"),
      { contractAddress: tokenAddress, chainId },
      TOKEN_DETAILS_FALLBACK,
      () => fetchTokenDetails(tokenAddress, chain.eth_client),
      fallbackClient
        ? () => fetchTokenDetails(tokenAddress, fallbackClient)
        : undefined,
    ),
    executeRpcWithFallback(
      context,
      rpcGatewayOpName(EffectType.GET_TOKEN_PRICE, "destinationTokenDetails"),
      { contractAddress: DESTINATION_TOKEN_ADDRESS, chainId },
      DESTINATION_TOKEN_DETAILS_FALLBACK,
      () => fetchTokenDetails(DESTINATION_TOKEN_ADDRESS, chain.eth_client),
      fallbackClient
        ? () => fetchTokenDetails(DESTINATION_TOKEN_ADDRESS, fallbackClient)
        : undefined,
    ),
  ]);

  const ORACLE_DEPLOYED = chain.oracle.startBlock <= blockNumber;
  if (!ORACLE_DEPLOYED) {
    // Pre-deploy zero is a real, cacheable answer (the oracle does not exist yet),
    // not the fallback constant — keep usedDefault: false so the result stays in the cache.
    return {
      pricePerUSDNew: 0n,
      priceOracleType: chain.oracle.getType(blockNumber).toString(),
      usedDefault: false,
      errorClass: undefined,
    };
  }

  const WETH_ADDRESS = chain.weth;
  const SYSTEM_TOKEN_ADDRESS = chain.rewardToken(blockNumber);
  let connectors = chain.oracle.priceConnectors
    .filter((c) => c.createdBlock <= blockNumber)
    .map((c) => c.address)
    .filter((a) => a !== tokenAddress)
    .filter((a) => a !== WETH_ADDRESS)
    .filter((a) => a !== DESTINATION_TOKEN_ADDRESS)
    .filter((a) => a !== SYSTEM_TOKEN_ADDRESS);

  // Issue #688: V1/V2 (VeloPriceOracle.getManyRatesWithConnectors) reverts
  // when the connector array contains tokens with no AMM pool at the queried
  // block. Strip the per-chain blacklist for V1/V2 calls only — V3+ silently
  // skips unreachable paths and tolerates the full list. Blacklist entries
  // mirror the checksum casing used in price_connectors.json so this matches
  // the same case-sensitive convention as the dedup filter above.
  const oracleType = chain.oracle.getType(blockNumber);
  if (oracleType === PriceOracleType.V1 || oracleType === PriceOracleType.V2) {
    const blacklist = chain.oracle.v1v2ConnectorBlacklist;
    if (blacklist.size > 0) {
      connectors = connectors.filter((a) => !blacklist.has(a));
    }
  }

  const operationName = rpcGatewayOpName(EffectType.GET_TOKEN_PRICE);
  const logDetails = { tokenAddress, chainId, blockNumber };
  const fallback = {
    pricePerUSDNew: 0n,
    priceOracleType: oracleType.toString(),
  };
  const buildPriceFetcher = (client: typeof chain.eth_client) => () =>
    fetchTokenPrice(
      tokenAddress,
      DESTINATION_TOKEN_ADDRESS,
      SYSTEM_TOKEN_ADDRESS,
      WETH_ADDRESS,
      connectors,
      chainId,
      blockNumber,
      client,
    );

  const priceResult = await executeRpcWithFallback(
    context,
    operationName,
    logDetails,
    fallback,
    buildPriceFetcher(chain.eth_client),
    fallbackClient ? buildPriceFetcher(fallbackClient) : undefined,
  );

  const priceData = priceResult.value;
  let currentPrice: bigint;
  if (
    priceData.priceOracleType === PriceOracleType.V3 ||
    priceData.priceOracleType === PriceOracleType.V4
  ) {
    currentPrice =
      (priceData.pricePerUSDNew * 10n ** BigInt(tokenDetails.value.decimals)) /
      10n ** BigInt(destinationTokenDetails.value.decimals);
  } else {
    currentPrice = priceData.pricePerUSDNew;
  }

  // Any leg that returned the fallback constant means the composed price is
  // synthetic — the price RPC itself, or either token-details RPC backing the
  // decimal conversion. OR all three so the outer effect can skip caching.
  const usedDefault =
    priceResult.usedDefault ||
    tokenDetails.usedDefault ||
    destinationTokenDetails.usedDefault;

  // Compose errorClass across the three legs: a single transient/network leg
  // forces the whole result to look transient (less cacheable) even if the
  // other legs reverted deterministically. Only when every defaulted leg is
  // CONTRACT_REVERT does the composed result inherit the cacheable revert
  // class. Stays null when no leg defaulted.
  const errorClass = mostCacheBlockingErrorClass(
    priceResult.errorClass,
    tokenDetails.errorClass,
    destinationTokenDetails.errorClass,
  );

  return {
    pricePerUSDNew: currentPrice,
    priceOracleType: chain.oracle.getType(blockNumber).toString(),
    usedDefault,
    errorClass,
  };
}

/**
 * Picks the errorClass that should drive the cache decision when multiple
 * fallback legs are composed. A transient class (anything that isn't
 * {@link ErrorType.CONTRACT_REVERT}) outranks a revert, so the caller sees the
 * worst-cacheability signal across legs. Returns null when no leg defaulted.
 *
 * @param classes - Per-leg error classes (null for legs that didn't default).
 * @returns A non-revert class if any leg has one; otherwise the first revert; otherwise null.
 */
function mostCacheBlockingErrorClass(
  ...classes: (ErrorType | undefined)[]
): ErrorType | undefined {
  const present = classes.filter((c): c is ErrorType => c !== undefined);
  if (present.length === 0) return undefined;
  const nonRevert = present.find((c) => c !== ErrorType.CONTRACT_REVERT);
  return nonRevert ?? present[0];
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
  const operationName = rpcGatewayOpName(EffectType.GET_TOKENS_DEPOSITED);
  const logDetails = {
    gaugeAddress: i.gaugeAddress,
    blockNumber: i.blockNumber,
  };
  const fallback = undefined;
  const fetcher = () => {
    const chain = CHAIN_CONSTANTS[i.chainId];
    if (!chain) {
      throw new Error(`Unsupported chainId: ${i.chainId}`);
    }
    return fetchTokensDeposited(
      i.rewardTokenAddress,
      i.gaugeAddress,
      i.blockNumber,
      chain.eth_client,
    );
  };

  const { value, usedDefault, errorClass } = await executeRpcWithFallback(
    context,
    operationName,
    logDetails,
    fallback,
    fetcher,
  );

  return { value, usedDefault, errorClass };
}

/**
 * Handles the GET_SWAP_FEE effect.
 * @param i - The input for the effect.
 * @param context - The context for the effect.
 * @returns The current swap fee.
 */
async function handleGetSwapFee(
  i: RpcGatewayInputByType[EffectType.GET_SWAP_FEE],
  context: RpcGatewayHandlerContext,
): Promise<RpcGatewayOutputByType[EffectType.GET_SWAP_FEE]> {
  const operationName = rpcGatewayOpName(EffectType.GET_SWAP_FEE);
  const logDetails = {
    poolAddress: i.poolAddress,
    factoryAddress: i.factoryAddress,
    blockNumber: i.blockNumber,
  };
  const fallback = undefined;
  const fetcher = () => {
    const chain = CHAIN_CONSTANTS[i.chainId];
    if (!chain) {
      throw new Error(`Unsupported chainId: ${i.chainId}`);
    }
    return fetchSwapFee(
      i.poolAddress,
      i.factoryAddress,
      i.blockNumber,
      chain.eth_client,
    );
  };

  const { value, usedDefault, errorClass } = await executeRpcWithFallback(
    context,
    operationName,
    logDetails,
    fallback,
    fetcher,
  );

  return { value, usedDefault, errorClass };
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
  const operationName = rpcGatewayOpName(EffectType.GET_ROOT_POOL_ADDRESS);
  const logDetails = { chainId: i.chainId, factory: i.factory };
  const fallback = "";
  const fetcher = () => {
    const chain = CHAIN_CONSTANTS[i.chainId];
    if (!chain) {
      throw new Error(`Unsupported chainId: ${i.chainId}`);
    }
    return fetchRootPoolAddress(
      chain.eth_client,
      chain.lpHelperAddress,
      i.factory,
      i.token0,
      i.token1,
      i.poolType,
    );
  };

  const { value, usedDefault, errorClass } = await executeRpcWithFallback(
    context,
    operationName,
    logDetails,
    fallback,
    fetcher,
  );

  return { value, usedDefault, errorClass };
}

/**
 * Handles the HAS_CONTRACT_BYTECODE effect via `eth_getCode`.
 * Fail-open on RPC errors (returns `hasCode: true`) so transient outages don't
 * regress current behavior at Token-row creation sites; the caller controls
 * caching of negative results.
 *
 * @param i - The input for the effect.
 * @param context - The context for the effect.
 * @returns Object with `hasCode: true` when bytecode is non-empty, `false` otherwise.
 */
async function handleHasContractBytecode(
  i: RpcGatewayInputByType[EffectType.HAS_CONTRACT_BYTECODE],
  context: RpcGatewayHandlerContext,
): Promise<RpcGatewayOutputByType[EffectType.HAS_CONTRACT_BYTECODE]> {
  const operationName = rpcGatewayOpName(EffectType.HAS_CONTRACT_BYTECODE);
  const logDetails = { address: i.address, chainId: i.chainId };
  const fetcher = () => {
    const chain = CHAIN_CONSTANTS[i.chainId];
    if (!chain) {
      throw new Error(`Unsupported chainId: ${i.chainId}`);
    }
    return fetchHasContractBytecode(i.address, chain.eth_client);
  };
  const fallbackClient = createFallbackRpcClient(i.chainId);
  const fallbackFetcher = fallbackClient
    ? () => fetchHasContractBytecode(i.address, fallbackClient)
    : undefined;

  const { value, usedDefault, errorClass } = await executeRpcWithFallback(
    context,
    operationName,
    logDetails,
    true,
    fetcher,
    fallbackFetcher,
  );

  return { hasCode: value, usedDefault, errorClass };
}

/**
 * Result wrapper for {@link executeRpcWithFallback}: `usedDefault` is `true` only
 * when both the primary and the optional fallback RPC have been exhausted and the
 * caller-supplied `fallback` constant was returned. A real answer from either RPC
 * yields `usedDefault: false`. Outer effects use this to drive cache decisions
 * without resorting to value-shape heuristics (issue #691).
 *
 * `errorClass` carries the {@link ErrorType} of the underlying failure on the
 * fail-open path (`usedDefault: true`) and is `undefined` on success. Outer
 * effects use it to keep deterministic-revert fallbacks cached while still
 * skipping transient-RPC failures (issue #692) and to differentiate log levels.
 */
export type RpcResult<T> = {
  value: T;
  usedDefault: boolean;
  errorClass: ErrorType | undefined;
};

/**
 * Runs an RPC operation with retry; on any throw, logs via {@link handleEffectErrorReturn}
 * and returns the fallback. Centralises "retry then log + default" so the caller never throws.
 * Use this for all RPC gateway operations so errors are consistent and the indexer never crashes.
 *
 * When `fallbackFn` is provided and the primary exhausts retries on a
 * fallback-worthy error (METHOD_NOT_SUPPORTED or HISTORICAL_STATE_NOT_AVAILABLE),
 * one warn is emitted and the fallback is retried on its own budget. Any other
 * error class bypasses the fallback and surfaces a single uerror via
 * {@link handleEffectErrorReturn}.
 *
 * Returns `{ value, usedDefault }`: `usedDefault: true` signals that the
 * caller-supplied `fallback` constant was returned because both primary and
 * fallback RPCs were exhausted (or the primary failed with a non-fallback-worthy
 * error and no fallback was tried). Callers use this to skip caching the
 * stand-in constant — see issue #691.
 *
 * @param context - Effect context with optional cache flag and log (error + warn). On error, cache is set to false by {@link handleEffectErrorReturn}.
 * @param operationName - Identifier for logging (use {@link rpcGatewayOpName} for gateway operations).
 * @param logDetails - Key-value pairs included in error messages.
 * @param fallback - Value returned when the operation throws (after retries are exhausted).
 * @param fn - Async function that performs the primary RPC call. No arguments; close over args in the caller.
 * @param fallbackFn - Optional async function to try on a different RPC when the primary exhausts on a fallback-worthy error.
 * @returns `{ value, usedDefault }` — `value` is the RPC result or `fallback`; `usedDefault` is `true` iff `fallback` was returned.
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
  fallbackFn?: () => Promise<T>,
): Promise<RpcResult<T>> {
  try {
    const value = await runWithRpcRetry(fn);
    return { value, usedDefault: false, errorClass: undefined };
  } catch (primaryError) {
    if (fallbackFn && shouldAttemptFallback(primaryError)) {
      const primaryType = getErrorType(primaryError);
      context.log.warn(
        `[${operationName}] primary RPC exhausted (${primaryType})${formatDetailsSuffix(logDetails)}; trying fallback public RPC.`,
      );
      try {
        const value = await runWithRpcRetry(fallbackFn);
        return { value, usedDefault: false, errorClass: undefined };
      } catch (fallbackError) {
        const value = handleEffectErrorReturn(
          fallbackError,
          context,
          `${operationName}.fallback`,
          logDetails,
          fallback,
        );
        return {
          value,
          usedDefault: true,
          errorClass: getErrorType(fallbackError),
        };
      }
    }
    const value = handleEffectErrorReturn(
      primaryError,
      context,
      operationName,
      logDetails,
      fallback,
    );
    return {
      value,
      usedDefault: true,
      errorClass: getErrorType(primaryError),
    };
  }
}

/** True if the primary-RPC error is worth retrying on the default/public RPC.
 * Provider-side method outages and historical-state-unavailable errors are the
 * cases where a different provider has a real chance of succeeding. Rate
 * limits, network blips, and contract reverts do not benefit from a fallback
 * provider (or are not the fallback's job).
 */
function shouldAttemptFallback(error: unknown): boolean {
  const t = getErrorType(error);
  return (
    t === ErrorType.METHOD_NOT_SUPPORTED ||
    t === ErrorType.HISTORICAL_STATE_NOT_AVAILABLE
  );
}

/** Builds the " key1=val1, key2=val2" suffix for the single fallback-engage warn, or "". */
function formatDetailsSuffix(
  logDetails: Record<string, string | number>,
): string {
  const entries = Object.entries(logDetails);
  if (!entries.length) return "";
  return ` ${entries.map(([k, v]) => `${k}=${v}`).join(", ")}`;
}

/**
 * Runs an async RPC operation with retries on retryable errors. Retries on
 * {@link ErrorType.RATE_LIMIT}, {@link ErrorType.NETWORK_ERROR}, and
 * {@link ErrorType.METHOD_NOT_SUPPORTED} with error-type-aware exponential
 * backoff (caps from {@link RPC_APP_RETRY}). METHOD_NOT_SUPPORTED uses its own
 * low cap so the caller can fall back to the default RPC quickly instead of
 * hammering a deterministically broken upstream.
 *
 * Non-retryable errors or exhausted retries are rethrown for the caller to
 * convert into a single `uerror` (see {@link handleEffectErrorReturn}).
 *
 * Intentionally silent: intermediate retries and per-attempt latency emit no
 * logs. Aggregate latency is visible via the Envio `/metrics` endpoint; only
 * the final exhausted-retries error surfaces, via the caller.
 *
 * @param fn - Async function that performs the RPC call. Invoked on each attempt.
 * @returns The result of `fn()` when it resolves successfully.
 * @throws Rethrows the last error when retries are exhausted or the error is not retryable.
 */
export async function runWithRpcRetry<T>(fn: () => Promise<T>): Promise<T> {
  const { maxRetries, methodNotSupportedMaxRetries, rateLimit, network } =
    RPC_APP_RETRY;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      const errorType = getErrorType(error);
      const attemptCap = maxAttemptsForErrorType(
        errorType,
        maxRetries,
        methodNotSupportedMaxRetries,
      );
      const isRetryable = attemptCap !== null && attempt < attemptCap;

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

      await sleep(delayMs);
    }
  }
}

/** Returns the per-error-type retry cap for runWithRpcRetry, or null if the
 * error class is non-retryable. Keeps provider-side method outages
 * (METHOD_NOT_SUPPORTED) on a tight budget so the caller can fall back to the
 * default RPC quickly instead of hammering a deterministically broken upstream.
 */
function maxAttemptsForErrorType(
  errorType: ErrorType,
  defaultMax: number,
  methodNotSupportedMax: number,
): number | null {
  if (
    errorType === ErrorType.RATE_LIMIT ||
    errorType === ErrorType.NETWORK_ERROR
  ) {
    return defaultMax;
  }
  if (errorType === ErrorType.METHOD_NOT_SUPPORTED) {
    return methodNotSupportedMax;
  }
  return null;
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
