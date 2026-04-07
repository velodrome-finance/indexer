import { S, createEffect } from "envio";
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
    return {
      name: result.name,
      decimals: result.decimals,
      symbol: result.symbol,
    };
  },
);

/**
 * Effect to read token price in USD from the chain's price oracle. Delegates to {@link rpcGateway};
 * fallback on error is handled inside the gateway.
 *
 * @param input.tokenAddress - Token to price.
 * @param input.chainId - Chain ID for oracle and RPC.
 * @param input.blockNumber - Block at which to read (often rounded via {@link roundBlockToInterval}).
 * @returns Promise resolving to { pricePerUSDNew, priceOracleType }.
 */
export const getTokenPrice = createEffect(
  {
    name: EffectType.GET_TOKEN_PRICE,
    input: {
      tokenAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
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
    });

    // Don't cache $0 results — allows re-fetch on next query when oracle connectors are fixed.
    // Same pattern as handleEffectErrorReturn (Helpers.ts).
    if (result.pricePerUSDNew === 0n) {
      context.cache = false;
    }

    return {
      pricePerUSDNew: result.pricePerUSDNew,
      priceOracleType: result.priceOracleType,
    };
  },
);
