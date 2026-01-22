import type { UserStatsPerPool, handlerContext } from "generated";
import { toChecksumAddress } from "../Constants";

export interface UserStatsPerPoolDiff {
  incrementalCurrentLiquidityUSD: bigint;
  incrementalLpBalance: bigint;
  incrementalTotalLiquidityAddedUSD: bigint;
  incrementalTotalLiquidityAddedToken0: bigint;
  incrementalTotalLiquidityAddedToken1: bigint;
  incrementalTotalLiquidityRemovedUSD: bigint;
  incrementalTotalLiquidityRemovedToken0: bigint;
  incrementalTotalLiquidityRemovedToken1: bigint;
  incrementalTotalFeesContributedUSD: bigint;
  incrementalTotalFeesContributed0: bigint;
  incrementalTotalFeesContributed1: bigint;
  incrementalNumberOfSwaps: bigint;
  incrementalTotalSwapVolumeAmount0: bigint;
  incrementalTotalSwapVolumeAmount1: bigint;
  incrementalTotalSwapVolumeUSD: bigint;
  incrementalNumberOfFlashLoans: bigint;
  incrementalTotalFlashLoanVolumeUSD: bigint;
  incrementalNumberOfGaugeDeposits: bigint;
  incrementalNumberOfGaugeWithdrawals: bigint;
  incrementalNumberOfGaugeRewardClaims: bigint;
  incrementalTotalGaugeRewardsClaimedUSD: bigint;
  incrementalTotalGaugeRewardsClaimed: bigint;
  incrementalCurrentLiquidityStaked: bigint;
  incrementalCurrentLiquidityStakedUSD: bigint;
  incrementalVeNFTamountStaked: bigint;
  incrementalTotalBribeClaimed: bigint;
  incrementalTotalBribeClaimedUSD: bigint;
  incrementalTotalFeeRewardClaimed: bigint;
  incrementalTotalFeeRewardClaimedUSD: bigint;
  almAddress: string;
  almAmount0: bigint;
  almAmount1: bigint;
  incrementalAlmLpAmount: bigint;
  lastAlmActivityTimestamp: Date;
  lastActivityTimestamp: Date;
}

/**
 * Generates the ID for a UserStatsPerPool entity
 * @param userAddress - The user's address
 * @param poolAddress - The pool's address
 * @param chainId - The chain ID
 * @returns The entity ID string
 */
