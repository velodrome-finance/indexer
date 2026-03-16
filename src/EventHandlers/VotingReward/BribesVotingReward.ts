import { BribesVotingReward } from "generated";
import {
  PoolAddressField,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import {
  loadVotingRewardData,
  processVotingRewardClaimRewards,
} from "./VotingRewardSharedLogic";

BribesVotingReward.ClaimRewards.handler(async ({ event, context }) => {
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
    "BribesVotingReward.ClaimRewards",
    PoolAddressField.BRIBE_VOTING_REWARD_ADDRESS,
  );

  if (!loadedData?.poolData?.liquidityPoolAggregator) {
    return;
  }

  const result = await processVotingRewardClaimRewards(
    data,
    context,
    PoolAddressField.BRIBE_VOTING_REWARD_ADDRESS,
  );

  if (result.poolDiff) {
    await updateLiquidityPoolAggregator(
      result.poolDiff,
      loadedData.poolData.liquidityPoolAggregator,
      new Date(data.timestamp * 1000),
      context,
      event.chainId,
      data.blockNumber,
    );
  }
});
