import type { handlerContext } from "generated";
import {
  findPoolByGaugeAddress,
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import {
  loadUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import {
  CHAIN_CONSTANTS,
  TokenIdByChain,
  toChecksumAddress,
} from "../../Constants";
import { normalizeTokenAmountTo1e18 } from "../../Helpers";
import { multiplyBase1e18 } from "../../Maths";
import { refreshTokenPrice } from "../../PriceOracle";

export interface GaugeEventData {
  gaugeAddress: string;
  userAddress: string;
  chainId: number;
  blockNumber: number;
  timestamp: number;
}

export interface GaugeDepositData extends GaugeEventData {
  amount: bigint;
}

export interface GaugeWithdrawData extends GaugeEventData {
  amount: bigint;
}

export interface GaugeClaimRewardsData extends GaugeEventData {
  amount: bigint;
}

/**
 * Common logic for processing gauge deposit events
 */
export async function processGaugeDeposit(
  data: GaugeDepositData,
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

  // Load pool data and user data concurrently for better performance
  const [poolData, userData] = await Promise.all([
    loadPoolData(pool.id, data.chainId, context),
    loadUserData(
      userChecksumAddress,
      pool.id,
      data.chainId,
      context,
      new Date(data.timestamp * 1000),
    ),
  ]);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.id} on chain ${data.chainId}`,
    );
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  // Update pool aggregator with gauge deposit
  const poolGaugeDepositDiff = {
    numberOfGaugeDeposits: 1n,
    currentLiquidityStakedUSD: data.amount, // Add to staked amount
    lastUpdatedTimestamp: new Date(data.timestamp * 1000),
  };

  await updateLiquidityPoolAggregator(
    poolGaugeDepositDiff,
    liquidityPoolAggregator,
    new Date(data.timestamp * 1000),
    context,
    data.blockNumber,
  );

  // Update user stats with gauge deposit
  const userGaugeDepositDiff = {
    numberOfGaugeDeposits: 1n,
    currentLiquidityStakedUSD: data.amount, // Add to staked amount
  };

  await updateUserStatsPerPool(
    userGaugeDepositDiff,
    userData,
    new Date(data.timestamp * 1000),
    context,
  );
}

/**
 * Common logic for processing gauge withdrawal events
 */
export async function processGaugeWithdraw(
  data: GaugeWithdrawData,
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

  // Load pool data and user data concurrently for better performance
  const [poolData, userData] = await Promise.all([
    loadPoolData(pool.id, data.chainId, context),
    loadUserData(
      userChecksumAddress,
      pool.id,
      data.chainId,
      context,
      new Date(data.timestamp * 1000),
    ),
  ]);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.id} on chain ${data.chainId}`,
    );
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  // Update pool aggregator with gauge withdrawal
  const poolGaugeWithdrawalDiff = {
    numberOfGaugeWithdrawals: 1n,
    currentLiquidityStakedUSD: -data.amount, // Subtract from staked amount
    lastUpdatedTimestamp: new Date(data.timestamp * 1000),
  };

  await updateLiquidityPoolAggregator(
    poolGaugeWithdrawalDiff,
    liquidityPoolAggregator,
    new Date(data.timestamp * 1000),
    context,
    data.blockNumber,
  );

  // Update user stats with gauge withdrawal
  const userGaugeWithdrawalDiff = {
    numberOfGaugeWithdrawals: 1n,
    currentLiquidityStakedUSD: -data.amount, // Subtract from staked amount
  };

  await updateUserStatsPerPool(
    userGaugeWithdrawalDiff,
    userData,
    new Date(data.timestamp * 1000),
    context,
  );
}

/**
 * Common logic for processing gauge reward claim events
 */
export async function processGaugeClaimRewards(
  data: GaugeClaimRewardsData,
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

  // Get reward token address
  const rewardTokenAddress = CHAIN_CONSTANTS[data.chainId].rewardToken(
    data.blockNumber,
  );

  // Load pool data, user data, and reward token concurrently
  const [poolData, userData, rewardToken] = await Promise.all([
    loadPoolData(pool.id, data.chainId, context),
    loadUserData(
      userChecksumAddress,
      pool.id,
      data.chainId,
      context,
      new Date(data.timestamp * 1000),
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

  // Refresh reward token price (refreshTokenPrice handles the update internally)
  const updatedRewardToken = await refreshTokenPrice(
    rewardToken,
    data.blockNumber,
    data.timestamp,
    data.chainId,
    context,
  );

  // Convert reward amount to USD
  const normalizedRewardAmount = normalizeTokenAmountTo1e18(
    data.amount,
    Number(updatedRewardToken.decimals),
  );
  const rewardAmountUSD = multiplyBase1e18(
    normalizedRewardAmount,
    updatedRewardToken.pricePerUSDNew,
  );

  // Update pool aggregator with gauge reward claim
  const poolGaugeRewardClaimDiff = {
    numberOfGaugeRewardClaims: 1n,
    totalGaugeRewardsClaimedUSD: rewardAmountUSD,
    totalGaugeRewardsClaimed: data.amount, // in token units
    lastUpdatedTimestamp: new Date(data.timestamp * 1000),
  };

  await updateLiquidityPoolAggregator(
    poolGaugeRewardClaimDiff,
    liquidityPoolAggregator,
    new Date(data.timestamp * 1000),
    context,
    data.blockNumber,
  );

  // Update user stats with gauge reward claim
  const userGaugeRewardClaimDiff = {
    numberOfGaugeRewardClaims: 1n,
    totalGaugeRewardsClaimedUSD: rewardAmountUSD,
    totalGaugeRewardsClaimed: data.amount, // in token units
  };

  await updateUserStatsPerPool(
    userGaugeRewardClaimDiff,
    userData,
    new Date(data.timestamp * 1000),
    context,
  );
}
