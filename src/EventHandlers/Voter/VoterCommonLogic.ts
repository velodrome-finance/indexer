import type { Token, VeNFTState } from "envio";
import type { PoolDiff } from "../../Aggregators/Pool";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import type { VeNFTPoolVoteDiff } from "../../Aggregators/VeNFTPoolVote";
import type { handlerContext } from "../../EntityTypes";
import type { Pool } from "../../EntityTypes";
import { normalizeTokenAmountTo1e18 } from "../../Helpers";
import { getTrustedUSD } from "../../PriceTrust";

export interface VoterCommonResult {
  isAlive: boolean;
  /**
   * The gauge's reward-token balance after this distribution, derived from
   * events, in raw reward-token units (written to `Pool.totalVotesDeposited`).
   */
  tokensDeposited: bigint;
  normalizedEmissionsAmount: bigint;
  normalizedEmissionsAmountUsd: bigint;
  normalizedVotesDepositedAmountUsd: bigint;
}

export enum VoterEventType {
  VOTED = "Voted",
  ABSTAINED = "Abstained",
}

/**
 * Computes the pool updates for a Voter DistributeReward: the emission (1e18
 * and USD) and the gauge's reward-token balance after it.
 *
 * The balance is derived from the pool's own event totals instead of read
 * over RPC: everything that entered the gauge (`totalEmissions` including
 * this distribution, `totalEmissionsRedistributed`) minus everything that
 * left it (`totalEmissionsForfeited`, `totalGaugeRewardsClaimed`,
 * `totalGaugeEarlyWithdrawPenalties`). This is `rewardToken.balanceOf(gauge)`
 * for a gauge whose reward token only moves through those events. Amounts
 * are combined in 1e18 units (`totalEmissions` is stored normalized; the
 * other totals are raw reward-token units and are normalized with the reward
 * token's decimals) and the result is returned in raw reward-token units, as
 * the RPC read returned it. A negative result (totals missing an outflow) is
 * clamped to 0 with a warning. The pool is always on the distribution's chain
 * (a root gauge's emissions go to its `RootPool`, ADR 0009).
 *
 * @param rewardToken - The chain's legacy reward token (decimals and price)
 * @param pool - The pool whose gauge received the distribution, before this distribution
 * @param gaugeAddress - The distributing gauge (for the warning only)
 * @param amountEmittedRaw - `event.params.amount`, raw reward-token units
 * @param chainId - Chain of the DistributeReward (price-trust gate and the warning)
 * @param context - Handler context (logging)
 * @param gaugeIsAlive - Gauge liveness to carry into the result
 * @returns The emission amounts and the derived gauge balance with its USD value
 */
export function computeVoterDistributeValues(
  rewardToken: Token,
  pool: Pool,
  gaugeAddress: string,
  amountEmittedRaw: bigint, // event.params.amount (reward token units)
  chainId: number,
  context: handlerContext,
  gaugeIsAlive: boolean,
): VoterCommonResult {
  const rewardTokenDecimals = Number(rewardToken.decimals);

  const normalizedEmissionsAmount = normalizeTokenAmountTo1e18(
    amountEmittedRaw,
    rewardTokenDecimals,
  );

  const normalizedEmissionsAmountUsd = getTrustedUSD(
    amountEmittedRaw,
    rewardToken,
    chainId,
  );

  const toE18 = (raw: bigint) =>
    normalizeTokenAmountTo1e18(raw, rewardTokenDecimals);
  const balanceE18 =
    pool.totalEmissions +
    normalizedEmissionsAmount +
    toE18(pool.totalEmissionsRedistributed) -
    toE18(pool.totalEmissionsForfeited) -
    toE18(pool.totalGaugeRewardsClaimed) -
    toE18(pool.totalGaugeEarlyWithdrawPenalties);
  if (balanceE18 < 0n) {
    context.log.warn(
      `[computeVoterDistributeValues] Derived reward-token balance of gauge ${gaugeAddress} (pool ${pool.id}) on chain ${chainId} is negative (${balanceE18}, 1e18 units); using 0`,
    );
  }
  const tokensDeposited =
    balanceE18 > 0n
      ? (balanceE18 * 10n ** BigInt(rewardTokenDecimals)) / 10n ** 18n
      : 0n;

  const normalizedVotesDepositedAmountUsd = getTrustedUSD(
    tokensDeposited,
    rewardToken,
    chainId,
  );

  return {
    isAlive: gaugeIsAlive,
    tokensDeposited,
    normalizedEmissionsAmount,
    normalizedEmissionsAmountUsd,
    normalizedVotesDepositedAmountUsd,
  };
}

/**
 * Builds the Pool diff for a DistributeReward to the pool's gauge.
 * @param result - The result of the computeVoterDistributeValues function
 * @param timestampMs - The timestamp in milliseconds
 * @param gaugeAddress - The distributing gauge
 * @returns The Pool diff
 */
export function buildPoolDiffFromDistribute(
  result: VoterCommonResult,
  timestampMs: number,
  gaugeAddress: string,
): Partial<PoolDiff> {
  return {
    totalVotesDeposited: result.tokensDeposited,
    totalVotesDepositedUSD: result.normalizedVotesDepositedAmountUsd,
    incrementalTotalEmissions: result.normalizedEmissionsAmount,
    incrementalTotalEmissionsUSD: result.normalizedEmissionsAmountUsd,
    lastUpdatedTimestamp: new Date(timestampMs),
    gaugeIsAlive: result.isAlive,
    gaugeAddress,
  };
}

/**
 * Computes diffs for pool (absolute total), user stats and VeNFTPoolVote (incremental delta).
 * @param totalWeight - New total veNFT staked in pool (absolute; used for Pool)
 * @param weight - Delta for this vote (used for UserStatsPerPool and VeNFTPoolVote)
 * @param veNFTState - The VeNFTState for the token
 * @param timestamp - The timestamp of the event
 * @param eventType - The type of event (VOTED or ABSTAINED)
 * @returns The diffs for the pool, user stats and VeNFTPoolVote
 */
export function computeVoterRelatedEntitiesDiff(
  totalWeight: bigint,
  weight: bigint,
  veNFTState: VeNFTState,
  timestamp: Date,
  eventType: VoterEventType,
): {
  poolVoteDiff: Partial<PoolDiff>;
  userStatsPerPoolDiff: Partial<UserStatsPerPoolDiff>;
  veNFTPoolVoteDiff: Partial<VeNFTPoolVoteDiff>;
} {
  const poolVoteDiff = {
    veNFTamountStaked: totalWeight, // it's veNFT token amount!! This is absolute total veNFT staked in pool, substituting directly the previous value
  };

  const weightDelta = eventType === VoterEventType.VOTED ? weight : -weight;

  const userStatsPerPoolDiff = {
    incrementalVeNFTamountStaked: weightDelta,
    lastActivityTimestamp: timestamp,
  };

  const veNFTPoolVoteDiff = {
    incrementalVeNFTamountStaked: weightDelta,
    lastUpdatedTimestamp: timestamp,
    veNFTStateId: veNFTState.id,
  };

  return {
    poolVoteDiff,
    userStatsPerPoolDiff,
    veNFTPoolVoteDiff,
  };
}
