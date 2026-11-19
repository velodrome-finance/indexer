import { S, createEffect } from "envio";
import { isAddress } from "viem";
import ERC20_ABI from "../../abis/ERC20.json";
import {
  CHAIN_CONSTANTS,
  PriceOracleType,
  TOKEN_DETAILS_FALLBACK,
  toChecksumAddress,
} from "../Constants";
import { RpcConfigError } from "./RpcConfig";
import { createRpcEffect } from "./RpcEffect";
import { executeRpc, mostCacheBlockingErrorClass } from "./RpcGateway";
import {
  DEFAULT_DECIMALS,
  MAX_DECIMALS,
  type TokenMetadata,
  UNKNOWN_NAME,
  UNKNOWN_SYMBOL,
  getTokenMetadata,
} from "./TokenMetadata";
import { fetchTokenPrice } from "./fetchers/Token";

export { fetchTokenPrice } from "./fetchers/Token";

/**
 * Rounds a block number down to the start of its hourly interval for better cache hits on price lookups.
 * Uses approximate block times: 2s for most L2s, 12s for Ethereum mainnet. Call before getTokenPrice
 * so the effect cache key is stable within the same hour.
 *
 * When `minBlock` is supplied, the rounded result is clamped up to `minBlock`. This prevents
 * callers (e.g. `updateDynamicFeePools` — issue #759) from querying contract state at a block
 * earlier than the contract's deployment, which would revert with empty bytecode.
 *
 * @param blockNumber - Block number to round.
 * @param chainId - Chain ID (1 = mainnet 12s blocks; others use 2s).
 * @param minBlock - Optional floor (typically the contract's deployment block) below which the rounded value will be clamped up.
 * @returns The largest multiple of (blocks per hour) that is ≤ blockNumber, clamped up to minBlock when supplied.
 */
export function roundBlockToInterval(
  blockNumber: number,
  chainId: number,
  minBlock?: number,
): number {
  const blockTimeSeconds = chainId === 1 ? 12 : 2;
  const blocksPerHour = Math.floor(3600 / blockTimeSeconds);
  const rounded = Math.floor(blockNumber / blocksPerHour) * blocksPerHour;
  return minBlock === undefined ? rounded : Math.max(rounded, minBlock);
}

/**
 * Maps {@link getTokenMetadata} output to the shape callers of
 * {@link getTokenDetails} expect: the cache's "unknown"/"UNKNOWN" placeholders
 * become "" — the "missing" marker that `healTokenMetadata` and the
 * TOKEN_DETAILS_FALLBACK fingerprint (#820) key on.
 *
 * @param meta - Metadata from the getTokenMetadata effect / cache.
 * @returns `{ name, decimals, symbol }` with placeholders blanked.
 */
export function toTokenDetails(meta: TokenMetadata): {
  name: string;
  decimals: number;
  symbol: string;
} {
  return {
    name: meta.name === UNKNOWN_NAME ? "" : meta.name,
    symbol: meta.symbol === UNKNOWN_SYMBOL ? "" : meta.symbol,
    decimals: meta.decimals,
  };
}

/**
 * Effect to get ERC20 token metadata (name, decimals, symbol). Thin mapping
 * over {@link getTokenMetadata}, which does the RPC and owns the cache (and is
 * seeded from the Uniswap v4 token cache); this effect itself is not cached.
 * Name and symbol are "" when unreadable; decimals is 18 when unreadable.
 *
 * `crossChain: false` because it calls the chain-scoped getTokenMetadata.
 *
 * @param input.contractAddress - ERC20 contract address.
 * @param input.chainId - Chain ID for RPC client.
 * @returns Promise resolving to { name, decimals, symbol }.
 */
export const getTokenDetails = createEffect(
  {
    name: "getTokenDetails",
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
    cache: false,
    crossChain: false,
  },
  async ({ input, context }) => {
    if (!isAddress(input.contractAddress, { strict: false })) {
      return { ...TOKEN_DETAILS_FALLBACK };
    }
    const meta = await context.effect(getTokenMetadata, {
      address: toChecksumAddress(input.contractAddress),
      chainId: input.chainId,
    });
    return toTokenDetails(meta);
  },
);

/**
 * Effect to read token price in USD from the chain's price oracle.
 * Kept for scripts and the remaining callers; the RPC legs go through
 * {@link executeRpc} and a stand-in zero price is never cached.
 *
 * @param input.tokenAddress - Token to price.
 * @param input.chainId - Chain ID for oracle and RPC.
 * @param input.blockNumber - Block at which to read (often rounded via {@link roundBlockToInterval}).
 * @param input.tokenDecimals - Optional source-token decimals (issue #748); fetched when omitted.
 * @returns Promise resolving to { pricePerUSDNew, priceOracleType }.
 */
