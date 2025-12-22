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
import {
  CHAIN_CONSTANTS,
  TokenIdByChain,
  toChecksumAddress,
} from "../../Constants";
import {
  calculateStakedLiquidityUSD,
  calculateTotalLiquidityUSD,
} from "../../Helpers";

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
  const gaugeChecksumAddress = toChecksumAddress(data.gaugeAddress);
  const userChecksumAddress = toChecksumAddress(data.userAddress);

  // Find the pool by gauge address
  const pool = await findPoolByGaugeAddress(
    gaugeChecksumAddress,
    data.chainId,
    context,
  );
  if (!pool) {
    context.log.error(
      `${handlerName}: Pool not found for gauge address ${gaugeChecksumAddress} on chain ${data.chainId}`,
    );
    return;
  }

  const timestamp = new Date(data.timestamp * 1000);

  // Load pool data and user data concurrently
  const [poolData, userData] = await Promise.all([
    loadPoolData(pool.id, data.chainId, context),
    loadOrCreateUserData(
      userChecksumAddress,
      pool.id,
      data.chainId,
      context,
      timestamp,
    ),
  ]);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.id} on chain ${data.chainId}`,
    );
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  // Calculate USD value of staked liquidity
  const currentLiquidityStakedUSD = await calculateStakedLiquidityUSD(
    data.amount,
    pool.id,
    data.chainId,
    data.blockNumber,
    data.tokenId,
    poolData,
    context,
  );

  // Update pool aggregator with gauge deposit
  const poolDiff = {
    numberOfGaugeDeposits: 1n,
    currentLiquidityStaked: data.amount, // Add to staked amount
    currentLiquidityStakedUSD,
    lastUpdatedTimestamp: timestamp,
  };

  // Update user stats with gauge deposit
  const userDiff = {
    numberOfGaugeDeposits: 1n,
    currentLiquidityStaked: data.amount, // Add to staked amount
    currentLiquidityStakedUSD,
    lastActivityTimestamp: timestamp,
  };

  // Update pool and user entities in parallel
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
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
  const gaugeChecksumAddress = toChecksumAddress(data.gaugeAddress);
  const userChecksumAddress = toChecksumAddress(data.userAddress);

  // Find the pool by gauge address
  const pool = await findPoolByGaugeAddress(
    gaugeChecksumAddress,
    data.chainId,
    context,
  );
  if (!pool) {
    context.log.error(
      `${handlerName}: Pool not found for gauge address ${gaugeChecksumAddress} on chain ${data.chainId}`,
    );
    return;
  }

  const timestamp = new Date(data.timestamp * 1000);

  // Load pool data and user data concurrently
  const [poolData, userData] = await Promise.all([
    loadPoolData(pool.id, data.chainId, context),
    loadOrCreateUserData(
      userChecksumAddress,
      pool.id,
      data.chainId,
      context,
      timestamp,
    ),
  ]);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.id} on chain ${data.chainId}`,
    );
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  // Calculate USD value of withdrawn liquidity (negative amount)
  const currentLiquidityStakedUSD = await calculateStakedLiquidityUSD(
    data.amount,
    pool.id,
    data.chainId,
    data.blockNumber,
    data.tokenId,
    poolData,
    context,
  );

  // Update pool aggregator with gauge withdrawal
  const poolDiff = {
    numberOfGaugeWithdrawals: 1n,
    currentLiquidityStaked: -data.amount, // Subtract from staked amount
    currentLiquidityStakedUSD: -currentLiquidityStakedUSD,
    lastUpdatedTimestamp: timestamp,
  };

  // Update user stats with gauge withdrawal
  const userDiff = {
    numberOfGaugeWithdrawals: 1n,
    currentLiquidityStaked: -data.amount, // Subtract from staked amount
    currentLiquidityStakedUSD: -currentLiquidityStakedUSD,
    lastActivityTimestamp: timestamp,
  };

  // Update pool and user entities in parallel
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
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
  const gaugeChecksumAddress = toChecksumAddress(data.gaugeAddress);
  const userChecksumAddress = toChecksumAddress(data.userAddress);

  // Find the pool by gauge address
  const pool = await findPoolByGaugeAddress(
    gaugeChecksumAddress,
    data.chainId,
    context,
  );
  if (!pool) {
    context.log.error(
      `${handlerName}: Pool not found for gauge address ${gaugeChecksumAddress} on chain ${data.chainId}`,
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
      pool.id,
      data.chainId,
      context,
      data.blockNumber,
      data.timestamp,
    ),
    loadOrCreateUserData(
      userChecksumAddress,
      pool.id,
      data.chainId,
      context,
      timestamp,
    ),
    context.Token.get(TokenIdByChain(rewardTokenAddress, data.chainId)),
  ]);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.id} on chain ${data.chainId}`,
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

  const rewardAmountUSD = calculateTotalLiquidityUSD(
    data.amount,
    0n,
    rewardToken,
    undefined,
  );

  // Update pool aggregator with gauge reward claim
  const poolDiff = {
    numberOfGaugeRewardClaims: 1n,
    totalGaugeRewardsClaimedUSD: rewardAmountUSD,
    totalGaugeRewardsClaimed: data.amount, // in token units
    lastUpdatedTimestamp: timestamp,
  };

  // Update user stats with gauge reward claim
  const userDiff = {
    numberOfGaugeRewardClaims: 1n,
    totalGaugeRewardsClaimedUSD: rewardAmountUSD,
    totalGaugeRewardsClaimed: data.amount, // in token units
    lastActivityTimestamp: timestamp,
  };

  // Update pool and user entities in parallel
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      data.blockNumber,
    ),
    updateUserStatsPerPool(userDiff, userData, context),
  ]);
}
