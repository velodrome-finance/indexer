import type { LiquidityPoolAggregator, handlerContext } from "generated";
import {
  findPoolByGaugeAddress,
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import { CHAIN_CONSTANTS, TokenId } from "../../Constants";
import { calculateStakedLiquidityUSD, calculateTotalUSD } from "../../Helpers";

export interface GaugeEventData {
  gaugeAddress: string;
  userAddress: string;
  chainId: number;
  blockNumber: number;
  timestamp: number;
  amount: bigint;
  tokenId?: bigint; // Optional - for CL pools to look up position tick ranges
}

/**
 * Returns true if the gauge address is registered as a root gauge (RootGauge/RootCLGauge on the root chain).
 * Used to skip Deposit/Withdraw/ClaimRewards for root gauges, which have no associated pool entity.
 * @param gaugeAddress - The address of the gauge
 * @param context - The handler context
 * @returns True if the gauge address is registered as a root gauge, false otherwise
 */
export async function isRootGauge(
  gaugeAddress: string,
  context: handlerContext,
): Promise<boolean> {
  const mappings = await context.RootGauge_RootPool.getWhere({
    rootGaugeAddress: { _eq: gaugeAddress },
  });
  return mappings.length > 0;
}

/**
 * Looks up pool by gauge address; returns null silently for root gauges, logs and returns null otherwise when not found.
 * @param gaugeAddress - The gauge address
 * @param chainId - The chain ID
 * @param context - The handler context
 * @param handlerName - Handler name for error logging
 * @returns { pool } if pool found, null if not found (root gauge = silent, else log error)
 */
export async function findPoolOrSkipRootGauge(
  gaugeAddress: string,
  chainId: number,
  context: handlerContext,
  handlerName: string,
): Promise<{ pool: LiquidityPoolAggregator } | null> {
  const pool = await findPoolByGaugeAddress(gaugeAddress, chainId, context);
  if (pool) {
    return { pool };
  }
  if (await isRootGauge(gaugeAddress, context)) {
    return null;
  }
  context.log.error(
    `${handlerName}: Pool not found for gauge address ${gaugeAddress} on chain ${chainId}`,
  );
  return null;
}

/**
 * Common logic for processing gauge deposit events
 */
export async function processGaugeDeposit(
  data: GaugeEventData,
  context: handlerContext,
  handlerName: string,
): Promise<void> {
  const result = await findPoolOrSkipRootGauge(
    data.gaugeAddress,
    data.chainId,
    context,
    handlerName,
  );
  if (!result) return;
  const { pool } = result;

  const timestamp = new Date(data.timestamp * 1000);

  // Load pool data and user data concurrently
  const [poolData, userData] = await Promise.all([
    loadPoolData(pool.poolAddress, data.chainId, context),
    loadOrCreateUserData(
      data.userAddress,
      pool.poolAddress,
      data.chainId,
      context,
      timestamp,
    ),
  ]);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.poolAddress} on chain ${data.chainId}`,
    );
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  // Calculate USD value of staked liquidity
  const currentLiquidityStakedUSD = await calculateStakedLiquidityUSD(
    data.amount,
    pool.poolAddress,
    data.chainId,
    data.blockNumber,
    data.tokenId,
    poolData,
    context,
  );

  // Update pool aggregator with gauge deposit
  const poolDiff = {
    incrementalNumberOfGaugeDeposits: 1n,
    incrementalCurrentLiquidityStaked: data.amount, // Add to staked amount
    incrementalCurrentLiquidityStakedUSD: currentLiquidityStakedUSD,
    lastUpdatedTimestamp: timestamp,
  };

  // Update user stats with gauge deposit
  const userDiff = {
    incrementalNumberOfGaugeDeposits: 1n,
    incrementalCurrentLiquidityStaked: data.amount, // Add to staked amount
    incrementalCurrentLiquidityStakedUSD: currentLiquidityStakedUSD,
    lastActivityTimestamp: timestamp,
  };

  // Update pool and user entities in parallel
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      data.chainId,
      data.blockNumber,
    ),
    updateUserStatsPerPool(userDiff, userData, context, timestamp),
  ]);
}

/**
 * Common logic for processing gauge withdrawal events
 */
export async function processGaugeWithdraw(
  data: GaugeEventData,
  context: handlerContext,
  handlerName: string,
): Promise<void> {
  const result = await findPoolOrSkipRootGauge(
    data.gaugeAddress,
    data.chainId,
    context,
    handlerName,
  );
  if (!result) return;
  const { pool } = result;

  const timestamp = new Date(data.timestamp * 1000);

  // Load pool data and user data concurrently
  const [poolData, userData] = await Promise.all([
    loadPoolData(pool.poolAddress, data.chainId, context),
    loadOrCreateUserData(
      data.userAddress,
      pool.poolAddress,
      data.chainId,
      context,
      timestamp,
    ),
  ]);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.poolAddress} on chain ${data.chainId}`,
    );
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  // Calculate USD value of withdrawn liquidity (negative amount)
  const currentLiquidityStakedUSD = await calculateStakedLiquidityUSD(
    data.amount,
    pool.poolAddress,
    data.chainId,
    data.blockNumber,
    data.tokenId,
    poolData,
    context,
  );

  // Update pool aggregator with gauge withdrawal
  const poolDiff = {
    incrementalNumberOfGaugeWithdrawals: 1n,
    incrementalCurrentLiquidityStaked: -data.amount, // Subtract from staked amount
    incrementalCurrentLiquidityStakedUSD: -currentLiquidityStakedUSD,
    lastUpdatedTimestamp: timestamp,
  };

  // Update user stats with gauge withdrawal
  const userDiff = {
    incrementalNumberOfGaugeWithdrawals: 1n,
    incrementalCurrentLiquidityStaked: -data.amount, // Subtract from staked amount
    incrementalCurrentLiquidityStakedUSD: -currentLiquidityStakedUSD,
    lastActivityTimestamp: timestamp,
  };

  // Update pool and user entities in parallel
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      data.chainId,
      data.blockNumber,
    ),
    updateUserStatsPerPool(userDiff, userData, context, timestamp),
  ]);
}

