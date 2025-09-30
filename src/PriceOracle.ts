import { TokenIdByBlock, TokenIdByChain, toChecksumAddress } from "./Constants";
import {
  getTokenDetails,
  getTokenPriceData as getTokenPriceDataEffect,
} from "./Effects/Index";
import type {
  Token,
  TokenPriceSnapshot,
  handlerContext,
} from "./src/Types.gen";
export interface TokenPriceData {
  pricePerUSDNew: bigint;
  decimals: bigint;
}

export async function createTokenEntity(
  tokenAddress: string,
  chainId: number,
  blockNumber: number,
  context: handlerContext,
) {
  const blockDatetime = new Date(blockNumber * 1000);
  const tokenDetails = await context.effect(getTokenDetails, {
    contractAddress: tokenAddress,
    chainId,
  });

  const tokenEntity: Token = {
    id: TokenIdByChain(tokenAddress, chainId),
    address: toChecksumAddress(tokenAddress),
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

const ONE_HOUR_MS = 60 * 60 * 1000; // 1 hour in milliseconds

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
 * @param {bigint} gasLimit - The gas limit to use for the simulateContract call
 * @returns {Promise<Token>} The updated token entity
 */
export async function refreshTokenPrice(
  token: Token,
  blockNumber: number,
  blockTimestamp: number,
  chainId: number,
  context: handlerContext,
  gasLimit = 1000000n, // 1 million is the default if "gasLimit" is not specified in simulateContract
): Promise<Token> {
  const blockTimestampMs = blockTimestamp * 1000;

  if (blockTimestampMs - token.lastUpdatedTimestamp.getTime() < ONE_HOUR_MS) {
    return token;
  }

  const tokenPriceData = await context.effect(getTokenPriceDataEffect, {
    tokenAddress: token.address,
    blockNumber,
    chainId,
    gasLimit,
  });
  const currentPrice = tokenPriceData.pricePerUSDNew;
  const updatedToken: Token = {
    ...token,
    pricePerUSDNew: currentPrice,
    decimals: tokenPriceData.decimals,
    lastUpdatedTimestamp: new Date(blockTimestampMs),
  };
  context.Token.set(updatedToken);

  // Create new TokenPrice entity
  const tokenPrice: TokenPriceSnapshot = {
    id: TokenIdByBlock(token.address, chainId, blockNumber),
    address: toChecksumAddress(token.address),
    pricePerUSDNew: currentPrice,
    chainId: chainId,
    isWhitelisted: token.isWhitelisted,
    lastUpdatedTimestamp: new Date(blockTimestampMs),
  };

  context.TokenPriceSnapshot.set(tokenPrice);
  return updatedToken;
}
