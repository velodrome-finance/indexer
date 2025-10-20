import type { UserStatsPerPool, handlerContext } from "generated";
import { toChecksumAddress } from "../Constants";

/**
 * Loads user data for a specific user-pool combination, creating it if it doesn't exist
 * @param userAddress - The user's address
 * @param poolAddress - The pool's address
 * @param chainId - The chain ID
 * @param context - The handler context
 * @param timestamp - Event timestamp
 * @returns Promise<UserStatsPerPool> - The user stats (created if it didn't exist)
 */
export async function loadUserData(
  userAddress: string,
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  timestamp: Date,
): Promise<UserStatsPerPool> {
  const id = `${toChecksumAddress(userAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;

  // Get existing stats or create new one
  let existingStats = await context.UserStatsPerPool.get(id);

  if (!existingStats) {
    existingStats = createUserStatsPerPoolEntity(
      toChecksumAddress(userAddress),
      toChecksumAddress(poolAddress),
      chainId,
      timestamp,
    );
    context.UserStatsPerPool.set(existingStats);
  }

  return existingStats;
}

/**
 * Creates a new UserStatsPerPool entity
 */
export function createUserStatsPerPoolEntity(
  userAddress: string,
  poolAddress: string,
  chainId: number,
  timestamp: Date,
): UserStatsPerPool {
  return {
    id: `${toChecksumAddress(userAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`,
    userAddress: toChecksumAddress(userAddress),
    poolAddress: toChecksumAddress(poolAddress),
    chainId,

    // Liquidity metrics
    currentLiquidityUSD: 0n,
    currentLiquidityToken0: 0n,
    currentLiquidityToken1: 0n,
    totalLiquidityAddedUSD: 0n,
    totalLiquidityRemovedUSD: 0n,

    // Fee metrics
    totalFeesContributedUSD: 0n,
    totalFeesContributed0: 0n,
    totalFeesContributed1: 0n,

    // Swap metrics
    numberOfSwaps: 0n,
    totalSwapVolumeUSD: 0n,

    // Flash swap metrics
    numberOfFlashLoans: 0n,
    totalFlashLoanVolumeUSD: 0n,

    // Gauge metrics
    numberOfGaugeDeposits: 0n,
    numberOfGaugeWithdrawals: 0n,
    numberOfGaugeRewardClaims: 0n,
    totalGaugeRewardsClaimedUSD: 0n,
    currentLiquidityStakedUSD: 0n,

    // Voting metrics
    numberOfVotes: 0n,
    currentVotingPower: 0n,

    // Timestamps
    firstActivityTimestamp: timestamp,
    lastActivityTimestamp: timestamp,
  };
}

/**
 * Generic function to update UserStatsPerPool with any combination of fields
 * Similar to updateLiquidityPoolAggregator pattern
 */
export async function updateUserStatsPerPool(
  diff: Partial<UserStatsPerPool>,
  current: UserStatsPerPool,
  timestamp: Date,
  context: handlerContext,
): Promise<UserStatsPerPool> {
  const { currentLiquidityUSD: netLiquidityChange, ...otherUpdates } = diff;

  const updated: UserStatsPerPool = {
    ...current,
    currentLiquidityUSD:
      netLiquidityChange !== undefined
        ? current.currentLiquidityUSD + netLiquidityChange
        : current.currentLiquidityUSD,
    totalLiquidityAddedUSD:
      netLiquidityChange !== undefined && netLiquidityChange > 0n
        ? current.totalLiquidityAddedUSD + netLiquidityChange
        : current.totalLiquidityAddedUSD,
    totalLiquidityRemovedUSD:
      netLiquidityChange !== undefined && netLiquidityChange < 0n
        ? current.totalLiquidityRemovedUSD + -netLiquidityChange
        : current.totalLiquidityRemovedUSD,

    currentLiquidityToken0:
      (otherUpdates.currentLiquidityToken0 || 0n) +
      current.currentLiquidityToken0,
    currentLiquidityToken1:
      (otherUpdates.currentLiquidityToken1 || 0n) +
      current.currentLiquidityToken1,

    totalFeesContributed0:
      (otherUpdates.totalFeesContributed0 || 0n) +
      current.totalFeesContributed0,
    totalFeesContributed1:
      (otherUpdates.totalFeesContributed1 || 0n) +
      current.totalFeesContributed1,
    totalFeesContributedUSD:
      (otherUpdates.totalFeesContributedUSD || 0n) +
      current.totalFeesContributedUSD,

    numberOfSwaps: (otherUpdates.numberOfSwaps || 0n) + current.numberOfSwaps,
    totalSwapVolumeUSD:
      (otherUpdates.totalSwapVolumeUSD || 0n) + current.totalSwapVolumeUSD,

    numberOfFlashLoans:
      (otherUpdates.numberOfFlashLoans || 0n) + current.numberOfFlashLoans,
    totalFlashLoanVolumeUSD:
      (otherUpdates.totalFlashLoanVolumeUSD || 0n) +
      current.totalFlashLoanVolumeUSD,

    // Gauge metrics - all cumulative fields
    numberOfGaugeDeposits:
      (otherUpdates.numberOfGaugeDeposits || 0n) +
      current.numberOfGaugeDeposits,
    numberOfGaugeWithdrawals:
      (otherUpdates.numberOfGaugeWithdrawals || 0n) +
      current.numberOfGaugeWithdrawals,
    numberOfGaugeRewardClaims:
      (otherUpdates.numberOfGaugeRewardClaims || 0n) +
      current.numberOfGaugeRewardClaims,
    totalGaugeRewardsClaimedUSD:
      (otherUpdates.totalGaugeRewardsClaimedUSD || 0n) +
      current.totalGaugeRewardsClaimedUSD,
    currentLiquidityStakedUSD:
      (otherUpdates.currentLiquidityStakedUSD || 0n) +
      current.currentLiquidityStakedUSD,

    // Voting metrics
    numberOfVotes: (otherUpdates.numberOfVotes || 0n) + current.numberOfVotes,
    currentVotingPower:
      otherUpdates.currentVotingPower ?? current.currentVotingPower, // current state

    lastActivityTimestamp: timestamp,
  };

  context.UserStatsPerPool.set(updated);
  return updated;
}