export const getTokenPrice = createRpcEffect(
  {
    name: "getTokenPrice",
    input: S.schema({
      tokenAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
      tokenDecimals: S.optional(S.number),
    }),
    output: S.schema({
      pricePerUSDNew: S.bigint,
      priceOracleType: S.string,
    }),
    cache: true,
  },
  async ({ input, context }) => {
    const { tokenAddress, chainId, blockNumber, tokenDecimals } = input;
    const chain = CHAIN_CONSTANTS[chainId];
    if (!chain) throw new RpcConfigError(`Unsupported chainId: ${chainId}`);
    // Only legacy deployments have an on-chain price oracle.
    if (!chain.legacy) {
      throw new RpcConfigError(`Chain ${chainId} has no legacy price oracle`);
    }
    const legacy = chain.legacy;
    const oracleType = legacy.oracle.getType(blockNumber);
    const real = (pricePerUSDNew: bigint) => ({
      value: { pricePerUSDNew, priceOracleType: oracleType.toString() },
      usedDefault: false,
      errorClass: undefined,
    });

    if (
      tokenAddress === chain.destinationToken ||
      chain.stablecoins.has(tokenAddress.toLowerCase())
    ) {
      return real(10n ** 18n);
    }
    // Pre-deploy zero is a real answer (the oracle does not exist yet).
    if (legacy.oracle.startBlock > blockNumber) return real(0n);

    let sourceDecimals = tokenDecimals;
    let decimalsErrorClass: ReturnType<typeof mostCacheBlockingErrorClass>;
    let decimalsUsedDefault = false;
    if (sourceDecimals === undefined) {
      const r = await executeRpc<number>(
        context,
        {
          name: "getTokenPrice.decimals",
          chainId,
          details: { token: tokenAddress },
        },
        DEFAULT_DECIMALS,
        async (client) =>
          Number(
            await client.readContract({
              address: tokenAddress as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "decimals",
              args: [],
            }),
          ),
      );
      sourceDecimals =
        Number.isInteger(r.value) && r.value >= 0 && r.value <= MAX_DECIMALS
          ? r.value
          : DEFAULT_DECIMALS;
      decimalsUsedDefault = r.usedDefault;
      decimalsErrorClass = r.errorClass;
    }

    const WETH_ADDRESS = chain.weth;
    const SYSTEM_TOKEN_ADDRESS = legacy.rewardToken(blockNumber);
    const DESTINATION = chain.destinationToken;
    let connectors = chain.priceConnectors
      .filter((c) => (c.createdBlock ?? 0) <= blockNumber)
      .map((c) => c.address)
      .filter(
        (a) =>
          a !== tokenAddress &&
          a !== WETH_ADDRESS &&
          a !== DESTINATION &&
          a !== SYSTEM_TOKEN_ADDRESS,
      );
    // Issue #688: V1/V2 oracles revert on connectors without a pool.
    if (
      oracleType === PriceOracleType.V1 ||
      oracleType === PriceOracleType.V2
    ) {
      const blacklist = legacy.oracle.v1v2ConnectorBlacklist;
      if (blacklist.size > 0) {
        connectors = connectors.filter((a) => !blacklist.has(a));
      }
    }

    const price = await executeRpc(
      context,
      {
        name: "getTokenPrice",
        chainId,
        details: { token: tokenAddress, block: blockNumber },
      },
      { pricePerUSDNew: 0n, priceOracleType: oracleType.toString() },
      (client) =>
        fetchTokenPrice(
          tokenAddress,
          DESTINATION,
          SYSTEM_TOKEN_ADDRESS,
          WETH_ADDRESS,
          connectors,
          chainId,
          blockNumber,
          client,
        ),
    );

    const p = price.value;
    const currentPrice =
      p.priceOracleType === PriceOracleType.V3 ||
      p.priceOracleType === PriceOracleType.V4
        ? (p.pricePerUSDNew * 10n ** BigInt(sourceDecimals)) /
          10n ** BigInt(chain.destinationTokenDecimals)
        : p.pricePerUSDNew;

    return {
      value: {
        pricePerUSDNew: currentPrice,
        priceOracleType: oracleType.toString(),
      },
      usedDefault: price.usedDefault || decimalsUsedDefault,
      errorClass: mostCacheBlockingErrorClass(
        price.errorClass,
        decimalsErrorClass,
      ),
    };
  },
);
