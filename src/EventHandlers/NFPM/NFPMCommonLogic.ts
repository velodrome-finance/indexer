import type { NonFungiblePosition, handlerContext } from "generated";
import {
  applyStakedPositionToEdges,
  isPositionInRange,
  updateTicksForStakedPosition,
} from "../../Aggregators/CLStakedLiquidity";
import type { PoolData } from "../../Aggregators/LiquidityPoolAggregator";
import { updateLiquidityPoolAggregator } from "../../Aggregators/LiquidityPoolAggregator";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import {
  calculatePositionAmountsFromLiquidity,
  calculateTotalUSD,
} from "../../Helpers";

/** Type of liquidity change for UserStatsPerPool attribution. */
export enum LiquidityChangeType {
  ADD = "add",
  REMOVE = "remove",
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

  await updateUserStatsPerPool(
    userDiff,
    userData,
    context,
    timestamp,
    poolData,
  );
}

/**
 * Updates CLTickStaked entities and pool staked reserves when a staked position's
 * liquidity changes (IncreaseLiquidity or DecreaseLiquidity).
 *
 * @param position - The NonFungiblePosition being modified
 * @param poolData - Pool data with liquidityPoolAggregator and token instances
 * @param liquidityDelta - Positive for increase, negative for decrease
 * @param context - Handler context for entity access
 * @param timestamp - Block timestamp
 * @param chainId - Chain ID
 * @param blockNumber - Block number
 */
export async function updateStakedPositionLiquidity(
  position: NonFungiblePosition,
  poolData: PoolData,
  liquidityDelta: bigint,
  context: handlerContext,
  timestamp: Date,
  chainId: number,
  blockNumber: number,
): Promise<void> {
  const { liquidityPoolAggregator } = poolData;

  // Maintain the deprecated CLTickStaked entity writes (scheduled for removal
  // in velodrome-finance/indexer#652) alongside the in-aggregator parallel
  // edge/nets arrays. The swap path reads ONLY the aggregator arrays — the
  // legacy writes are kept for one release so the auto-exposed GraphQL entity
  // doesn't vanish without notice.
  await updateTicksForStakedPosition(
    chainId,
    position.pool,
    position.tickLower,
    position.tickUpper,
    liquidityDelta,
    context,
  );
  const {
    edges: stakedTickEdges,
    nets: stakedTickEdgeNets,
    rejected: edgesRejected,
  } = applyStakedPositionToEdges(
    liquidityPoolAggregator.stakedTickEdges,
    liquidityPoolAggregator.stakedTickEdgeNets,
    position.tickLower,
    position.tickUpper,
    liquidityDelta,
  );
  if (edgesRejected) {
    context.log.error(
      `[updateStakedPositionLiquidity] applyStakedPositionToEdges rejected position ${position.tokenId} on pool ${position.pool} chain ${chainId}: reason=${edgesRejected} tickLower=${position.tickLower} tickUpper=${position.tickUpper}. Edge list left unchanged.`,
    );
  }

  // Belt-and-suspenders: flip the hasStakes latch whenever the edge list is
  // non-empty. The primary flip happens on gauge Deposit, but pinning it here
  // too guarantees the swap-path walker sees a consistent (hasStakes=true,
  // edges.length>0) pairing regardless of event ordering.
  const hasStakes = stakedTickEdges.length > 0 ? true : undefined;

  const currentTick = liquidityPoolAggregator.tick ?? 0n;
  const sqrtPriceX96 = liquidityPoolAggregator.sqrtPriceX96 ?? 0n;

  if (sqrtPriceX96 === 0n) {
    // Even without a price, we still persist the edge-list update so the swap
    // path has correct state once a price is established.
    await updateLiquidityPoolAggregator(
      { stakedTickEdges, stakedTickEdgeNets, hasStakes },
      liquidityPoolAggregator,
      timestamp,
      context,
      chainId,
      blockNumber,
    );
    return;
  }

  // stakedReserve0/1 track ALL staked token holdings (in-range + out-of-range) for USD valuation.
  // Out-of-range positions still hold tokens, and calculatePositionAmountsFromLiquidity handles
  // all three cases (below range, in range, above range).
  const { amount0, amount1 } = calculatePositionAmountsFromLiquidity(
    liquidityDelta > 0n ? liquidityDelta : -liquidityDelta,
    sqrtPriceX96,
    position.tickLower,
    position.tickUpper,
  );

  const direction = liquidityDelta > 0n ? 1n : -1n;

  // stakedLiquidityInRange only changes when the position is in range (drives swap proportional attribution)
  const stakedLiquidityInRange = isPositionInRange(
    position.tickLower,
    position.tickUpper,
    currentTick,
  )
    ? (liquidityPoolAggregator.stakedLiquidityInRange ?? 0n) + liquidityDelta
    : undefined;

  const stakedDiff = {
    stakedLiquidityInRange,
    incrementalStakedReserve0: direction * amount0,
    incrementalStakedReserve1: direction * amount1,
    stakedTickEdges,
    stakedTickEdgeNets,
    hasStakes,
  };

  await updateLiquidityPoolAggregator(
    stakedDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    chainId,
    blockNumber,
  );
}
