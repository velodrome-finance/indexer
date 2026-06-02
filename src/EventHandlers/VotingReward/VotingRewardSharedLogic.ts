import type { UserStatsPerPool } from "envio";
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
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import type { Pool } from "../../EntityTypes";
import { createTokenEntity, refreshTokenPrice } from "../../PriceOracle";
import { getTrustedUSD } from "../../PriceTrust";

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
 * Side effects: on a first-sighting reward token, delegates to the canonical
 * {@link createTokenEntity}, which runs the bytecode gate (#677) to filter
 * EOA / non-contract addresses and stages `context.Token.set` with the
 * price-trust gate applied — `isWhitelisted` defaults to `false` (#815) rather
 * than being hardcoded `true`, and `pricePerUSDNew` is persisted as `0n`. That
 * `0n` + untrusted state is what makes {@link getTrustedUSD} contribute `0n` for
 * a first-seen reward token — NOT a guarded oracle read. The bootstrap
 * `refreshTokenPrice` below is throttled (createTokenEntity just stamped
 * `lastUpdatedTimestamp` to this block, so `shouldRefresh` is false), so it
 * makes no oracle call here; `FIRST_FETCH_CAP` + the spike guard first engage on
 * a later (≥1h) claim, which owns the first actual priced read.
 *
 * When `createTokenEntity` rejects the reward address (no deployed bytecode,
 * returns `null`), zero-valued diffs are returned so the pool/user entities
 * still get a `lastUpdatedTimestamp` / `lastActivityTimestamp` bump without
 * persisting USD attribution against a non-existent token.
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
  let rewardToken = await getRehydrated(context.Token, "Token", rewardTokenId);

  if (!rewardToken) {
    // First sighting: route through the canonical createTokenEntity so the
    // reward token gets the same treatment as every other first-seen token —
    // the #677 bytecode gate, `isWhitelisted: false` from the price-trust gate
    // (#815, not a hardcoded `true`), and `pricePerUSDNew: 0n`. That `0n` +
    // untrusted state is what zeros getTrustedUSD on first sight; the
    // refreshTokenPrice call below is throttled (createTokenEntity just stamped
    // this block), so it makes NO oracle call here — FIRST_FETCH_CAP + the spike
    // guard first engage on a later (≥1h) claim.
    const created = await createTokenEntity(
      data.reward,
      data.chainId,
      data.blockNumber,
      context,
      data.timestamp,
    );
    if (!created) {
      // No deployed bytecode (#677): skip USD attribution but still bump the
      // pool/user activity timestamps.
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
    rewardToken = created;
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
