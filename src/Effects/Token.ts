import { S, createEffect } from "envio";
import { ErrorType } from "./Helpers";
import { EffectType, callRpcGateway } from "./RpcGateway";

export { fetchTokenDetails, fetchTokenPrice } from "./fetchers/Token";

/**
 * Rounds a block number down to the start of its hourly interval for better cache hits on price lookups.
 * Uses approximate block times: 2s for most L2s, 12s for Ethereum mainnet. Call before getTokenPrice
 * so the effect cache key is stable within the same hour.
 *
 * @param blockNumber - Block number to round.
 * @param chainId - Chain ID (1 = mainnet 12s blocks; others use 2s).
 * @returns The largest block number that is a multiple of (blocks per hour) and ≤ blockNumber.
 */
export function roundBlockToInterval(
  blockNumber: number,
  chainId: number,
): number {
  // Approximate block times per chain (in seconds)
  // Most L2s (Base, Optimism, Mode, etc.) are ~2 seconds
  // Ethereum mainnet is ~12 seconds
  const blockTimeSeconds = chainId === 1 ? 12 : 2;
  const blocksPerHour = Math.floor(3600 / blockTimeSeconds);
  return Math.floor(blockNumber / blocksPerHour) * blocksPerHour;
}

/**
 * Effect to get ERC20 token metadata (name, decimals, symbol). Delegates to {@link rpcGateway}.
 * On error, fallback handling is delegated to the RPC gateway.
 *
 * @param input.contractAddress - ERC20 contract address.
 * @param input.chainId - Chain ID for RPC client.
 * @returns Promise resolving to { name, decimals, symbol }; fallback on error.
 */
export const getTokenDetails = createEffect(
  {
    name: EffectType.GET_TOKEN_DETAILS,
    input: {
      contractAddress: S.string,
      chainId: S.number,
    },
    output: {
      name: S.string,
      decimals: S.number,
      symbol: S.string,
    },
    rateLimit: false,
    cache: true,
  },
  async ({ input, context }) => {
    const result = await callRpcGateway(context, {
      type: EffectType.GET_TOKEN_DETAILS,
      contractAddress: input.contractAddress,
      chainId: input.chainId,
    });

    // Skip caching only when the fallback was returned because of a transient
    // RPC failure (issue #691 + #692). A deterministic contract revert is
    // safe to cache — re-fetching at the same block would produce the same
    // revert and the same fallback constant, so caching avoids one extra RPC
    // call per revert-producing address per indexer run.
    if (shouldSkipCacheOnDefault(result.usedDefault, result.errorClass)) {
      context.cache = false;
    }

    return {
      name: result.name,
      decimals: result.decimals,
      symbol: result.symbol,
    };
  },
);

/**
 * Cache gating helper for outer effects sitting on top of {@link callRpcGateway}.
 * Returns true when the fallback constant is unsafe to cache — i.e. it was
 * produced by a transient RPC failure (network blip, rate limit, etc.) rather
 * than a deterministic contract revert. CONTRACT_REVERT fallbacks stay cached
 * (issue #692) so reverts amortise like real successes.
 *
 * @param usedDefault - Whether the gateway returned the caller's fallback constant.
 * @param errorClass - The {@link ErrorType} of the underlying failure, or null on success.
 * @returns true when the caller should set `context.cache = false`; false otherwise.
 */
function shouldSkipCacheOnDefault(
  usedDefault: boolean,
  errorClass: ErrorType | string | undefined,
): boolean {
  return usedDefault && errorClass !== ErrorType.CONTRACT_REVERT;
}

/**
 * Effect to read token price in USD from the chain's price oracle. Delegates to {@link rpcGateway};
 * fallback on error is handled inside the gateway.
 *
 * @param input.tokenAddress - Token to price.
 * @param input.chainId - Chain ID for oracle and RPC.
 * @param input.blockNumber - Block at which to read (often rounded via {@link roundBlockToInterval}).
 * @param input.tokenDecimals - Optional source-token decimals (issue #748). When supplied,
 *   skips the source-token `fetchTokenDetails` RPC (3 redundant `eth_call`s per cache miss).
 *   Omit when the caller doesn't hold a trustworthy stored decimals (e.g. cross-chain
 *   cold-sync against an unloaded source Token); the gateway falls back to fetching.
 * @returns Promise resolving to { pricePerUSDNew, priceOracleType }.
 */
export const getTokenPrice = createEffect(
  {
    name: EffectType.GET_TOKEN_PRICE,
    input: {
      tokenAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
      tokenDecimals: S.optional(S.number),
    },
    output: {
      pricePerUSDNew: S.bigint,
      priceOracleType: S.string,
    },
    rateLimit: false,
    cache: true,
  },
  async ({ input, context }) => {
    const result = await callRpcGateway(context, {
      type: EffectType.GET_TOKEN_PRICE,
      tokenAddress: input.tokenAddress,
      chainId: input.chainId,
      blockNumber: input.blockNumber,
      tokenDecimals: input.tokenDecimals,
    });

    // Skip caching only on transient-RPC fallbacks (issue #691 + #692).
    // Legitimate zero prices (pre-oracle-deploy, broken connectors) are cacheable;
    // a deterministic CONTRACT_REVERT fallback is also cacheable.
    if (shouldSkipCacheOnDefault(result.usedDefault, result.errorClass)) {
      context.cache = false;
    }

    return {
      pricePerUSDNew: result.pricePerUSDNew,
      priceOracleType: result.priceOracleType,
    };
  },
);
