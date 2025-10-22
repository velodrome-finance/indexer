import {
  getCurrentAccumulatedFeeCL,
  getCurrentFee,
  getDynamicFeeConfig,
} from "../Effects/Index";
import type {
  Dynamic_Fee_Swap_Module,
  LiquidityPoolAggregator,
  LiquidityPoolAggregatorSnapshot,
  Token,
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
    // Handle cumulative fields by adding diff values to current values
    reserve0: (diff.reserve0 ?? 0n) + current.reserve0,
    reserve1: (diff.reserve1 ?? 0n) + current.reserve1,
    totalLiquidityUSD:
      (diff.totalLiquidityUSD ?? 0n) + current.totalLiquidityUSD,
    totalVolume0: (diff.totalVolume0 ?? 0n) + current.totalVolume0,
    totalVolume1: (diff.totalVolume1 ?? 0n) + current.totalVolume1,
    totalVolumeUSD: (diff.totalVolumeUSD ?? 0n) + current.totalVolumeUSD,
    totalVolumeUSDWhitelisted:
      (diff.totalVolumeUSDWhitelisted ?? 0n) +
      current.totalVolumeUSDWhitelisted,
    gaugeFees0CurrentEpoch:
      (diff.gaugeFees0CurrentEpoch ?? 0n) + current.gaugeFees0CurrentEpoch,
    gaugeFees1CurrentEpoch:
      (diff.gaugeFees1CurrentEpoch ?? 0n) + current.gaugeFees1CurrentEpoch,
    totalFees0: (diff.totalFees0 ?? 0n) + current.totalFees0,
    totalFees1: (diff.totalFees1 ?? 0n) + current.totalFees1,
    totalFeesUSD: (diff.totalFeesUSD ?? 0n) + current.totalFeesUSD,
    totalFeesUSDWhitelisted:
      (diff.totalFeesUSDWhitelisted ?? 0n) + current.totalFeesUSDWhitelisted,
    numberOfSwaps: (diff.numberOfSwaps ?? 0n) + current.numberOfSwaps,
    numberOfVotes: (diff.numberOfVotes ?? 0n) + current.numberOfVotes,
    totalEmissions: (diff.totalEmissions ?? 0n) + current.totalEmissions,
    totalEmissionsUSD:
      (diff.totalEmissionsUSD ?? 0n) + current.totalEmissionsUSD,
    totalBribesUSD: (diff.totalBribesUSD ?? 0n) + current.totalBribesUSD,
    totalFlashLoanFees0:
      (diff.totalFlashLoanFees0 ?? 0n) + (current.totalFlashLoanFees0 ?? 0n),
    totalFlashLoanFees1:
      (diff.totalFlashLoanFees1 ?? 0n) + (current.totalFlashLoanFees1 ?? 0n),
    totalFlashLoanFeesUSD:
      (diff.totalFlashLoanFeesUSD ?? 0n) +
      (current.totalFlashLoanFeesUSD ?? 0n),
    totalFlashLoanVolumeUSD:
      (diff.totalFlashLoanVolumeUSD ?? 0n) +
      (current.totalFlashLoanVolumeUSD ?? 0n),
    numberOfFlashLoans:
      (diff.numberOfFlashLoans ?? 0n) + (current.numberOfFlashLoans ?? 0n),

    // Gauge fields - all cumulative
    numberOfGaugeDeposits:
      (diff.numberOfGaugeDeposits ?? 0n) + current.numberOfGaugeDeposits,
    numberOfGaugeWithdrawals:
      (diff.numberOfGaugeWithdrawals ?? 0n) + current.numberOfGaugeWithdrawals,
    numberOfGaugeRewardClaims:
      (diff.numberOfGaugeRewardClaims ?? 0n) +
      current.numberOfGaugeRewardClaims,
    totalGaugeRewardsClaimedUSD:
      (diff.totalGaugeRewardsClaimedUSD ?? 0n) +
      current.totalGaugeRewardsClaimedUSD,
    totalGaugeRewardsClaimed:
      (diff.totalGaugeRewardsClaimed ?? 0n) + current.totalGaugeRewardsClaimed,
    currentLiquidityStakedUSD:
      (diff.currentLiquidityStakedUSD ?? 0n) +
      current.currentLiquidityStakedUSD,

    // Handle non-cumulative fields (prices, timestamps, etc.) - use diff values directly
    token0Price: diff.token0Price ?? current.token0Price,
    token1Price: diff.token1Price ?? current.token1Price,
    token0IsWhitelisted:
      diff.token0IsWhitelisted ?? current.token0IsWhitelisted,
    token1IsWhitelisted:
      diff.token1IsWhitelisted ?? current.token1IsWhitelisted,
    gaugeIsAlive: diff.gaugeIsAlive ?? current.gaugeIsAlive,
    gaugeAddress: diff.gaugeAddress ?? current.gaugeAddress,
    feeProtocol0: diff.feeProtocol0 ?? current.feeProtocol0,
    feeProtocol1: diff.feeProtocol1 ?? current.feeProtocol1,
    observationCardinalityNext:
      diff.observationCardinalityNext ?? current.observationCardinalityNext,
    currentVotingPower: diff.currentVotingPower ?? current.currentVotingPower,
    totalVotesDeposited:
      diff.totalVotesDeposited ?? current.totalVotesDeposited,
    totalVotesDepositedUSD:
      diff.totalVotesDepositedUSD ?? current.totalVotesDepositedUSD,

    // Voting Reward Claims - cumulative fields
    totalBribeClaimed:
      (diff.totalBribeClaimed ?? 0n) + current.totalBribeClaimed,
    totalBribeClaimedUSD:
      (diff.totalBribeClaimedUSD ?? 0n) + current.totalBribeClaimedUSD,
    totalFeeRewardClaimed:
      (diff.totalFeeRewardClaimed ?? 0n) + current.totalFeeRewardClaimed,
    totalFeeRewardClaimedUSD:
      (diff.totalFeeRewardClaimedUSD ?? 0n) + current.totalFeeRewardClaimedUSD,
    veNFTamountStaked:
      (diff.veNFTamountStaked ?? 0n) + current.veNFTamountStaked,

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

/**
 * Common pool data loading and validation logic
 * Loads liquidity pool aggregator and token instances, handles errors
 */
export async function loadPoolData(
  srcAddress: string,
  chainId: number,
  context: handlerContext,
): Promise<{
  liquidityPoolAggregator: LiquidityPoolAggregator;
  token0Instance: Token;
  token1Instance: Token;
} | null> {
  // Load liquidity pool aggregator and token instances efficiently
  const liquidityPoolAggregator =
    await context.LiquidityPoolAggregator.get(srcAddress);

  // Load token instances concurrently using the pool's token IDs
  const [token0Instance, token1Instance] = await Promise.all([
    liquidityPoolAggregator
      ? context.Token.get(liquidityPoolAggregator.token0_id)
      : Promise.resolve(undefined),
    liquidityPoolAggregator
      ? context.Token.get(liquidityPoolAggregator.token1_id)
      : Promise.resolve(undefined),
  ]);

  // Handle missing data errors
  if (!liquidityPoolAggregator) {
    context.log.error(
      `LiquidityPoolAggregator ${srcAddress} not found on chain ${chainId}`,
    );
    return null;
  }

  if (!token0Instance || !token1Instance) {
    context.log.error(
      `Token not found for pool ${srcAddress} on chain ${chainId}`,
    );
    return null;
  }

  return {
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
  };
}

/**
 * Enum for pool address field types
 */
export enum PoolAddressField {
  GAUGE_ADDRESS = "gaugeAddress",
  BRIBE_VOTING_REWARD_ADDRESS = "bribeVotingRewardAddress",
  FEE_VOTING_REWARD_ADDRESS = "feeVotingRewardAddress",
}

/**
 * Generic function to find a pool by any indexed address field
 * @param address - The address to search for
 * @param chainId - The chain ID
 * @param context - The handler context
 * @param field - The field to search by
 * @returns The pool entity if found, null otherwise
 */
export async function findPoolByField(
  address: string,
  chainId: number,
  context: handlerContext,
  field: PoolAddressField,
): Promise<LiquidityPoolAggregator | null> {
  // Query pools by the specified field using the indexed field
  const pools =
    await context.LiquidityPoolAggregator.getWhere[field].eq(address);

  // Filter by chainId and return the first match (should be unique)
  const matchingPool = pools.find((pool) => pool.chainId === chainId);
  return matchingPool || null;
}

/**
 * Find a pool by its gauge address using direct database query
 * @param gaugeAddress - The gauge address to search for
 * @param chainId - The chain ID
 * @param context - The handler context
 * @returns The pool entity if found, null otherwise
 */
export async function findPoolByGaugeAddress(
  gaugeAddress: string,
  chainId: number,
  context: handlerContext,
): Promise<LiquidityPoolAggregator | null> {
  return findPoolByField(
    gaugeAddress,
    chainId,
    context,
    PoolAddressField.GAUGE_ADDRESS,
  );
}
