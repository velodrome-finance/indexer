import type {
  NFPM_DecreaseLiquidity_event,
  NFPM_IncreaseLiquidity_event,
  NonFungiblePosition,
  Token,
  handlerContext,
} from "generated";
import { getSqrtPriceX96 } from "../../Effects/Index";
import {
  calculatePositionAmountsFromLiquidity,
  calculateTotalLiquidityUSD,
} from "../../Helpers";

export interface ProcessTransferResult {
  updatedPosition: Partial<NonFungiblePosition>;
}

export interface ProcessIncreaseLiquidityResult {
  updatedPosition: Partial<NonFungiblePosition>;
}

export interface ProcessDecreaseLiquidityResult {
  updatedPosition: Partial<NonFungiblePosition>;
}

/**
 * Gets position by tokenId with fallback to placeholder lookup
 * Tries to get position by tokenId, and if not found, looks for placeholder in transaction
 * @param chainId - The chain ID
 * @param tokenId - The token ID for the position
 * @param transactionHash - The transaction hash to search for placeholder positions
 * @param context - The handler context for database operations
 * @param shouldCheckPlaceholder - Whether to check for placeholder positions (default: true)
 * @param logIndex - The log index of the current event (used to match placeholder by logIndex comparison)
 * @returns The position if found, or null if not found
 */
export async function getPositionWithPlaceholderFallback(
  chainId: number,
  tokenId: bigint,
  transactionHash: string,
  context: handlerContext,
  shouldCheckPlaceholder = true,
  logIndex?: number,
): Promise<NonFungiblePosition | null> {
  // Try to get position by tokenId
  let positions =
    await context.NonFungiblePosition.getWhere.tokenId.eq(tokenId);

  // Filter by chainId to avoid cross-chain collisions (same tokenId can exist on different chains)
  if (positions && positions.length > 0) {
    positions = positions.filter((pos) => pos.chainId === chainId);
    return positions[0];
  }

  // If not found and should check placeholder, look for placeholder position in same transaction
  if (shouldCheckPlaceholder) {
    const txPositions =
      await context.NonFungiblePosition.getWhere.mintTransactionHash.eq(
        transactionHash,
      );

    if (txPositions && txPositions.length > 0) {
      // Find position with placeholder tokenId that hasn't been updated yet
      // Placeholder ID format: ${chainId}_${txHash}_${logIndex}
      // Placeholder tokenId is set to 0n to mark it as a placeholder
      const placeholderIdPrefix = `${chainId}_${transactionHash.slice(2)}_`;
      const matchingPlaceholders = txPositions.filter(
        (pos) => pos.id.startsWith(placeholderIdPrefix) && pos.tokenId === 0n, // Placeholder marker
      );

      // If multiple placeholders match (multiple mints in same transaction),
      // we'll take the first one. In practice, there should only be one placeholder per mint.
      // If there are multiple, they should be matched by amounts in IncreaseLiquidity.
      const placeholderPosition = matchingPlaceholders[0];

      if (placeholderPosition) {
        // Return placeholder as-is (ID stays as placeholder ID)
        return placeholderPosition;
      }
    }
  }

  return null;
}

/**
 * Gets both tokens for a position in parallel
 * @param chainId - The chain ID
 * @param position - The position to get tokens for
 * @param context - The handler context for database operations
 * @returns A tuple of [token0, token1], either may be undefined if not found
 */
export async function getTokensForPosition(
  chainId: number,
  position: NonFungiblePosition,
  context: handlerContext,
): Promise<[Token | undefined, Token | undefined]> {
  return await Promise.all([
    context.Token.get(`${position.token0}-${chainId}`),
    context.Token.get(`${position.token1}-${chainId}`),
  ]);
}

/**
 * Finds NonFungiblePosition by transaction hash and matching amounts
 * Used to find the correct position when multiple positions exist in the same transaction
 * @param transactionHash - The transaction hash to search for positions
 * @param amount0 - The amount0 to match
 * @param amount1 - The amount1 to match
 * @param context - The handler context for database operations
 * @returns The matching position if found, or null if not found
 */
