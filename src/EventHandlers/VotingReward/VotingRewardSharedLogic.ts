import type {
  LiquidityPoolAggregator,
  UserStatsPerPool,
  handlerContext,
} from "generated";
import {
  PoolAddressField,
  findPoolByField,
  loadPoolData,
} from "../../Aggregators/LiquidityPoolAggregator";
import { loadUserData } from "../../Aggregators/UserStatsPerPool";
import { toChecksumAddress } from "../../Constants";
import { getTokenPriceData } from "../../Effects/Index";
import { normalizeTokenAmountTo1e18 } from "../../Helpers";
import { multiplyBase1e18 } from "../../Maths";

export interface VotingRewardEventData {
  votingRewardAddress: string;
  userAddress: string;
  chainId: number;
  blockNumber: number;
  timestamp: number;
}

export interface VotingRewardDepositData extends VotingRewardEventData {
  tokenId: bigint;
  amount: bigint;
}

export interface VotingRewardWithdrawData extends VotingRewardEventData {
  tokenId: bigint;
  amount: bigint;
}

export interface VotingRewardClaimRewardsData extends VotingRewardEventData {
  reward: string;
  amount: bigint;
}

export interface VotingRewardDepositResult {
  poolDiff?: Partial<LiquidityPoolAggregator>;
  userDiff?: Partial<UserStatsPerPool>;
}

export interface VotingRewardWithdrawResult {
  poolDiff?: Partial<LiquidityPoolAggregator>;
  userDiff?: Partial<UserStatsPerPool>;
}

export interface VotingRewardClaimRewardsResult {
  poolDiff?: Partial<LiquidityPoolAggregator>;
  userDiff?: Partial<UserStatsPerPool>;
}

/**
 * Business logic for processing voting reward deposit events
 * Returns data structures for database updates - does not perform DB operations
 */
export async function processVotingRewardDeposit(
  data: VotingRewardDepositData,
): Promise<VotingRewardDepositResult> {
  const poolDiff: Partial<LiquidityPoolAggregator> = {
    veNFTamountStaked: data.amount,
    lastUpdatedTimestamp: new Date(data.timestamp * 1000),
  };

  const userDiff: Partial<UserStatsPerPool> = {
    veNFTamountStaked: data.amount,
    lastActivityTimestamp: new Date(data.timestamp * 1000),
  };

  return {
    poolDiff,
    userDiff,
  };
}

/**
 * Business logic for processing voting reward withdrawal events
 * Returns data structures for database updates - does not perform DB operations
 */
export async function processVotingRewardWithdraw(
  data: VotingRewardWithdrawData,
): Promise<VotingRewardWithdrawResult> {
  const poolDiff: Partial<LiquidityPoolAggregator> = {
    veNFTamountStaked: -data.amount,
    lastUpdatedTimestamp: new Date(data.timestamp * 1000),
  };

  const userDiff: Partial<UserStatsPerPool> = {
    veNFTamountStaked: -data.amount,
    lastActivityTimestamp: new Date(data.timestamp * 1000),
  };

  return {
    poolDiff,
    userDiff,
  };
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
  // Get reward token data and convert amount to USD
  const rewardTokenData = await context.effect(getTokenPriceData, {
    tokenAddress: data.reward,
    blockNumber: data.blockNumber,
    chainId: data.chainId,
  });

  // Convert reward amount to USD
  const normalizedRewardAmount = normalizeTokenAmountTo1e18(
    data.amount,
    Number(rewardTokenData.decimals),
  );
  const rewardAmountUSD = multiplyBase1e18(
    normalizedRewardAmount,
    rewardTokenData.pricePerUSDNew,
  );

  // Determine if this is a bribe or fee reward
  const isBribe = field === PoolAddressField.BRIBE_VOTING_REWARD_ADDRESS;

  const poolDiff: Partial<LiquidityPoolAggregator> = {
    totalBribeClaimed: isBribe ? data.amount : 0n,
    totalBribeClaimedUSD: isBribe ? rewardAmountUSD : 0n,
    totalFeeRewardClaimed: isBribe ? 0n : data.amount,
    totalFeeRewardClaimedUSD: isBribe ? 0n : rewardAmountUSD,
    lastUpdatedTimestamp: new Date(data.timestamp * 1000),
  };

  const userDiff: Partial<UserStatsPerPool> = {
    totalBribeClaimed: isBribe ? data.amount : 0n,
    totalBribeClaimedUSD: isBribe ? rewardAmountUSD : 0n,
    totalFeeRewardClaimed: isBribe ? 0n : data.amount,
    totalFeeRewardClaimedUSD: isBribe ? 0n : rewardAmountUSD,
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
  userData?: UserStatsPerPool;
} | null> {
  const votingRewardChecksumAddress = toChecksumAddress(
    data.votingRewardAddress,
  );
  const userChecksumAddress = toChecksumAddress(data.userAddress);

  // Find the pool by voting reward address
  const pool = await findPoolByField(
    votingRewardChecksumAddress,
    data.chainId,
    context,
    field,
  );

  if (!pool) {
    const rewardType =
      field === PoolAddressField.BRIBE_VOTING_REWARD_ADDRESS ? "bribe" : "fee";
    context.log.error(
      `${handlerName}: Pool not found for ${rewardType} voting reward address ${votingRewardChecksumAddress} on chain ${data.chainId}`,
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
  const userData = await loadUserData(
    userChecksumAddress,
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
