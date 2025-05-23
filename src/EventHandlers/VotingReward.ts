import {
  VotingReward,
  type VotingReward_ClaimRewards,
  type VotingReward_Deposit,
  type VotingReward_NotifyReward,
  type VotingReward_Withdraw,
} from "generated";

import { updateLiquidityPoolAggregator } from "../Aggregators/LiquidityPoolAggregator";
import { TokenIdByChain } from "../Constants";
import { type TokenPriceData, getTokenPriceData } from "../PriceOracle";
import { normalizeTokenAmountTo1e18 } from "./../Helpers";
import { multiplyBase1e18 } from "./../Maths";
import { poolLookupStoreManager } from "./../Store";
import { LiquidityPoolAggregator, Token } from "./../src/Types.gen";

//// global state!
const { getPoolAddressByBribeVotingRewardAddress } = poolLookupStoreManager();

VotingReward.NotifyReward.handlerWithLoader({
  loader: async ({ event, context }) => {
    const poolAddress = getPoolAddressByBribeVotingRewardAddress(
      event.chainId,
      event.srcAddress,
    );

    const promisePool = poolAddress
      ? context.LiquidityPoolAggregator.get(poolAddress)
      : null;

    if (!poolAddress) {
      context.log.warn(
        `No pool address found for the bribe voting address ${event.srcAddress.toString()} on chain ${event.chainId}`,
      );
    }

    const [currentLiquidityPool, storedToken] = await Promise.all([
      promisePool,
      context.Token.get(TokenIdByChain(event.params.reward, event.chainId)),
    ]);

    return { currentLiquidityPool, storedToken };
  },
  handler: async ({ event, context, loaderReturn }) => {
    const entity: VotingReward_NotifyReward = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      from: event.params.from,
      reward: event.params.reward,
      epoch: event.params.epoch,
      pool: loaderReturn?.currentLiquidityPool?.id ?? "",
      amount: event.params.amount,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      sourceAddress: event.srcAddress,
      chainId: event.chainId,
      transactionHash: event.transaction.hash,
    };

    context.VotingReward_NotifyReward.set(entity);

    if (loaderReturn) {
      const { currentLiquidityPool, storedToken } = loaderReturn;

      let rewardToken: TokenPriceData | null = null;

      if (!storedToken) {
        try {
          rewardToken = await getTokenPriceData(
            event.params.reward,
            event.block.number,
            event.chainId,
          );
        } catch (error) {
          context.log.error(
            `Error in voting reward notify reward event fetching token details for ${event.params.reward} on chain ${event.chainId}: ${error}`,
          );
        }
      } else {
        rewardToken = {
          pricePerUSDNew: storedToken.pricePerUSDNew,
          decimals: storedToken.decimals,
        };
      }

      if (currentLiquidityPool && rewardToken) {
        const normalizedBribesAmount = normalizeTokenAmountTo1e18(
          event.params.amount,
          Number(rewardToken.decimals),
        );

        // If the reward token does not have a price in USD, log
        if (rewardToken.pricePerUSDNew === 0n) {
          context.log.warn(
            `Reward token with ID ${event.params.reward.toString()} does not have a USD price yet on chain ${event.chainId}`,
          );
        }

        // Calculate the bribes amount in USD
        const normalizedBribesAmountUsd = multiplyBase1e18(
          normalizedBribesAmount,
          rewardToken.pricePerUSDNew,
        );

        // Create a new instance of LiquidityPoolEntity to be updated in the DB
        const lpDiff = {
          totalBribesUSD:
            currentLiquidityPool.totalBribesUSD + normalizedBribesAmountUsd,
          lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
        };

        // Update the LiquidityPoolEntity in the DB
        updateLiquidityPoolAggregator(
          lpDiff,
          currentLiquidityPool,
          new Date(event.block.timestamp * 1000),
          context,
          event.block.number,
        );
      }
    }
  },
});

VotingReward.Deposit.handler(async ({ event, context }) => {
  const entity: VotingReward_Deposit = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    from: event.params.from,
    tokenId: event.params.tokenId,
    amount: event.params.amount,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    sourceAddress: event.srcAddress,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
  };

  context.VotingReward_Deposit.set(entity);
});

VotingReward.ClaimRewards.handler(async ({ event, context }) => {
  const entity: VotingReward_ClaimRewards = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    from: event.params.from,
    reward: event.params.reward,
    amount: event.params.amount,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    sourceAddress: event.srcAddress,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
  };

  context.VotingReward_ClaimRewards.set(entity);
});

VotingReward.Withdraw.handler(async ({ event, context }) => {
  const entity: VotingReward_Withdraw = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    from: event.params.from,
    tokenId: event.params.tokenId,
    amount: event.params.amount,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    sourceAddress: event.srcAddress,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
  };

  context.VotingReward_Withdraw.set(entity);
});
