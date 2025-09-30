import {
  getCurrentAccumulatedFeeCL,
  getCurrentFee,
  getDynamicFeeConfig,
} from "../Effects/Index";
import type {
  Dynamic_Fee_Swap_Module,
  LiquidityPoolAggregator,
  LiquidityPoolAggregatorSnapshot,
  handlerContext,
} from "./../src/Types.gen";

const UPDATE_INTERVAL = 60 * 60 * 1000; // 1 hour

const DYNAMIC_FEE_START_BLOCK = 131341414; // Starting from this block to track dynamic fee pools

export type DynamicFeeConfig = {
  baseFee: bigint;
  feeCap: bigint;
  scalingFactor: bigint;
};

export type GaugeFees = {
  token0Fees: bigint;
  token1Fees: bigint;
};

/**
 * Update the dynamic fee pools data from the swap module.
 * @param liquidityPoolAggregator
 * @param context
 * @param blockNumber
 */
export async function updateDynamicFeePools(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  context: handlerContext,
  blockNumber: number,
) {
  const poolAddress = liquidityPoolAggregator.id;
  const chainId = liquidityPoolAggregator.chainId;

  if (chainId === 10 && blockNumber >= DYNAMIC_FEE_START_BLOCK) {
    try {
      const dynamicFeeConfigData = await context.effect(getDynamicFeeConfig, {
        poolAddress,
        chainId,
        blockNumber,
      });
      const currentFee = await context.effect(getCurrentFee, {
        poolAddress,
        chainId,
        blockNumber,
      });

      const dynamicFeeConfig: Dynamic_Fee_Swap_Module = {
        ...dynamicFeeConfigData,
        currentFee,
        pool: poolAddress,
        timestamp: liquidityPoolAggregator.lastUpdatedTimestamp,
        chainId,
        blockNumber,
        id: `${chainId}-${poolAddress}-${blockNumber}`,
      };

      context.Dynamic_Fee_Swap_Module.set(dynamicFeeConfig);
    } catch (error) {
      // No error if the pool is not a dynamic fee pool
      return;
    }
  }
}

/**
 * Creates and stores a snapshot of the current state of a LiquidityPoolAggregator.
 *
 * This function is used to capture the state of a liquidity pool aggregator at a specific
 * point in time. The snapshot includes the pool's ID, a unique snapshot ID, and the timestamp
 * of the last update.
 *
 * @param liquidityPoolAggregator - The current state of the liquidity pool aggregator.
 * @param timestamp - The current timestamp when the snapshot is taken.
 * @param context - The handler context used to store the snapshot.
 */
export function setLiquidityPoolAggregatorSnapshot(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  timestamp: Date,
  context: handlerContext,
) {
  const chainId = liquidityPoolAggregator.chainId;

  const snapshot: LiquidityPoolAggregatorSnapshot = {
    ...liquidityPoolAggregator,
    pool: liquidityPoolAggregator.id,
    id: `${chainId}-${liquidityPoolAggregator.id}_${timestamp.getTime()}`,
    timestamp: liquidityPoolAggregator.lastUpdatedTimestamp,
  };

  context.LiquidityPoolAggregatorSnapshot.set(snapshot);
}

/**
 * Updates the state of a LiquidityPoolAggregator with new data and manages snapshots.
 *
 * This function applies a set of changes (diff) to the current state of a liquidity pool
 * aggregator. It updates the last updated timestamp and, if more than an hour has passed
 * since the last snapshot, it creates a new snapshot of the aggregator's state.
 *
 * @param diff - An object containing the changes to be applied to the current state.
 * @param current - The current state of the liquidity pool aggregator.
 * @param timestamp - The current timestamp when the update is applied.
 * @param context - The handler context used to store the updated state and snapshots.
 */
export async function updateLiquidityPoolAggregator(
  diff: Partial<LiquidityPoolAggregator>,
  current: LiquidityPoolAggregator,
  timestamp: Date,
  context: handlerContext,
  blockNumber: number,
) {
  const updated: LiquidityPoolAggregator = {
    ...current,
    ...diff,
    lastUpdatedTimestamp: timestamp,
  };

  context.LiquidityPoolAggregator.set(updated);

  // Update the snapshot if the last update was more than 1 hour ago
  if (
    !current.lastSnapshotTimestamp ||
    timestamp.getTime() - current.lastSnapshotTimestamp.getTime() >
      UPDATE_INTERVAL
  ) {
    if (current.isCL) {
      try {
        const gaugeFees = await context.effect(getCurrentAccumulatedFeeCL, {
          poolAddress: current.id,
          chainId: current.chainId,
          blockNumber,
        });
        const gaugeFeeUpdated: LiquidityPoolAggregator = {
          ...updated,
          gaugeFees0CurrentEpoch: gaugeFees.token0Fees,
          gaugeFees1CurrentEpoch: gaugeFees.token1Fees,
        };
        setLiquidityPoolAggregatorSnapshot(gaugeFeeUpdated, timestamp, context);
        updateDynamicFeePools(gaugeFeeUpdated, context, blockNumber);
        return;
      } catch (error) {
        // No error if the pool is not a CL pool
      }
    }
    setLiquidityPoolAggregatorSnapshot(updated, timestamp, context);
  }
}