export async function findNonFungiblePositionByTXHashAndAmounts(
  transactionHash: string,
  amount0: bigint,
  amount1: bigint,
  context: handlerContext,
): Promise<NonFungiblePosition | null> {
  const positions =
    await context.NonFungiblePosition.getWhere.mintTransactionHash.eq(
      transactionHash,
    );

  if (!positions || positions.length === 0) {
    return null;
  }

  // Filter by amount0 and amount1 to find the matching position
  // More robust filtering if, for example, there's more than 1 Mint event for the same transaction hash
  // Prioritize placeholders (tokenId === 0n) first, then match by amounts
  const placeholders = positions.filter((pos) => pos.tokenId === 0n);
  const matchingPlaceholder = placeholders.find(
    (pos) => pos.amount0 === amount0 && pos.amount1 === amount1,
  );

  if (matchingPlaceholder) {
    return matchingPlaceholder;
  }

  // If no placeholder matches, try all positions
  const matchingPosition = positions.find(
    (pos) => pos.amount0 === amount0 && pos.amount1 === amount1,
  );

  return matchingPosition || null;
}

/**
 * Cleans up orphaned placeholders from a transaction
 * After updating a placeholder with the actual tokenId, any remaining placeholders
 * with tokenId = 0n in the same transaction are orphaned (e.g., created for increases)
 * @param transactionHash - The transaction hash to clean up placeholders from
 * @param context - The handler context for database operations
 */
export async function cleanupOrphanedPlaceholders(
  transactionHash: string,
  context: handlerContext,
): Promise<void> {
  const allTxPositions =
    await context.NonFungiblePosition.getWhere.mintTransactionHash.eq(
      transactionHash,
    );

  if (allTxPositions && allTxPositions.length > 0) {
    // Find all orphaned placeholders (tokenId = 0n) from this transaction
    // Updated placeholders won't be included because they now have tokenId != 0n
    const orphanedPlaceholders = allTxPositions.filter(
      (pos) => pos.tokenId === 0n,
    );

    // Delete all orphaned placeholders
    for (const orphaned of orphanedPlaceholders) {
      context.NonFungiblePosition.deleteUnsafe(orphaned.id);
    }
  }
}

/**
 * Gets sqrtPriceX96 and tokens for a position in parallel
 * @param chainId - The chain ID
 * @param position - The position to get data for
 * @param blockNumber - The block number to fetch sqrtPriceX96 at
 * @param context - The handler context for database operations and effects
 * @returns A tuple of [sqrtPriceX96, token0, token1], tokens may be undefined if not found
 */
export async function getSqrtPriceX96AndTokens(
  chainId: number,
  position: NonFungiblePosition,
  blockNumber: number,
  context: handlerContext,
): Promise<[bigint, Token | undefined, Token | undefined]> {
  return await Promise.all([
    context.effect(getSqrtPriceX96, {
      poolAddress: position.pool,
      chainId: chainId,
      blockNumber: blockNumber,
    }),
    context.Token.get(`${position.token0}-${chainId}`),
    context.Token.get(`${position.token1}-${chainId}`),
  ]);
}

/**
 * Processes Transfer event for NonFungiblePosition
 * Updates owner and recalculates USD value based on current token prices
 * @param toAddress - The new owner address
 * @param position - The position being transferred
 * @param token0 - Token0 entity (may be undefined)
 * @param token1 - Token1 entity (may be undefined)
 * @param blockTimestamp - The block timestamp
 * @returns Result containing the updated position fields
 */
export function processTransfer(
  toAddress: string,
  position: NonFungiblePosition,
  token0: Token | undefined,
  token1: Token | undefined,
  blockTimestamp: number,
): ProcessTransferResult {
  const blockDatetime = new Date(blockTimestamp * 1000);

  // Updating amountUSD given current prices of token0 and token1
  const NonFungiblePositionAmountUSD = calculateTotalLiquidityUSD(
    position.amount0,
    position.amount1,
    token0,
    token1,
  );

  // Update owner on transfer
  const updatedPosition: Partial<NonFungiblePosition> = {
    owner: toAddress,
    amountUSD: NonFungiblePositionAmountUSD,
    lastUpdatedTimestamp: blockDatetime,
  };

  return {
    updatedPosition,
  };
}

