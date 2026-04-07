import type { Token, handlerContext } from "generated";
import {
  AFFECTED_CHAINS,
  CHAIN_CONSTANTS,
  PriceOracleType,
  SECONDS_IN_AN_HOUR,
  TokenId,
} from "./Constants";
import {
  getTokenDetails,
  getTokenPrice,
  roundBlockToInterval,
} from "./Effects/Index";
import { EffectType, rpcGateway } from "./Effects/RpcGateway";
import { setTokenPriceSnapshot } from "./Snapshots/TokenPriceSnapshot";
export interface TokenPriceData {
  pricePerUSDNew: bigint;
  decimals: bigint;
}

export async function createTokenEntity(
  tokenAddress: string,
  chainId: number,
  blockNumber: number,
  context: handlerContext,
  blockTimestamp: number,
) {
  const blockDatetime = new Date(blockTimestamp * 1000);
  const tokenDetails = await context.effect(getTokenDetails, {
    contractAddress: tokenAddress,
    chainId,
  });

  const tokenEntity: Token = {
    id: TokenId(chainId, tokenAddress),
    address: tokenAddress,
    symbol: tokenDetails.symbol,
    name: tokenDetails.name, // Now using the actual name from token details
    chainId: chainId,
    decimals: BigInt(tokenDetails.decimals),
    pricePerUSDNew: BigInt(0),
    lastUpdatedTimestamp: blockDatetime,
    isWhitelisted: false,
  };

  context.Token.set(tokenEntity);
  return tokenEntity;
}

/**
 * Refreshes a token's price data if the update interval has passed.
 *
 * This function checks if enough time has passed since the last update (1 hour),
 * and if so, fetches new price data for the token. The token entity is updated
 * in the database with the new price and timestamp.
 *
 * @param {Token} token - The token entity to refresh
 * @param {number} blockNumber - The block number to fetch price data from
 * @param {number} blockTimestamp - The timestamp of the block in seconds
 * @param {number} chainId - The chain ID where the token exists
 * @param {any} context - The database context for updating entities
 * @returns {Promise<Token>} The updated token entity
 */
