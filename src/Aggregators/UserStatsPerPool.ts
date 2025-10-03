import type { UserStatsPerPool, handlerContext } from "generated";

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
  const id = `${userAddress.toLowerCase()}_${poolAddress.toLowerCase()}_${chainId}`;

  // Get existing stats or create new one
  let existingStats = await context.UserStatsPerPool.get(id);

  if (!existingStats) {
    existingStats = createUserStatsPerPoolEntity(
      userAddress,
      poolAddress,
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
    id: `${userAddress.toLowerCase()}_${poolAddress.toLowerCase()}_${chainId}`,
    userAddress: userAddress.toLowerCase(),
    poolAddress: poolAddress.toLowerCase(),
    chainId,

    // Liquidity metrics
    currentLiquidityUSD: 0n,
    totalLiquidityAddedUSD: 0n,
    totalLiquidityRemovedUSD: 0n,

    // Fee metrics
    totalFeesContributedUSD: 0n,
    totalFeesContributed0: 0n,
    totalFeesContributed1: 0n,

    // Swap metrics
    numberOfSwaps: 0n,
    totalSwapVolumeUSD: 0n,

    // Timestamps
    firstActivityTimestamp: timestamp,
    lastActivityTimestamp: timestamp,
  };
}

/**
 * Updates UserPoolStats with liquidity activity
 */
export async function updateUserPoolLiquidityActivity(
  userData: UserStatsPerPool,
  netLiquidityAddedUSD: bigint, // Positive for added, negative for removed
  timestamp: Date,
  context: handlerContext,
): Promise<UserStatsPerPool> {
  // Calculate new liquidity values
  const isAddingLiquidity = netLiquidityAddedUSD > 0n;
  const liquidityAmount = isAddingLiquidity
    ? netLiquidityAddedUSD
    : -netLiquidityAddedUSD;

  // Update stats with liquidity activity
  const updatedStats: UserStatsPerPool = {
    ...userData,
    currentLiquidityUSD: userData.currentLiquidityUSD + netLiquidityAddedUSD,
    totalLiquidityAddedUSD: isAddingLiquidity
      ? userData.totalLiquidityAddedUSD + liquidityAmount
      : userData.totalLiquidityAddedUSD,
    totalLiquidityRemovedUSD: !isAddingLiquidity
      ? userData.totalLiquidityRemovedUSD + liquidityAmount
      : userData.totalLiquidityRemovedUSD,
    lastActivityTimestamp: timestamp,
  };

  context.UserStatsPerPool.set(updatedStats);
  return updatedStats;
}

/**
 * Updates UserStatsPerPool with fee contribution
 */
export async function updateUserPoolFeeContribution(
  userData: UserStatsPerPool,
  feesContributedUSD: bigint,
  feesContributed0: bigint,
  feesContributed1: bigint,
  timestamp: Date,
  context: handlerContext,
): Promise<UserStatsPerPool> {
  // Update stats with fee contribution
  const updatedStats: UserStatsPerPool = {
    ...userData,
    totalFeesContributedUSD:
      userData.totalFeesContributedUSD + feesContributedUSD,
    totalFeesContributed0: userData.totalFeesContributed0 + feesContributed0,
    totalFeesContributed1: userData.totalFeesContributed1 + feesContributed1,
    lastActivityTimestamp: timestamp,
  };

  context.UserStatsPerPool.set(updatedStats);
  return updatedStats;
}

/**
 * Updates UserStatsPerPool with swap activity
 */
export async function updateUserPoolSwapActivity(
  userData: UserStatsPerPool,
  swapVolumeUSD: bigint,
  timestamp: Date,
  context: handlerContext,
): Promise<UserStatsPerPool> {
  // Update stats with swap activity
  const updatedStats: UserStatsPerPool = {
    ...userData,
    numberOfSwaps: userData.numberOfSwaps + 1n,
    totalSwapVolumeUSD: userData.totalSwapVolumeUSD + swapVolumeUSD,
    lastActivityTimestamp: timestamp,
  };

  context.UserStatsPerPool.set(updatedStats);
  return updatedStats;
}
