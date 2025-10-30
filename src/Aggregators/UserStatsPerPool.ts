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
    totalGaugeRewardsClaimed: 0n,
    currentLiquidityStakedUSD: 0n,

    // Voting metrics
    numberOfVotes: 0n,
    currentVotingPower: 0n,

    // Voting Reward Claims
    totalBribeClaimed: 0n,
    totalBribeClaimedUSD: 0n,
    totalFeeRewardClaimed: 0n,
    totalFeeRewardClaimedUSD: 0n,
    veNFTamountStaked: 0n,

    // ALM metrics - initialized to empty/zero values
    almAddress: "",
    almAmount0: 0n,
    almAmount1: 0n,
    almLpAmount: 0n,

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
  const updated: UserStatsPerPool = {
    ...current,
    currentLiquidityUSD:
      diff.currentLiquidityUSD !== undefined
        ? current.currentLiquidityUSD + diff.currentLiquidityUSD
        : current.currentLiquidityUSD,
    totalLiquidityAddedUSD:
      diff.currentLiquidityUSD !== undefined && diff.currentLiquidityUSD > 0n
        ? current.totalLiquidityAddedUSD + diff.currentLiquidityUSD
        : current.totalLiquidityAddedUSD,
    totalLiquidityRemovedUSD:
      diff.currentLiquidityUSD !== undefined && diff.currentLiquidityUSD < 0n
        ? current.totalLiquidityRemovedUSD + -diff.currentLiquidityUSD
        : current.totalLiquidityRemovedUSD,
    currentLiquidityToken0:
      diff.currentLiquidityToken0 !== undefined
        ? current.currentLiquidityToken0 + diff.currentLiquidityToken0
        : current.currentLiquidityToken0,
    currentLiquidityToken1:
      diff.currentLiquidityToken1 !== undefined
        ? current.currentLiquidityToken1 + diff.currentLiquidityToken1
        : current.currentLiquidityToken1,

    totalFeesContributed0:
      diff.totalFeesContributed0 !== undefined
        ? current.totalFeesContributed0 + diff.totalFeesContributed0
        : current.totalFeesContributed0,
    totalFeesContributed1:
      diff.totalFeesContributed1 !== undefined
        ? current.totalFeesContributed1 + diff.totalFeesContributed1
        : current.totalFeesContributed1,
    totalFeesContributedUSD:
      diff.totalFeesContributedUSD !== undefined
        ? current.totalFeesContributedUSD + diff.totalFeesContributedUSD
        : current.totalFeesContributedUSD,

    numberOfSwaps:
      diff.numberOfSwaps !== undefined
        ? current.numberOfSwaps + diff.numberOfSwaps
        : current.numberOfSwaps,
    totalSwapVolumeUSD:
      diff.totalSwapVolumeUSD !== undefined
        ? current.totalSwapVolumeUSD + diff.totalSwapVolumeUSD
        : current.totalSwapVolumeUSD,

    numberOfFlashLoans:
      diff.numberOfFlashLoans !== undefined
        ? current.numberOfFlashLoans + diff.numberOfFlashLoans
        : current.numberOfFlashLoans,
    totalFlashLoanVolumeUSD:
      diff.totalFlashLoanVolumeUSD !== undefined
        ? current.totalFlashLoanVolumeUSD + diff.totalFlashLoanVolumeUSD
        : current.totalFlashLoanVolumeUSD,

    // Gauge metrics - all cumulative fields
    numberOfGaugeDeposits:
      diff.numberOfGaugeDeposits !== undefined
        ? current.numberOfGaugeDeposits + diff.numberOfGaugeDeposits
        : current.numberOfGaugeDeposits,
    numberOfGaugeWithdrawals:
      diff.numberOfGaugeWithdrawals !== undefined
        ? current.numberOfGaugeWithdrawals + diff.numberOfGaugeWithdrawals
        : current.numberOfGaugeWithdrawals,
    numberOfGaugeRewardClaims:
      diff.numberOfGaugeRewardClaims !== undefined
        ? current.numberOfGaugeRewardClaims + diff.numberOfGaugeRewardClaims
        : current.numberOfGaugeRewardClaims,
    totalGaugeRewardsClaimedUSD:
      diff.totalGaugeRewardsClaimedUSD !== undefined
        ? current.totalGaugeRewardsClaimedUSD + diff.totalGaugeRewardsClaimedUSD
        : current.totalGaugeRewardsClaimedUSD,
    totalGaugeRewardsClaimed:
      diff.totalGaugeRewardsClaimed !== undefined
        ? current.totalGaugeRewardsClaimed + diff.totalGaugeRewardsClaimed
        : current.totalGaugeRewardsClaimed,
    currentLiquidityStakedUSD:
      diff.currentLiquidityStakedUSD !== undefined
        ? current.currentLiquidityStakedUSD + diff.currentLiquidityStakedUSD
        : current.currentLiquidityStakedUSD,

    // Voting metrics
    numberOfVotes:
      diff.numberOfVotes !== undefined
        ? current.numberOfVotes + diff.numberOfVotes
        : current.numberOfVotes,
    currentVotingPower: diff.currentVotingPower ?? current.currentVotingPower, // current state

    // Voting Reward Claims - cumulative fields
    totalBribeClaimed:
      diff.totalBribeClaimed !== undefined
        ? current.totalBribeClaimed + diff.totalBribeClaimed
        : current.totalBribeClaimed,
    totalBribeClaimedUSD:
      diff.totalBribeClaimedUSD !== undefined
        ? current.totalBribeClaimedUSD + diff.totalBribeClaimedUSD
        : current.totalBribeClaimedUSD,
    totalFeeRewardClaimed:
      diff.totalFeeRewardClaimed !== undefined
        ? current.totalFeeRewardClaimed + diff.totalFeeRewardClaimed
        : current.totalFeeRewardClaimed,
    totalFeeRewardClaimedUSD:
      diff.totalFeeRewardClaimedUSD !== undefined
        ? current.totalFeeRewardClaimedUSD + diff.totalFeeRewardClaimedUSD
        : current.totalFeeRewardClaimedUSD,
    veNFTamountStaked:
      diff.veNFTamountStaked !== undefined
        ? current.veNFTamountStaked + diff.veNFTamountStaked
        : current.veNFTamountStaked,

    // ALM metrics
    almAmount0:
      diff.almAmount0 !== undefined
        ? current.almAmount0 + diff.almAmount0
        : current.almAmount0,
    almAmount1:
      diff.almAmount1 !== undefined
        ? current.almAmount1 + diff.almAmount1
        : current.almAmount1,
    almLpAmount:
      diff.almLpAmount !== undefined
        ? current.almLpAmount + diff.almLpAmount
        : current.almLpAmount,

    lastActivityTimestamp: timestamp,
  };

  context.UserStatsPerPool.set(updated);
  return updated;
}
