import { SuperchainIncentiveVotingReward } from "generated";
import {
  PoolAddressField,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import { updateUserStatsPerPool } from "../../Aggregators/UserStatsPerPool";
import {
  loadVotingRewardData,
  processVotingRewardClaimRewards,
} from "./VotingRewardSharedLogic";

SuperchainIncentiveVotingReward.ClaimRewards.handler(
  async ({ event, context }) => {
    const data = {
      votingRewardAddress: event.srcAddress,
      userAddress: event.params._sender,
      chainId: event.chainId,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      reward: event.params._reward,
      amount: event.params._amount,
    };

    const loadedData = await loadVotingRewardData(
      data,
      context,
      "BribesVotingReward.ClaimRewards",
      PoolAddressField.BRIBE_VOTING_REWARD_ADDRESS,
    );

    if (
      !loadedData?.poolData?.liquidityPoolAggregator ||
      !loadedData?.userData
    ) {
      return;
    }

    const result = await processVotingRewardClaimRewards(
      data,
      context,
      PoolAddressField.BRIBE_VOTING_REWARD_ADDRESS,
    );

    await Promise.all([
      result.poolDiff
        ? updateLiquidityPoolAggregator(
            result.poolDiff,
            loadedData.poolData.liquidityPoolAggregator,
            new Date(data.timestamp * 1000),
            context,
            data.blockNumber,
          )
        : Promise.resolve(),
      result.userDiff
        ? updateUserStatsPerPool(result.userDiff, loadedData.userData, context)
        : Promise.resolve(),
    ]);
  },
);