/**
 * Common logic for processing gauge reward claim events
 */
export async function processGaugeClaimRewards(
  data: GaugeEventData,
  context: handlerContext,
  handlerName: string,
): Promise<void> {
  const result = await findPoolOrSkipRootGauge(
    data.gaugeAddress,
    data.chainId,
    context,
    handlerName,
  );
  if (!result) return;
  const { pool } = result;

  const timestamp = new Date(data.timestamp * 1000);

  // Get reward token address
  const rewardTokenAddress = CHAIN_CONSTANTS[data.chainId].rewardToken(
    data.blockNumber,
  );

  // Load pool data, user data, and reward token concurrently
  const [poolData, userData, rewardToken] = await Promise.all([
    loadPoolData(
      pool.poolAddress,
      data.chainId,
      context,
      data.blockNumber,
      data.timestamp,
    ),
    loadOrCreateUserData(
      data.userAddress,
      pool.poolAddress,
      data.chainId,
      context,
      timestamp,
    ),
    context.Token.get(TokenId(data.chainId, rewardTokenAddress)),
  ]);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.poolAddress} on chain ${data.chainId}`,
    );
    return;
  }

  if (!rewardToken) {
    context.log.error(
      `${handlerName}: Reward token not found for ${rewardTokenAddress} on chain ${data.chainId}`,
    );
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  const rewardAmountUSD = calculateTotalUSD(
    data.amount,
    0n,
    rewardToken,
    undefined,
  );

  // Update pool aggregator with gauge reward claim
  const poolDiff = {
    incrementalNumberOfGaugeRewardClaims: 1n,
    incrementalTotalGaugeRewardsClaimedUSD: rewardAmountUSD,
    incrementalTotalGaugeRewardsClaimed: data.amount, // in token units
    lastUpdatedTimestamp: timestamp,
  };

  // Update user stats with gauge reward claim
  const userDiff = {
    incrementalNumberOfGaugeRewardClaims: 1n,
    incrementalTotalGaugeRewardsClaimedUSD: rewardAmountUSD,
    incrementalTotalGaugeRewardsClaimed: data.amount, // in token units
    lastActivityTimestamp: timestamp,
  };

  // Update pool and user entities in parallel
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      data.chainId,
      data.blockNumber,
    ),
    updateUserStatsPerPool(userDiff, userData, context, timestamp),
  ]);
}
