import type { Token, VeNFTState } from "envio";
import {
  type PoolDiff,
  loadPoolData,
  updatePool,
} from "../../Aggregators/Pool";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import type { VeNFTPoolVoteDiff } from "../../Aggregators/VeNFTPoolVote";
import {
  PendingVoteId,
  RootGaugeRootPoolId,
  isKnownSinkRootPool,
} from "../../Constants";
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
 * clamped to 0 with a warning. For a leaf pool (the pool's chain differs from
 * the distribution's chain) the balance is 0: see the comment in the body.
 *
 * @param rewardToken - The chain's legacy reward token (decimals and price)
 * @param pool - The pool whose gauge received the distribution, before this distribution
 * @param gaugeAddress - The distributing gauge (for the warning only)
 * @param amountEmittedRaw - `event.params.amount`, raw reward-token units
 * @param chainId - Chain of the DistributeReward (for the warning only)
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
  );

  // A superchain leaf pool: the distribution is on the root chain and the
  // claims are on the leaf chain, and Envio does not keep the two in time
  // order during a backfill, so the totals cannot be combined. The RPC read
  // this replaces returned the root gauge's balance there, which is about 0
  // once the tokens are bridged; keep 0.
  const isLeafPool = pool.chainId !== chainId;
  const toE18 = (raw: bigint) =>
    normalizeTokenAmountTo1e18(raw, rewardTokenDecimals);
  const balanceE18 = isLeafPool
    ? 0n
    : pool.totalEmissions +
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
 * Builds the Pool diff for a DistributeReward. When gaugeAddress is omitted (cross-chain case),
 * the diff does not include gaugeAddress so the leaf pool's gauge is not overwritten.
 * @param result - The result of the computeVoterDistributeValues function
 * @param timestampMs - The timestamp in milliseconds
 * @param gaugeAddress - The address of the root gauge (optional)
 * @returns The Pool diff
 */
export function buildPoolDiffFromDistribute(
  result: VoterCommonResult,
  timestampMs: number,
  gaugeAddress?: string,
): Partial<PoolDiff> {
  const diff: Partial<PoolDiff> = {
    totalVotesDeposited: result.tokensDeposited,
    totalVotesDepositedUSD: result.normalizedVotesDepositedAmountUsd,
    incrementalTotalEmissions: result.normalizedEmissionsAmount,
    incrementalTotalEmissionsUSD: result.normalizedEmissionsAmountUsd,
    lastUpdatedTimestamp: new Date(timestampMs),
    gaugeIsAlive: result.isAlive,
  };
  if (gaugeAddress !== undefined) {
    diff.gaugeAddress = gaugeAddress;
  }
  return diff;
}

/**
 * Resolves a root gauge (RootGauge/RootCLGauge on OP) to the corresponding leaf pool via
 * RootGauge_RootPool and RootPool_LeafPool. Used when DistributeReward fires for a gauge
 * that has no local Pool (the real pool is on a leaf chain).
 * @param context - The handler context
 * @param chainId - The chain ID
 * @param gaugeAddress - The address of the root gauge
 * @returns The leaf pool and isCrossChain: true, or null if resolution fails (logs warning).
 */
export async function resolveLeafPoolForRootGauge(
  context: handlerContext,
  chainId: number,
  gaugeAddress: string,
): Promise<{ pool: Pool; isCrossChain: true } | null> {
  const rootGaugeMapping = await context.RootGauge_RootPool.get(
    RootGaugeRootPoolId(chainId, gaugeAddress),
  );
  if (!rootGaugeMapping) {
    context.log.warn(
      `[resolveLeafPoolForRootGauge] No pool address found for the gauge address ${gaugeAddress} on chain ${chainId}`,
    );
    return null;
  }
  const rootPoolAddress = rootGaugeMapping.rootPoolAddress;
  if (isKnownSinkRootPool(chainId, rootPoolAddress)) {
    return null;
  }
  // Deliberately cross-chain: the root pool on this (root) chain resolves to
  // its leaf pool on another chain. The lookup is by bare address, so keep
  // only mappings whose root side is this chain.
  const rootPoolLeafPools = (
    (await context.RootPool_LeafPool.getWhere({
      rootPoolAddress: { _eq: rootPoolAddress },
    })) ?? []
  ).filter((mapping) => mapping.rootChainId === chainId);
  if (rootPoolLeafPools.length !== 1) {
    context.log.warn(
      `[resolveLeafPoolForRootGauge] Root gauge ${gaugeAddress} maps to root pool ${rootPoolAddress} but RootPool_LeafPool mapping not found or ambiguous (count: ${rootPoolLeafPools.length}) on chain ${chainId}`,
    );
    return null;
  }
  const { leafPoolAddress, leafChainId } = rootPoolLeafPools[0];
  // Don't pass blockNumber/blockTimestamp: they belong to the root chain (OP)
  // and cannot be used for RPC queries on the leaf chain.
  // Leaf pool token prices are refreshed by events on the leaf chain itself.
  const leafPoolData = await loadPoolData(
    leafPoolAddress,
    leafChainId,
    context,
  );
  if (!leafPoolData) {
    context.log.warn(
      `[resolveLeafPoolForRootGauge] Leaf pool data not found for ${leafPoolAddress} on chain ${leafChainId} (root gauge ${gaugeAddress})`,
    );
    return null;
  }
  return {
    pool: leafPoolData.liquidityPoolAggregator,
    isCrossChain: true,
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

/**
 * Creates a PendingVote entity and logs a warning when a vote/abstain cannot be
 * applied because the RootPool_LeafPool mapping does not exist yet. Used by
 * Voted and Abstained handlers to defer processing until the mapping is created.
 * @param context - The handler context
 * @param chainId - The chain ID
 * @param rootPoolAddress - The root pool address
 * @param tokenId - The token ID
 * @param weight - The weight of the vote
 * @param eventType - The type of event (VOTED or ABSTAINED)
 * @param timestamp - The timestamp of the event
 * @param blockNumber - The block number of the event
 * @param transactionHash - The transaction hash of the event
 * @param logIndex - The log index of the event
 * @returns void
 */
export function createPendingVoteForDeferredProcessing(
  context: handlerContext,
  chainId: number,
  rootPoolAddress: string,
  tokenId: bigint,
  weight: bigint,
  eventType: VoterEventType,
  timestamp: Date,
  blockNumber: number,
  transactionHash: string,
  logIndex: number,
): void {
  context.PendingVote.set({
    id: PendingVoteId(
      chainId,
      rootPoolAddress,
      tokenId,
      transactionHash,
      logIndex,
    ),
    chainId,
    rootPoolAddress,
    tokenId,
    weight,
    eventType,
    timestamp,
    blockNumber: BigInt(blockNumber),
    transactionHash,
  });
}
