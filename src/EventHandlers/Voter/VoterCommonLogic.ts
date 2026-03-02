import type {
  LiquidityPoolAggregator,
  Token,
  VeNFTState,
  handlerContext,
} from "generated";
import {
  type LiquidityPoolAggregatorDiff,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import type { VeNFTPoolVoteDiff } from "../../Aggregators/VeNFTPoolVote";
import { PendingVoteId } from "../../Constants";
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

export function buildLpDiffFromDistribute(
  result: VoterCommonResult,
  gaugeAddress: string,
  timestampMs: number,
): Partial<LiquidityPoolAggregatorDiff> {
  return {
    totalVotesDeposited: result.tokensDeposited,
    totalVotesDepositedUSD: result.normalizedVotesDepositedAmountUsd,
    incrementalTotalEmissions: result.normalizedEmissionsAmount,
    incrementalTotalEmissionsUSD: result.normalizedEmissionsAmountUsd,
    lastUpdatedTimestamp: new Date(timestampMs),
    gaugeAddress,
    gaugeIsAlive: result.isAlive,
  };
}

export async function applyLpDiff(
  context: handlerContext,
  currentLiquidityPool: LiquidityPoolAggregator,
  lpDiff: Partial<LiquidityPoolAggregatorDiff>,
  timestampMs: number,
  eventChainId: number,
  blockNumber: number,
) {
  return await updateLiquidityPoolAggregator(
    lpDiff,
    currentLiquidityPool,
    new Date(timestampMs),
    context,
    eventChainId,
    blockNumber,
  );
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
