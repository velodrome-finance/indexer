import { CLGauge } from "generated";
import {
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../Aggregators/LiquidityPoolAggregator";
import {
  loadUserData,
  updateUserStatsPerPool,
} from "../Aggregators/UserStatsPerPool";

CLGauge.Deposit.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    event.params.user,
    event.srcAddress,
    event.chainId,
    context,
    new Date(event.block.timestamp * 1000),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  // Update pool aggregator with gauge deposit
  const poolGaugeDepositDiff = {
    numberOfGaugeDeposits: 1n,
    currentLiquidityStakedUSD: event.params.liquidityToStake, // Add to staked amount
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  updateLiquidityPoolAggregator(
    poolGaugeDepositDiff,
    liquidityPoolAggregator,
    new Date(event.block.timestamp * 1000),
    context,
    event.block.number,
  );

  // Update user stats with gauge deposit
  const userGaugeDepositDiff = {
    numberOfGaugeDeposits: 1n,
    currentLiquidityStakedUSD: event.params.liquidityToStake, // Add to staked amount
  };

  await updateUserStatsPerPool(
    userGaugeDepositDiff,
    userData,
    new Date(event.block.timestamp * 1000),
    context,
  );
});

CLGauge.Withdraw.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    event.params.user,
    event.srcAddress,
    event.chainId,
    context,
    new Date(event.block.timestamp * 1000),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  // Update pool aggregator with gauge withdrawal
  const poolGaugeWithdrawalDiff = {
    numberOfGaugeWithdrawals: 1n,
    currentLiquidityStakedUSD: -event.params.liquidityToStake, // Subtract from staked amount
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  updateLiquidityPoolAggregator(
    poolGaugeWithdrawalDiff,
    liquidityPoolAggregator,
    new Date(event.block.timestamp * 1000),
    context,
    event.block.number,
  );

  // Update user stats with gauge withdrawal
  const userGaugeWithdrawalDiff = {
    numberOfGaugeWithdrawals: 1n,
    currentLiquidityStakedUSD: -event.params.liquidityToStake, // Subtract from staked amount
  };

  await updateUserStatsPerPool(
    userGaugeWithdrawalDiff,
    userData,
    new Date(event.block.timestamp * 1000),
    context,
  );
});

CLGauge.ClaimRewards.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    event.params.from,
    event.srcAddress,
    event.chainId,
    context,
    new Date(event.block.timestamp * 1000),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  // Update pool aggregator with gauge reward claim
  const poolGaugeRewardClaimDiff = {
    numberOfGaugeRewardClaims: 1n,
    totalGaugeRewardsClaimedUSD: event.params.amount, // Assuming this is already in USD or we need to convert
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  updateLiquidityPoolAggregator(
    poolGaugeRewardClaimDiff,
    liquidityPoolAggregator,
    new Date(event.block.timestamp * 1000),
    context,
    event.block.number,
  );

  // Update user stats with gauge reward claim
  const userGaugeRewardClaimDiff = {
    numberOfGaugeRewardClaims: 1n,
    totalGaugeRewardsClaimedUSD: event.params.amount, // Assuming this is already in USD or we need to convert
  };

  await updateUserStatsPerPool(
    userGaugeRewardClaimDiff,
    userData,
    new Date(event.block.timestamp * 1000),
    context,
  );
});