export async function refreshTokenPrice(
  token: Token,
  blockNumber: number,
  blockTimestamp: number,
  chainId: number,
  context: handlerContext,
): Promise<Token> {
  const blockTimestampMs = blockTimestamp * 1000;
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  // Refresh logic:
  // - Missing timestamp → always refresh
  // - $0 price for <30 days → retry (connector fix or Change A may self-heal)
  // - $0 price for >30 days → stop retrying (accepted as unpriceable, bounds RPC waste)
  // - Non-zero price → refresh on hourly interval
  const shouldRefresh =
    !token.lastUpdatedTimestamp ||
    (token.pricePerUSDNew === 0n
      ? blockTimestampMs - token.lastUpdatedTimestamp.getTime() < THIRTY_DAYS_MS
      : blockTimestampMs - token.lastUpdatedTimestamp.getTime() >=
        SECONDS_IN_AN_HOUR);

  if (!shouldRefresh) {
    return token;
  }

  try {
    // Round block number to nearest hour interval for better cache hits
    // Cache key is based on input parameters, so rounding must happen before effect call
    const roundedBlockNumber = roundBlockToInterval(blockNumber, chainId);

    // Fetch token details and price in parallel
    const [tokenDetails, priceData] = await Promise.all([
      context.effect(getTokenDetails, {
        contractAddress: token.address,
        chainId,
      }),
      context.effect(getTokenPrice, {
        tokenAddress: token.address,
        chainId,
        blockNumber: roundedBlockNumber, // Use rounded block for cache key
      }),
    ]);
    // TEMPORARY: Bypass effect cache for affected chains with $0 cached results.
    // These chains had broken oracle connectors that cached $0 prices permanently.
    // The rpcGateway effect (cache: false) re-fetches from now-fixed connectors.
    // Remove after one full reindex with fixed connectors.
    let currentPrice = priceData.pricePerUSDNew;
    if (currentPrice === 0n && AFFECTED_CHAINS.has(chainId)) {
      const bypassResult = (await context.effect(rpcGateway, {
        type: EffectType.GET_TOKEN_PRICE,
        tokenAddress: token.address,
        chainId,
        blockNumber: roundedBlockNumber,
      })) as { pricePerUSDNew: bigint; priceOracleType: string };
      currentPrice = bypassResult.pricePerUSDNew;
    }

    // If price fetch returned 0, it could mean:
    // 1. No price path exists in the oracle (token not configured)
    // 2. Historical state unavailable (RPC limitation)
    //
    // If we have a previous non-zero price, use it as fallback.
    // This works in harmony with Envio's effect caching - if the effect cache has a previous
    // successful result, it will be used. But if it returns 0, we fall back to the token's stored price.
    const shouldUseLastKnownPrice =
      currentPrice === 0n &&
      token.pricePerUSDNew > 0n &&
      token.lastUpdatedTimestamp &&
      // Only use last known price if it's relatively recent (within 7 days)
      // This prevents using very stale prices but allows for temporary oracle issues
      blockTimestampMs - token.lastUpdatedTimestamp.getTime() <
        7 * 24 * 60 * 60 * 1000;

    // We already know that Oracle V1 is a bit unreliable (we tested for WETH on Optimism and it kept failing)
    // Oracle V2 is also a bit unreliable and either way it is just used for a few blocks
    // So the main errors that we should be concerned about (and that impact most recent data) is those involving Oracle V3
    // This also reduces the initial spam when deploying the indexer
    if (
      shouldUseLastKnownPrice &&
      CHAIN_CONSTANTS[chainId].oracle.getType(blockNumber) ===
        PriceOracleType.V3
    ) {
      context.log.info(
        `[refreshTokenPrice] Price fetch returned 0 for token ${token.address} on chain ${chainId} at block ${blockNumber}. Using last known price ${token.pricePerUSDNew} (last updated: ${token.lastUpdatedTimestamp.toISOString()}) as fallback. This may be due to RPC limitation or no price path in oracle.`,
      );
      // Return token with existing price, but update timestamp to current block
      // This ensures we don't keep trying to refresh too frequently
      const updatedToken: Token = {
        ...token,
        lastUpdatedTimestamp: new Date(blockTimestampMs),
      };
      context.Token.set(updatedToken);
      return updatedToken;
    }

    if (
      currentPrice === 0n &&
      token.pricePerUSDNew === 0n &&
      CHAIN_CONSTANTS[chainId].oracle.getType(blockNumber) ===
        PriceOracleType.V3
    ) {
      // Both current and stored prices are 0 - this is a new token or token with no price path
      context.log.warn(
        `[refreshTokenPrice] Price fetch returned 0 for token ${token.address} on chain ${chainId} at block ${blockNumber}, and no previous price exists. This token may not have a price path configured in the oracle.`,
      );
    }

    const updatedToken: Token = {
      ...token,
      pricePerUSDNew: currentPrice,
      decimals: BigInt(tokenDetails.decimals),
      // Preserve original timestamp when price stays $0 so 30-day backoff timer
      // tracks from creation/last non-zero price, not from last refresh attempt.
      lastUpdatedTimestamp:
        currentPrice === 0n && token.pricePerUSDNew === 0n
          ? token.lastUpdatedTimestamp
          : new Date(blockTimestampMs),
    };
    context.Token.set(updatedToken);

    setTokenPriceSnapshot(
      token.address,
      chainId,
      blockNumber,
      new Date(blockTimestampMs),
      currentPrice,
      token.isWhitelisted,
      context,
    );
    return updatedToken;
  } catch (error) {
    context.log.error(
      `Error refreshing token price for ${token.address} on chain ${chainId}: ${error}`,
    );
    // Return original token if refresh fails - this preserves the last known price
    return token;
  }
}
