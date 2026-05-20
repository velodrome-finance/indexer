import type { Token, UserStatsPerPool, handlerContext } from "generated";
import {
  PoolAddressField,
  type PoolDiff,
  findPoolByField,
  loadPoolData,
} from "../../Aggregators/Pool";
import {
  type UserStatsPerPoolDiff,
  loadOrCreateUserData,
} from "../../Aggregators/UserStatsPerPool";
import { TokenId } from "../../Constants";
import {
  getTokenDetails,
  getTokenPrice,
  hasContractBytecode,
  roundBlockToInterval,
} from "../../Effects/Index";
import type { Pool } from "../../EntityTypes";
import { refreshTokenPrice } from "../../PriceOracle";
import { getGateDecisionFromSignals, getTrustedUSD } from "../../PriceTrust";

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
  poolDiff: Partial<PoolDiff>;
  userDiff: Partial<UserStatsPerPoolDiff>;
}

/**
 * Builds pool + user diffs for a single ClaimRewards event on a fee or bribe
 * VotingReward contract. Pure: returns incremental diffs to be staged by the
 * caller, no DB writes.
 *
 * Side effects: on a first-sighting reward token, runs the bytecode gate (#677)
 * to filter EOA / non-contract addresses, and otherwise stages `context.Token.set`
 * for the new token row after fetching details + price in parallel.
 *
 * When the bytecode gate rejects the reward address, zero-valued diffs are
 * returned so the pool/user entities still get a `lastUpdatedTimestamp` /
 * `lastActivityTimestamp` bump without persisting USD attribution against a
 * non-existent token.
 *
 * @param data - The claim payload (reward token address, amount, block, chain, user).
 * @param context - The handler context (used for Token storage, effects, logging).
 * @param field - Which VotingReward role the event originated from (fee vs bribe).
 *   Selects whether the amount accumulates into `incrementalTotalBribeClaimed*`
 *   or `incrementalTotalFeeRewardClaimed*`.
 * @returns Promise resolving to `{ poolDiff, userDiff }` — incremental amounts +
 *   USD attribution to merge into the pool aggregator and the user stats row.
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

    const { hasCode } = await context.effect(hasContractBytecode, {
      address: data.reward,
      chainId: data.chainId,
    });
    if (!hasCode) {
      context.log.warn(
        `[processVotingRewardClaimRewards] Skipping Token row and reward USD for non-contract address ${data.reward} on chain ${data.chainId} (no deployed bytecode)`,
      );
      const zeroIncrementals = {
        incrementalTotalBribeClaimed: 0n,
        incrementalTotalBribeClaimedUSD: 0n,
        incrementalTotalFeeRewardClaimed: 0n,
        incrementalTotalFeeRewardClaimedUSD: 0n,
      };
      return {
        poolDiff: {
          ...zeroIncrementals,
          lastUpdatedTimestamp: new Date(data.timestamp * 1000),
        },
        userDiff: {
          ...zeroIncrementals,
          lastActivityTimestamp: new Date(data.timestamp * 1000),
        },
      };
    }

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

    const decision = getGateDecisionFromSignals(
      data.chainId,
      data.reward,
      true,
    );
    const newToken: Token = {
      id: TokenId(data.chainId, data.reward),
      address: data.reward,
      name: rewardTokenDetails.name,
      symbol: rewardTokenDetails.symbol,
      chainId: data.chainId,
      decimals: BigInt(rewardTokenDetails.decimals),
      pricePerUSDNew: priceData.pricePerUSDNew,
      lastUpdatedTimestamp: new Date(data.timestamp * 1000),
      lastSuccessfulPriceTimestamp:
        priceData.pricePerUSDNew > 0n
          ? new Date(data.timestamp * 1000)
          : undefined,
      isWhitelisted: true,
      priceTrustOutcome: decision.outcome,
      priceTrustReason: decision.reason,
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
  const rewardAmountUSD = getTrustedUSD(data.amount, updatedRewardToken);

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
  pool?: Pool;
  poolData?: { liquidityPoolAggregator: Pool };
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
  const poolData = await loadPoolData(pool.poolAddress, data.chainId, context);
  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.poolAddress} on chain ${data.chainId}`,
    );
    return null;
  }

  // Load user data
  const userData = await loadOrCreateUserData(
    userAddress,
    pool.poolAddress,
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
