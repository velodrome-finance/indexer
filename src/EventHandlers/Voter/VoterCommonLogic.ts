import type {
  LiquidityPoolAggregator,
  Token,
  VeNFTState,
  handlerContext,
} from "generated";
import {
  type LiquidityPoolAggregatorDiff,
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import type { VeNFTPoolVoteDiff } from "../../Aggregators/VeNFTPoolVote";
import { PendingVoteId, RootGaugeRootPoolId } from "../../Constants";
import { getTokensDeposited } from "../../Effects/Index";
import { normalizeTokenAmountTo1e18 } from "../../Helpers";
import { multiplyBase1e18 } from "../../Maths";

export interface VoterCommonResult {
  isAlive: boolean;
  tokensDeposited: bigint;
  normalizedEmissionsAmount: bigint;
  normalizedEmissionsAmountUsd: bigint;
  normalizedVotesDepositedAmountUsd: bigint;
}

export enum VoterEventType {
  VOTED = "Voted",
  ABSTAINED = "Abstained",
}

export async function computeVoterDistributeValues(
  rewardToken: Token,
  gaugeAddress: string,
  amountEmittedRaw: bigint, // event.params.amount (reward token units)
  blockNumber: number,
  chainId: number,
  context: handlerContext,
  gaugeIsAlive: boolean,
): Promise<VoterCommonResult> {
  const tokensDepositedResult = await context.effect(getTokensDeposited, {
    rewardTokenAddress: rewardToken.address,
    gaugeAddress,
    blockNumber,
    eventChainId: chainId,
  });

  const tokensDeposited = tokensDepositedResult ?? 0n;

  if (tokensDepositedResult === undefined) {
    context.log.error(
      `Failed to fetch tokensDeposited for gauge ${gaugeAddress} on chain ${chainId}, using default: 0n`,
    );
  }

  // Normalize amounts to 1e18
  const normalizedEmissionsAmount = normalizeTokenAmountTo1e18(
    amountEmittedRaw,
    Number(rewardToken.decimals),
  );

  const normalizedVotesDepositedAmount = normalizeTokenAmountTo1e18(
    BigInt(tokensDeposited.toString()),
    Number(rewardToken.decimals),
  );

  // Warn if no USD price
  if (rewardToken.pricePerUSDNew === 0n) {
    context.log.warn(
      `Reward token with ID ${rewardToken.id.toString()} does not have a USD price yet on chain ${chainId}`,
    );
  }

  // USD conversions
  const normalizedEmissionsAmountUsd = multiplyBase1e18(
    normalizedEmissionsAmount,
    rewardToken.pricePerUSDNew,
  );

  const normalizedVotesDepositedAmountUsd = multiplyBase1e18(
    normalizedVotesDepositedAmount,
    rewardToken.pricePerUSDNew,
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
): Partial<LiquidityPoolAggregatorDiff> {
  const diff: Partial<LiquidityPoolAggregatorDiff> = {
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
 * that has no local LiquidityPoolAggregator (the real pool is on a leaf chain).
 * @param context - The handler context
 * @param chainId - The chain ID
 * @param gaugeAddress - The address of the root gauge
 * @param blockNumber - The block number
 * @param blockTimestamp - The block timestamp
 * @returns The leaf pool and isCrossChain: true, or null if resolution fails (logs warning).
 */
export async function resolveLeafPoolForRootGauge(
  context: handlerContext,
  chainId: number,
  gaugeAddress: string,
  blockNumber: number,
  blockTimestamp: number,
): Promise<{ pool: LiquidityPoolAggregator; isCrossChain: true } | null> {
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
  const rootPoolLeafPools =
    (await context.RootPool_LeafPool.getWhere({
      rootPoolAddress: { _eq: rootPoolAddress },
    })) ?? [];
  if (rootPoolLeafPools.length !== 1) {
    context.log.warn(
      `[resolveLeafPoolForRootGauge] Root gauge ${gaugeAddress} maps to root pool ${rootPoolAddress} but RootPool_LeafPool mapping not found or ambiguous (count: ${rootPoolLeafPools.length}) on chain ${chainId}`,
    );
    return null;
  }
  const { leafPoolAddress, leafChainId } = rootPoolLeafPools[0];
  const leafPoolData = await loadPoolData(
    leafPoolAddress,
    leafChainId,
    context,
    blockNumber,
    blockTimestamp,
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
 * @param totalWeight - New total veNFT staked in pool (absolute; used for LiquidityPoolAggregator)
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
  poolVoteDiff: Partial<LiquidityPoolAggregatorDiff>;
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
  const action =
    eventType === VoterEventType.VOTED
      ? "Vote deferred"
      : "Vote withdrawal deferred";
  context.log.warn(
    `[Voter.${eventType}] ${action} for rootPool ${rootPoolAddress} (chainId ${chainId}): RootPool_LeafPool mapping not found. PendingVote stored for later processing.`,
  );
}