export function getUserStatsPerPoolId(
  userAddress: string,
  poolAddress: string,
  chainId: number,
): string {
  return `${toChecksumAddress(userAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
}

/**
 * Loads a UserStatsPerPool entity by its ID
 * @param userAddress - The user's address
 * @param poolAddress - The pool's address
 * @param chainId - The chain ID
 * @param context - The handler context
 * @returns Promise<UserStatsPerPool | undefined> - The UserStatsPerPool entity or undefined if not found
 */
export async function loadUserStatsPerPool(
  userAddress: string,
  poolAddress: string,
  chainId: number,
  context: handlerContext,
): Promise<UserStatsPerPool | undefined> {
  const id = getUserStatsPerPoolId(userAddress, poolAddress, chainId);
  return context.UserStatsPerPool.get(id);
}

/**
 * Loads or creates user stats for a specific user-pool combination.
 * If the entity does not exist, it is created with initial values.
 * @param userAddress - The user's address
 * @param poolAddress - The pool's address
 * @param chainId - The chain ID
 * @param context - The handler context
 * @param timestamp - Event timestamp
 * @returns Promise<UserStatsPerPool> - The UserStatsPerPool entity (new or existing)
 */
export async function loadOrCreateUserData(
  userAddress: string,
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  timestamp: Date,
): Promise<UserStatsPerPool> {
  let existingStats = await loadUserStatsPerPool(
    userAddress,
    poolAddress,
    chainId,
    context,
  );

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
    id: getUserStatsPerPoolId(userAddress, poolAddress, chainId),
    userAddress: toChecksumAddress(userAddress),
    poolAddress: toChecksumAddress(poolAddress),
    chainId,

    // Liquidity metrics
    currentLiquidityUSD: 0n,
    lpBalance: 0n,
    totalLiquidityAddedUSD: 0n,
    totalLiquidityAddedToken0: 0n,
    totalLiquidityAddedToken1: 0n,
    totalLiquidityRemovedUSD: 0n,
    totalLiquidityRemovedToken0: 0n,
    totalLiquidityRemovedToken1: 0n,

    // Fee metrics
    totalFeesContributedUSD: 0n,
    totalFeesContributed0: 0n,
    totalFeesContributed1: 0n,

    // Swap metrics
    numberOfSwaps: 0n,
    totalSwapVolumeUSD: 0n,
    totalSwapVolumeAmount0: 0n,
    totalSwapVolumeAmount1: 0n,

    // Flash swap metrics
    numberOfFlashLoans: 0n,
    totalFlashLoanVolumeUSD: 0n,

    // Gauge metrics
    numberOfGaugeDeposits: 0n,
    numberOfGaugeWithdrawals: 0n,
    numberOfGaugeRewardClaims: 0n,
    totalGaugeRewardsClaimedUSD: 0n,
    totalGaugeRewardsClaimed: 0n,
    currentLiquidityStaked: 0n,
    currentLiquidityStakedUSD: 0n,

    // Voting metrics
    veNFTamountStaked: 0n,

    // Voting Reward Claims
    totalBribeClaimed: 0n,
    totalBribeClaimedUSD: 0n,
    totalFeeRewardClaimed: 0n,
    totalFeeRewardClaimedUSD: 0n,

    // ALM metrics - initialized to empty/zero values
    almAddress: "",
    almAmount0: 0n,
    almAmount1: 0n,
    almLpAmount: 0n,
    lastAlmActivityTimestamp: timestamp,

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
  diff: Partial<UserStatsPerPoolDiff>,
  current: UserStatsPerPool,
  context: handlerContext,
): Promise<UserStatsPerPool> {
  const updated: UserStatsPerPool = {
    ...current,
    currentLiquidityUSD:
      diff.incrementalCurrentLiquidityUSD !== undefined
        ? current.currentLiquidityUSD + diff.incrementalCurrentLiquidityUSD
        : current.currentLiquidityUSD,
    totalLiquidityAddedUSD:
      diff.incrementalTotalLiquidityAddedUSD !== undefined
        ? current.totalLiquidityAddedUSD +
          diff.incrementalTotalLiquidityAddedUSD
        : current.totalLiquidityAddedUSD,
    totalLiquidityRemovedUSD:
      diff.incrementalTotalLiquidityRemovedUSD !== undefined
        ? current.totalLiquidityRemovedUSD +
          diff.incrementalTotalLiquidityRemovedUSD
        : current.totalLiquidityRemovedUSD,
    totalLiquidityAddedToken0:
      diff.incrementalTotalLiquidityAddedToken0 !== undefined
        ? current.totalLiquidityAddedToken0 +
          diff.incrementalTotalLiquidityAddedToken0
        : current.totalLiquidityAddedToken0,
    totalLiquidityAddedToken1:
      diff.incrementalTotalLiquidityAddedToken1 !== undefined
        ? current.totalLiquidityAddedToken1 +
          diff.incrementalTotalLiquidityAddedToken1
        : current.totalLiquidityAddedToken1,
    totalLiquidityRemovedToken0:
      diff.incrementalTotalLiquidityRemovedToken0 !== undefined
        ? current.totalLiquidityRemovedToken0 +
          diff.incrementalTotalLiquidityRemovedToken0
        : current.totalLiquidityRemovedToken0,
    totalLiquidityRemovedToken1:
      diff.incrementalTotalLiquidityRemovedToken1 !== undefined
        ? current.totalLiquidityRemovedToken1 +
          diff.incrementalTotalLiquidityRemovedToken1
        : current.totalLiquidityRemovedToken1,
    lpBalance:
      diff.incrementalLpBalance !== undefined
        ? current.lpBalance + diff.incrementalLpBalance
        : current.lpBalance,

    totalFeesContributed0:
      diff.incrementalTotalFeesContributed0 !== undefined
        ? current.totalFeesContributed0 + diff.incrementalTotalFeesContributed0
        : current.totalFeesContributed0,
    totalFeesContributed1:
      diff.incrementalTotalFeesContributed1 !== undefined
        ? current.totalFeesContributed1 + diff.incrementalTotalFeesContributed1
        : current.totalFeesContributed1,
    totalFeesContributedUSD:
      diff.incrementalTotalFeesContributedUSD !== undefined
        ? current.totalFeesContributedUSD +
          diff.incrementalTotalFeesContributedUSD
        : current.totalFeesContributedUSD,

    numberOfSwaps:
      diff.incrementalNumberOfSwaps !== undefined
        ? current.numberOfSwaps + diff.incrementalNumberOfSwaps
        : current.numberOfSwaps,
    totalSwapVolumeAmount0:
      diff.incrementalTotalSwapVolumeAmount0 !== undefined
        ? current.totalSwapVolumeAmount0 +
          diff.incrementalTotalSwapVolumeAmount0
        : current.totalSwapVolumeAmount0,
    totalSwapVolumeAmount1:
      diff.incrementalTotalSwapVolumeAmount1 !== undefined
        ? current.totalSwapVolumeAmount1 +
          diff.incrementalTotalSwapVolumeAmount1
        : current.totalSwapVolumeAmount1,
    totalSwapVolumeUSD:
      diff.incrementalTotalSwapVolumeUSD !== undefined
        ? current.totalSwapVolumeUSD + diff.incrementalTotalSwapVolumeUSD
        : current.totalSwapVolumeUSD,

    numberOfFlashLoans:
      diff.incrementalNumberOfFlashLoans !== undefined
        ? current.numberOfFlashLoans + diff.incrementalNumberOfFlashLoans
        : current.numberOfFlashLoans,
    totalFlashLoanVolumeUSD:
      diff.incrementalTotalFlashLoanVolumeUSD !== undefined
        ? current.totalFlashLoanVolumeUSD +
          diff.incrementalTotalFlashLoanVolumeUSD
        : current.totalFlashLoanVolumeUSD,

    // Gauge metrics - all cumulative fields
    numberOfGaugeDeposits:
      diff.incrementalNumberOfGaugeDeposits !== undefined
        ? current.numberOfGaugeDeposits + diff.incrementalNumberOfGaugeDeposits
        : current.numberOfGaugeDeposits,
    numberOfGaugeWithdrawals:
      diff.incrementalNumberOfGaugeWithdrawals !== undefined
        ? current.numberOfGaugeWithdrawals +
          diff.incrementalNumberOfGaugeWithdrawals
        : current.numberOfGaugeWithdrawals,
    numberOfGaugeRewardClaims:
      diff.incrementalNumberOfGaugeRewardClaims !== undefined
        ? current.numberOfGaugeRewardClaims +
          diff.incrementalNumberOfGaugeRewardClaims
        : current.numberOfGaugeRewardClaims,
    totalGaugeRewardsClaimedUSD:
      diff.incrementalTotalGaugeRewardsClaimedUSD !== undefined
        ? current.totalGaugeRewardsClaimedUSD +
          diff.incrementalTotalGaugeRewardsClaimedUSD
        : current.totalGaugeRewardsClaimedUSD,
    totalGaugeRewardsClaimed:
      diff.incrementalTotalGaugeRewardsClaimed !== undefined
        ? current.totalGaugeRewardsClaimed +
          diff.incrementalTotalGaugeRewardsClaimed
        : current.totalGaugeRewardsClaimed,
    currentLiquidityStaked:
      diff.incrementalCurrentLiquidityStaked !== undefined
        ? current.currentLiquidityStaked +
          diff.incrementalCurrentLiquidityStaked
        : current.currentLiquidityStaked,
    currentLiquidityStakedUSD:
      diff.incrementalCurrentLiquidityStakedUSD !== undefined
        ? current.currentLiquidityStakedUSD +
          diff.incrementalCurrentLiquidityStakedUSD
        : current.currentLiquidityStakedUSD,

    // Voting metrics
    veNFTamountStaked:
      diff.incrementalVeNFTamountStaked !== undefined
        ? current.veNFTamountStaked + diff.incrementalVeNFTamountStaked
        : current.veNFTamountStaked,

    // Voting Reward Claims - cumulative fields
    totalBribeClaimed:
      diff.incrementalTotalBribeClaimed !== undefined
        ? current.totalBribeClaimed + diff.incrementalTotalBribeClaimed
        : current.totalBribeClaimed,
    totalBribeClaimedUSD:
      diff.incrementalTotalBribeClaimedUSD !== undefined
        ? current.totalBribeClaimedUSD + diff.incrementalTotalBribeClaimedUSD
        : current.totalBribeClaimedUSD,
    totalFeeRewardClaimed:
      diff.incrementalTotalFeeRewardClaimed !== undefined
        ? current.totalFeeRewardClaimed + diff.incrementalTotalFeeRewardClaimed
        : current.totalFeeRewardClaimed,
    totalFeeRewardClaimedUSD:
      diff.incrementalTotalFeeRewardClaimedUSD !== undefined
        ? current.totalFeeRewardClaimedUSD +
          diff.incrementalTotalFeeRewardClaimedUSD
        : current.totalFeeRewardClaimedUSD,

    // ALM metrics
    almAmount0:
      diff.almAmount0 !== undefined ? diff.almAmount0 : current.almAmount0,
    almAmount1:
      diff.almAmount1 !== undefined ? diff.almAmount1 : current.almAmount1,
    almLpAmount:
      diff.incrementalAlmLpAmount !== undefined
        ? current.almLpAmount + diff.incrementalAlmLpAmount
        : current.almLpAmount,
    almAddress:
      diff.almAddress !== undefined ? diff.almAddress : current.almAddress,

    lastAlmActivityTimestamp:
      diff.lastAlmActivityTimestamp !== undefined
        ? diff.lastAlmActivityTimestamp
        : current.lastAlmActivityTimestamp,

    lastActivityTimestamp:
      diff.lastActivityTimestamp !== undefined
        ? diff.lastActivityTimestamp
        : current.lastActivityTimestamp,
  };

  context.UserStatsPerPool.set(updated);
  return updated;
}
