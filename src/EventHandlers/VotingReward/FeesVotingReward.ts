import { FeesVotingReward } from "generated";
import {
  PoolAddressField,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import { updateUserStatsPerPool } from "../../Aggregators/UserStatsPerPool";
import {
  loadVotingRewardData,
  processVotingRewardClaimRewards,
  processVotingRewardDeposit,
  processVotingRewardWithdraw,
} from "./VotingRewardSharedLogic";

FeesVotingReward.Deposit.handler(async ({ event, context }) => {
  const data = {
    votingRewardAddress: event.srcAddress,
    userAddress: event.params.from,
    chainId: event.chainId,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    tokenId: event.params.tokenId,
    amount: event.params.amount,
  };

  const loadedData = await loadVotingRewardData(
    data,
    context,
    "FeesVotingReward.Deposit",
    PoolAddressField.FEE_VOTING_REWARD_ADDRESS,
  );

  if (!loadedData?.poolData?.liquidityPoolAggregator || !loadedData?.userData) {
    return;
  }

  if (context.isPreload) {
    return;
  }

  const result = await processVotingRewardDeposit(data);

  if (result.poolDiff) {
    updateLiquidityPoolAggregator(
      result.poolDiff,
      loadedData.poolData.liquidityPoolAggregator,
      new Date(data.timestamp * 1000),
      context,
      data.blockNumber,
    );
  }

  if (result.userDiff) {
    await updateUserStatsPerPool(
      result.userDiff,
      loadedData.userData,
      new Date(data.timestamp * 1000),
      context,
    );
  }
});

FeesVotingReward.ClaimRewards.handler(async ({ event, context }) => {
  const data = {
    votingRewardAddress: event.srcAddress,
    userAddress: event.params.from,
    chainId: event.chainId,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    reward: event.params.reward,
    amount: event.params.amount,
  };

  const loadedData = await loadVotingRewardData(
    data,
    context,
    "FeesVotingReward.ClaimRewards",
    PoolAddressField.FEE_VOTING_REWARD_ADDRESS,
  );

  if (!loadedData?.poolData?.liquidityPoolAggregator || !loadedData?.userData) {
    return;
  }

  if (context.isPreload) {
    return;
  }

  const result = await processVotingRewardClaimRewards(
    data,
    context,
    PoolAddressField.FEE_VOTING_REWARD_ADDRESS,
  );

  if (result.poolDiff) {
    updateLiquidityPoolAggregator(
      result.poolDiff,
      loadedData.poolData.liquidityPoolAggregator,
      new Date(data.timestamp * 1000),
      context,
      data.blockNumber,
    );
  }

  if (result.userDiff) {
    await updateUserStatsPerPool(
      result.userDiff,
      loadedData.userData,
      new Date(data.timestamp * 1000),
      context,
    );
  }
});

FeesVotingReward.Withdraw.handler(async ({ event, context }) => {
  const data = {
    votingRewardAddress: event.srcAddress,
    userAddress: event.params.from,
    chainId: event.chainId,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    tokenId: event.params.tokenId,
    amount: event.params.amount,
  };

  const loadedData = await loadVotingRewardData(
    data,
    context,
    "FeesVotingReward.Withdraw",
    PoolAddressField.FEE_VOTING_REWARD_ADDRESS,
  );

  if (!loadedData?.poolData?.liquidityPoolAggregator || !loadedData?.userData) {
    return;
  }

  if (context.isPreload) {
    return;
  }

  const result = await processVotingRewardWithdraw(data);

  if (result.poolDiff) {
    updateLiquidityPoolAggregator(
      result.poolDiff,
      loadedData.poolData.liquidityPoolAggregator,
      new Date(data.timestamp * 1000),
      context,
      data.blockNumber,
    );
  }

  if (result.userDiff) {
    await updateUserStatsPerPool(
      result.userDiff,
      loadedData.userData,
      new Date(data.timestamp * 1000),
      context,
    );
  }
});
