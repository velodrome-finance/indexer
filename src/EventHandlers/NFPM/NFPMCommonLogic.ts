import type { NonFungiblePosition, handlerContext } from "generated";
import {
  applyPositionToEdges,
  deriveLiquidityInRange,
} from "../../Aggregators/CLStakedLiquidity";
import type { PoolData } from "../../Aggregators/Pool";
import { updatePool } from "../../Aggregators/Pool";
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
 * Updates the aggregator's staked-tick edge list and pool staked reserves when
 * a staked position's liquidity changes (IncreaseLiquidity or DecreaseLiquidity).
 *
 * Also mirrors `liquidityDelta` onto the running `currentLiquidityStaked`
 * counter on Pool and the staker's UserStatsPerPool (issue #780). Without
 * this, the next gauge Withdraw arrives with `liquidityToStake =
 * position.liquidity` reflecting in-flight Increase/Decrease deltas, while the
 * indexer's running counter only received the original Deposit amount; the
 * Withdraw guard at `GaugeSharedLogic.ts:419` then underflows and the edges
 * decrement is dropped, leaving phantom positive residue in
 * `stakedTickEdges`/`stakedTickEdgeNets` that swap re-derives forever.
 *
 * Position.owner is the real staker, not the gauge: `handleRegularTransfer`
 * skips owner updates on gauge stake/unstake transfers (see
 * `NFPMTransferLogic.ts:300-318`), so `loadOrCreateUserData(position.owner)`
 * resolves the UserStatsPerPool that `processGaugeDeposit` originally
 * incremented.
 *
 * @param position - The NonFungiblePosition being modified
 * @param poolData - Pool data with liquidityPoolAggregator and token instances
 * @param liquidityDelta - Positive for increase, negative for decrease
 * @param context - Handler context for entity access
 * @param timestamp - Block timestamp
 * @param chainId - Chain ID
 * @param blockNumber - Block number
 * @returns Promise that resolves once the pool's staked-tick edges, derived
 *   stakedLiquidityInRange, staked reserves, and currentLiquidityStaked
 *   counter are staged, alongside the staker's UserStatsPerPool counter.
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

  const {
    edges: stakedTickEdges,
    nets: stakedTickEdgeNets,
    rejected: edgesRejected,
  } = applyPositionToEdges(
    liquidityPoolAggregator.stakedTickEdges,
    liquidityPoolAggregator.stakedTickEdgeNets,
    position.tickLower,
    position.tickUpper,
    liquidityDelta,
  );
  if (edgesRejected) {
    context.log.error(
      `[updateStakedPositionLiquidity] applyPositionToEdges rejected position ${position.tokenId} on pool ${position.pool} chain ${chainId}: reason=${edgesRejected} tickLower=${position.tickLower} tickUpper=${position.tickUpper}. Edge list left unchanged.`,
    );
  }

  // Belt-and-suspenders: flip the hasStakes latch whenever the edge list is
  // non-empty. The primary flip happens on gauge Deposit, but pinning it here
  // too guarantees the swap-path walker sees a consistent (hasStakes=true,
  // edges.length>0) pairing regardless of event ordering.
  const hasStakes = stakedTickEdges.length > 0 ? true : undefined;

  const currentTick = liquidityPoolAggregator.tick ?? 0n;
  const sqrtPriceX96 = liquidityPoolAggregator.sqrtPriceX96 ?? 0n;

  // Derive stakedLiquidityInRange from the (possibly updated) edge state at
  // currentTick (issue #719). Applies on both the early-exit path (sqrt=0n)
  // and the normal path, so NFPM-mediated liquidity changes between gauge
  // deposit and withdraw can't desync the counter from the edges.
  const stakedLiquidityInRange = deriveLiquidityInRange(
    currentTick,
    stakedTickEdges,
    stakedTickEdgeNets,
  );

  // Issue #780: load and update the staker's UserStatsPerPool in parallel
  // with the pool update so the gauge Withdraw guard's user-side check stays
  // in sync. `position.owner` is the staker (not the gauge) because
  // handleRegularTransfer skips owner updates on stake/unstake transfers.
  const stakerUserData = await loadOrCreateUserData(
    position.owner,
    position.pool,
    chainId,
    context,
    timestamp,
  );
  const userDiff = {
    incrementalCurrentLiquidityStaked: liquidityDelta,
    lastActivityTimestamp: timestamp,
  };

  if (sqrtPriceX96 === 0n) {
    // Defensive fallback: since velodrome-finance/indexer#654 wired
    // CLPool.Initialize to populate sqrtPriceX96/tick on the aggregator, a
    // zero price here implies the pool was never Initialize'd in the indexed
    // range (e.g. pre-existing data from a previous indexer version). Persist
    // the edge-list update so the swap path has correct state once a price is
    // established, but skip the amount math that would otherwise produce
    // garbage from sqrtPriceX96=0.
    await Promise.all([
      updatePool(
        {
          incrementalCurrentLiquidityStaked: liquidityDelta,
          stakedTickEdges,
          stakedTickEdgeNets,
          stakedLiquidityInRange,
          hasStakes,
        },
        liquidityPoolAggregator,
        timestamp,
        context,
        chainId,
        blockNumber,
      ),
      updateUserStatsPerPool(
        userDiff,
        stakerUserData,
        context,
        timestamp,
        poolData,
      ),
    ]);
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

  const stakedDiff = {
    incrementalCurrentLiquidityStaked: liquidityDelta,
    stakedLiquidityInRange,
    incrementalStakedReserve0: direction * amount0,
    incrementalStakedReserve1: direction * amount1,
    stakedTickEdges,
    stakedTickEdgeNets,
    hasStakes,
  };

  await Promise.all([
    updatePool(
      stakedDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      chainId,
      blockNumber,
    ),
    updateUserStatsPerPool(
      userDiff,
      stakerUserData,
      context,
      timestamp,
      poolData,
    ),
  ]);
}
