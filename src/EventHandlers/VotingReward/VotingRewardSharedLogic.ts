import type {
  LiquidityPoolAggregator,
  UserStatsPerPool,
  handlerContext,
} from "generated";
import {
  type LiquidityPoolAggregatorDiff,
  PoolAddressField,
  findPoolByField,
  loadPoolData,
} from "../../Aggregators/LiquidityPoolAggregator";
import {
  type UserStatsPerPoolDiff,
  loadOrCreateUserData,
} from "../../Aggregators/UserStatsPerPool";
import { TokenId } from "../../Constants";
import {
  getTokenDetails,
  getTokenPrice,
  roundBlockToInterval,
} from "../../Effects/Token";
import { calculateTokenAmountUSD } from "../../Helpers";
import { refreshTokenPrice } from "../../PriceOracle";

export interface VotingRewardEventData {
  votingRewardAddress: string;
  userAddress: string;
  chainId: number;
  blockNumber: number;
  timestamp: number;
}

export interface VotingRewardClaimRewardsData extends VotingRewardEventData {
  reward: string;
  amount: bigint;
}

export interface VotingRewardClaimRewardsResult {
  poolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userDiff: Partial<UserStatsPerPoolDiff>;
}

/**
 * Business logic for processing voting reward claim events
 * Returns data structures for database updates - does not perform DB operations
 */
export async function processVotingRewardClaimRewards(
  data: VotingRewardClaimRewardsData,
  context: handlerContext,
  field: PoolAddressField,
): Promise<VotingRewardClaimRewardsResult> {
  // Get reward token and refresh price (refreshTokenPrice handles the update internally)
  const rewardTokenId = TokenId(data.chainId, data.reward);
  let rewardToken = await context.Token.get(rewardTokenId);

  if (!rewardToken) {
    context.log.warn(
      `[processVotingRewardClaimRewards] Reward token not found for ${data.reward} on chain ${data.chainId}`,
    );

    context.log.warn(
      "[processVotingRewardClaimRewards] Using separate effects to get token data and then creating Token entity",
    );

    // Round block number to nearest hour interval for better cache hits
    // Cache key is based on input parameters, so rounding must happen before effect call
    const roundedBlockNumber = roundBlockToInterval(
      data.blockNumber,
      data.chainId,
    );

    // Fetch token details and price in parallel
    const [rewardTokenDetails, priceData] = await Promise.all([
      context.effect(getTokenDetails, {
        contractAddress: data.reward,
        chainId: data.chainId,
      }),
      context.effect(getTokenPrice, {
        tokenAddress: data.reward,
        chainId: data.chainId,
        blockNumber: roundedBlockNumber, // Use rounded block for cache key
      }),
    ]);

    const newToken = {
      id: TokenId(data.chainId, data.reward),
      address: data.reward,
      name: rewardTokenDetails.name,
      symbol: rewardTokenDetails.symbol,
      chainId: data.chainId,
      decimals: BigInt(rewardTokenDetails.decimals),
      pricePerUSDNew: priceData.pricePerUSDNew,
      lastUpdatedTimestamp: new Date(data.timestamp * 1000),
      isWhitelisted: true,
    };

    context.Token.set(newToken);
    rewardToken = newToken;
  }

  const updatedRewardToken = await refreshTokenPrice(
    rewardToken,
    data.blockNumber,
    data.timestamp,
    data.chainId,
    context,
  );

  // Convert reward amount to USD
  const rewardAmountUSD = calculateTokenAmountUSD(
    data.amount,
    Number(updatedRewardToken.decimals),
    updatedRewardToken.pricePerUSDNew,
  );

  // Determine if this is a bribe or fee reward
  const isBribe = field === PoolAddressField.BRIBE_VOTING_REWARD_ADDRESS;

  const poolDiff = {
    incrementalTotalBribeClaimed: isBribe ? data.amount : 0n,
    incrementalTotalBribeClaimedUSD: isBribe ? rewardAmountUSD : 0n,
    incrementalTotalFeeRewardClaimed: isBribe ? 0n : data.amount,
    incrementalTotalFeeRewardClaimedUSD: isBribe ? 0n : rewardAmountUSD,
    lastUpdatedTimestamp: new Date(data.timestamp * 1000),
  };

  const userDiff = {
    incrementalTotalBribeClaimed: isBribe ? data.amount : 0n,
    incrementalTotalBribeClaimedUSD: isBribe ? rewardAmountUSD : 0n,
    incrementalTotalFeeRewardClaimed: isBribe ? 0n : data.amount,
    incrementalTotalFeeRewardClaimedUSD: isBribe ? 0n : rewardAmountUSD,
    lastActivityTimestamp: new Date(data.timestamp * 1000),
  };

  return {
    poolDiff,
    userDiff,
  };
}

/**
 * Helper function to load pool and user data for voting reward events
 * Handles the DB logic of finding pools and loading entities
 */
export async function loadVotingRewardData(
  data: VotingRewardEventData,
  context: handlerContext,
  handlerName: string,
  field: PoolAddressField,
): Promise<{
  pool?: LiquidityPoolAggregator;
  poolData?: { liquidityPoolAggregator: LiquidityPoolAggregator };
  userData: UserStatsPerPool;
} | null> {
  const votingRewardAddress = data.votingRewardAddress;
  const userAddress = data.userAddress;

  // Find the pool by voting reward address
  const pool = await findPoolByField(
    votingRewardAddress,
    data.chainId,
    context,
    field,
  );

  if (!pool) {
    const rewardType =
      field === PoolAddressField.BRIBE_VOTING_REWARD_ADDRESS ? "bribe" : "fee";
    context.log.error(
      `${handlerName}: Pool not found for ${rewardType} voting reward address ${votingRewardAddress} on chain ${data.chainId}`,
    );
    return null;
  }

  // Load pool data and handle errors
  const poolData = await loadPoolData(pool.id, data.chainId, context);
  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.id} on chain ${data.chainId}`,
    );
    return null;
  }

  // Load user data
  const userData = await loadOrCreateUserData(
    userAddress,
    pool.id,
    data.chainId,
    context,
    new Date(data.timestamp * 1000),
  );

  return {
    pool,
    poolData,
    userData,
  };
}
