import type { handlerContext } from "generated";
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
 * Common logic for processing gauge deposit events
 */
export async function processGaugeDeposit(
  data: GaugeEventData,
  context: handlerContext,
  handlerName: string,
): Promise<void> {
  // Find the pool by gauge address
  const pool = await findPoolByGaugeAddress(
    data.gaugeAddress,
    data.chainId,
    context,
  );
  if (!pool) {
    context.log.error(
      `${handlerName}: Pool not found for gauge address ${data.gaugeAddress} on chain ${data.chainId}`,
    );
    return;
  }

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
    updateUserStatsPerPool(userDiff, userData, context),
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
  // Find the pool by gauge address
  const pool = await findPoolByGaugeAddress(
    data.gaugeAddress,
    data.chainId,
    context,
  );
  if (!pool) {
    context.log.error(
      `${handlerName}: Pool not found for gauge address ${data.gaugeAddress} on chain ${data.chainId}`,
    );
    return;
  }

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
    updateUserStatsPerPool(userDiff, userData, context),
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
  // Find the pool by gauge address
  const pool = await findPoolByGaugeAddress(
    data.gaugeAddress,
    data.chainId,
    context,
  );
  if (!pool) {
    context.log.error(
      `${handlerName}: Pool not found for gauge address ${data.gaugeAddress} on chain ${data.chainId}`,
    );
    return;
  }

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
    updateUserStatsPerPool(userDiff, userData, context),
  ]);
}
