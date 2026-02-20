import type { NonFungiblePosition, handlerContext } from "generated";
import type { PoolData } from "../../Aggregators/LiquidityPoolAggregator";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import { calculateTotalUSD } from "../../Helpers";

/** Type of liquidity change for UserStatsPerPool attribution. */
export enum LiquidityChangeType {
  ADD = "add",
  REMOVE = "remove",
}

/**
 * Finds a NonFungiblePosition entity by tokenId, filtering by chainId to avoid cross-chain collisions.
 * This is a shared utility function used across NFPM event handlers.
 *
 * @param tokenId - The token ID to search for
 * @param chainId - The chain ID to filter by
 * @param context - The handler context for database operations
 * @returns Array of matching positions (should be 0 or 1), filtered by chainId
 */
export async function findPositionByTokenId(
  tokenId: bigint,
  chainId: number,
  context: handlerContext,
): Promise<NonFungiblePosition[]> {
  const positions =
    await context.NonFungiblePosition.getWhere.tokenId.eq(tokenId);

  if (!positions || positions.length === 0) {
    return [];
  }

  // Filter by chainId to ensure we get the position from the correct chain
  return positions.filter((pos) => pos.chainId === chainId);
}

/**
 * Attributes a liquidity addition or removal to the UserStatsPerPool entity for a given owner and pool.
 * Calculates the total USD-equivalent value of the liquidity change, updates per-token stats,
 * and records the user's last activity timestamp.
 *
 * @param owner - The address of the user whose stats will be updated.
 * @param poolAddress - The address of the liquidity pool related to this change.
 * @param poolData - An object containing instances of token0, token1, and the liquidity pool aggregator.
 * @param context - The event handler context for database operations.
 * @param amount0 - The amount of token0 affected by the liquidity change.
 * @param amount1 - The amount of token1 affected by the liquidity change.
 * @param blockTimestamp - The block timestamp (in seconds) when the event occurred.
 * @param liquidityChangeType - Enum indicating whether liquidity was added or removed.
 *
 * @returns Promise<void> - Resolves once the UserStatsPerPool has been updated.
 */
export async function attributeLiquidityChangeToUserStatsPerPool(
  owner: string,
  poolAddress: string,
  poolData: PoolData,
  context: handlerContext,
  amount0: bigint,
  amount1: bigint,
  blockTimestamp: number,
  liquidityChangeType: LiquidityChangeType,
): Promise<void> {
  const totalLiquidityUSD = calculateTotalUSD(
    amount0,
    amount1,
    poolData.token0Instance,
    poolData.token1Instance,
  );

  const timestamp = new Date(blockTimestamp * 1000);
  const userData = await loadOrCreateUserData(
    owner,
    poolAddress,
    poolData.liquidityPoolAggregator.chainId,
    context,
    timestamp,
  );

  const userDiff =
    liquidityChangeType === LiquidityChangeType.ADD
      ? {
          incrementalTotalLiquidityAddedUSD: totalLiquidityUSD,
          incrementalTotalLiquidityAddedToken0: amount0,
          incrementalTotalLiquidityAddedToken1: amount1,
          lastActivityTimestamp: timestamp,
        }
      : {
          incrementalTotalLiquidityRemovedUSD: totalLiquidityUSD,
          incrementalTotalLiquidityRemovedToken0: amount0,
          incrementalTotalLiquidityRemovedToken1: amount1,
          lastActivityTimestamp: timestamp,
        };

  await updateUserStatsPerPool(userDiff, userData, context, timestamp);
}