/**
 * Processes IncreaseLiquidity event for NonFungiblePosition
 * Recalculates amounts from new total liquidity and current price
 * @param event - The IncreaseLiquidity event
 * @param position - The position to update
 * @param sqrtPriceX96 - Current sqrt price from the pool
 * @param token0 - Token0 entity (may be undefined)
 * @param token1 - Token1 entity (may be undefined)
 * @returns Result containing the updated position fields
 */
export function processIncreaseLiquidity(
  event: NFPM_IncreaseLiquidity_event,
  position: NonFungiblePosition,
  sqrtPriceX96: bigint,
  token0: Token | undefined,
  token1: Token | undefined,
): ProcessIncreaseLiquidityResult {
  // Ensure liquidity exists (default to 0 for positions created before liquidity field was added)
  const currentLiquidity = position.liquidity ?? 0n;

  // Add the new liquidity from the event
  const newLiquidity = currentLiquidity + event.params.liquidity;

  // Recalculate ALL amounts from the new total liquidity + current price
  // This ensures amounts are always accurate based on current price, not stale deltas
  const newAmounts = calculatePositionAmountsFromLiquidity(
    newLiquidity,
    sqrtPriceX96,
    position.tickLower,
    position.tickUpper,
  );

  const blockDatetime = new Date(event.block.timestamp * 1000);

  const NonFungiblePositionAmountUSD = calculateTotalLiquidityUSD(
    newAmounts.amount0,
    newAmounts.amount1,
    token0,
    token1,
  );

  // Update position with increased liquidity amounts
  const updatedPosition: Partial<NonFungiblePosition> = {
    liquidity: newLiquidity,
    amount0: newAmounts.amount0,
    amount1: newAmounts.amount1,
    amountUSD: NonFungiblePositionAmountUSD,
    lastUpdatedTimestamp: blockDatetime,
  };

  return {
    updatedPosition,
  };
}

/**
 * Processes DecreaseLiquidity event for NonFungiblePosition
 * Recalculates amounts from new total liquidity and current price
 * @param event - The DecreaseLiquidity event
 * @param position - The position to update
 * @param sqrtPriceX96 - Current sqrt price from the pool
 * @param token0 - Token0 entity (may be undefined)
 * @param token1 - Token1 entity (may be undefined)
 * @returns Result containing the updated position fields
 */
export function processDecreaseLiquidity(
  event: NFPM_DecreaseLiquidity_event,
  position: NonFungiblePosition,
  sqrtPriceX96: bigint,
  token0: Token | undefined,
  token1: Token | undefined,
): ProcessDecreaseLiquidityResult {
  const currentLiquidity = position.liquidity;

  // Subtract the liquidity from the event
  const newLiquidity =
    currentLiquidity > event.params.liquidity
      ? currentLiquidity - event.params.liquidity
      : 0n;

  // Recalculate ALL amounts from the new total liquidity + current price
  // This ensures amounts are always accurate based on current price, not stale deltas
  const newAmounts = calculatePositionAmountsFromLiquidity(
    newLiquidity,
    sqrtPriceX96,
    position.tickLower,
    position.tickUpper,
  );

  const blockDatetime = new Date(event.block.timestamp * 1000);

  const NonFungiblePositionAmountUSD = calculateTotalLiquidityUSD(
    newAmounts.amount0,
    newAmounts.amount1,
    token0,
    token1,
  );

  const updatedPosition: Partial<NonFungiblePosition> = {
    liquidity: newLiquidity,
    amount0: newAmounts.amount0,
    amount1: newAmounts.amount1,
    amountUSD: NonFungiblePositionAmountUSD,
    lastUpdatedTimestamp: blockDatetime,
  };

  return {
    updatedPosition,
  };
}
