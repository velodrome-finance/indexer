/**
 * Cross-chain pending resolution for votes and reward distributions.
 *
 * When the RootPool_LeafPool mapping is not yet available (e.g. leaf pool created after
 * root pool), Voted/Abstained and DistributeReward events are stored as PendingVote and
 * PendingDistribution. This module fetches those pending entities, applies them to the
 * leaf pool once the mapping exists, and exposes a single flush entry point used by
 * CLFactory, PoolFactory, and RootCLPoolFactory when a new pool or mapping is created.
 */

import type {
  PendingDistribution,
  PendingVote,
  handlerContext,
} from "generated";
import {
  type PoolData,
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import {
  loadOrCreateVeNFTPoolVote,
  updateVeNFTPoolVote,
} from "../../Aggregators/VeNFTPoolVote";
import { loadVeNFTState } from "../../Aggregators/VeNFTState";
import {
  CHAIN_CONSTANTS,
  CrossChainPendingResolutionLogPrefix,
  TokenId,
} from "../../Constants";
import {
  logContextError,
  runAsyncWithErrorLog,
  sortByBlockThenLogIndex,
} from "../../Helpers";
import { refreshTokenPrice } from "../../PriceOracle";
import {
  VoterEventType,
  buildPoolDiffFromDistribute,
  computeVoterDistributeValues,
  computeVoterRelatedEntitiesDiff,
} from "./VoterCommonLogic";

// ---------- Pending votes ----------

/**
 * Fetches all pending votes for a given root pool address, sorted by block then log index.
 * Used when the RootPool_LeafPool mapping becomes available to flush deferred votes.
 * @param context - The handler context
 * @param rootPoolAddress - The root pool address
 * @returns Pending votes sorted by block number (and log index when available)
 */
export async function getPendingVotesByRootPool(
  context: handlerContext,
  rootPoolAddress: string,
): Promise<PendingVote[]> {
  const list =
    (await context.PendingVote.getWhere({
      rootPoolAddress: { _eq: rootPoolAddress },
    })) ?? [];
  const getLogIndexFromId = (id: string): number => {
    const lastDash = id.lastIndexOf("-");
    const segment = lastDash >= 0 ? id.slice(lastDash + 1) : "";
    const n = Number(segment);
    return Number.isNaN(n) ? 0 : n;
  };
  return sortByBlockThenLogIndex(
    list,
    (a) => Number(a.blockNumber),
    (a) => getLogIndexFromId(a.id),
  );
}

/**
 * Applies a single pending vote to the leaf pool: updates LiquidityPoolAggregator,
 * UserStatsPerPool, and VeNFTPoolVote. Uses incremental pool update (current total + delta)
 * since we don't have the event's totalWeight.
 * @param context - The handler context
 * @param pendingVote - The pending vote to process
 * @param leafPoolData - The leaf pool data
 * @returns true if the vote was applied, false if skipped (e.g. veNFTState not found)
 */
export async function processPendingVote(
  context: handlerContext,
  pendingVote: PendingVote,
  leafPoolData: PoolData,
): Promise<boolean> {
  const veNFTState = await loadVeNFTState(
    pendingVote.chainId,
    pendingVote.tokenId,
    context,
  );
  if (!veNFTState) {
    return false;
  }

  const leafPool = leafPoolData.liquidityPoolAggregator;
  const leafChainId = leafPool.chainId;
  const leafPoolAddress = leafPool.poolAddress;
  const timestamp =
    pendingVote.timestamp instanceof Date
      ? pendingVote.timestamp
      : new Date(Number(pendingVote.timestamp));

  // Synthetic totalWeight: current pool total + this vote's delta (so computeVoterRelatedEntitiesDiff sets the right absolute value)
  const weightDelta =
    pendingVote.eventType === VoterEventType.VOTED
      ? pendingVote.weight
      : -pendingVote.weight;
  const totalWeight = leafPool.veNFTamountStaked + weightDelta;

  const { poolVoteDiff, userStatsPerPoolDiff, veNFTPoolVoteDiff } =
    computeVoterRelatedEntitiesDiff(
      totalWeight,
      pendingVote.weight,
      veNFTState,
      timestamp,
      pendingVote.eventType as VoterEventType,
    );

  const [veNFTPoolVote, userStats] = await Promise.all([
    loadOrCreateVeNFTPoolVote(
      leafChainId,
      pendingVote.tokenId,
      leafPoolAddress,
      veNFTState,
      context,
      timestamp,
    ),
    loadOrCreateUserData(
      veNFTState.owner,
      leafPoolAddress,
      leafChainId,
      context,
      timestamp,
    ),
  ]);

  await Promise.all([
    updateLiquidityPoolAggregator(
      poolVoteDiff,
      leafPool,
      timestamp,
      context,
      // Pass root chainId so the dynamic fee guard detects chain mismatch and skips.
      // pendingVote.blockNumber is from the root chain (OP), not the leaf chain.
      pendingVote.chainId,
      Number(pendingVote.blockNumber),
    ),
    updateUserStatsPerPool(userStatsPerPoolDiff, userStats, context, timestamp),
    updateVeNFTPoolVote(veNFTPoolVoteDiff, veNFTPoolVote, context),
  ]);
  return true;
}

/**
 * Removes a PendingVote entity after it has been successfully applied.
 * @param context - The handler context
 * @param pendingVote - The pending vote to delete
 * @returns void
 */
export function deleteProcessedPendingVote(
  context: handlerContext,
  pendingVote: PendingVote,
): void {
  context.PendingVote.deleteUnsafe(pendingVote.id);
}

/**
 * Tries to process a pending item and delete it only on success. Logs and swallows errors so the caller can continue with other items.
 * @param context - The handler context
 * @param item - The pending item (vote or distribution)
 * @param runProcess - Async function that returns true if the item was processed, false if skipped
 * @param deleteFn - Function to delete the item from the store after successful process
 * @param logPrefix - Log prefix for error messages
 * @param itemId - Item id for error messages
 */
async function tryProcessAndDeletePending<T>(
  context: handlerContext,
  item: T,
  runProcess: () => Promise<boolean>,
  deleteFn: (ctx: handlerContext, it: T) => void,
  logPrefix: string,
  itemId: string,
): Promise<void> {
  let success = false;
  try {
    success = await runProcess();
  } catch (error) {
    logContextError(
      context,
      `${logPrefix} Failed processing pending item ${itemId}`,
      error,
    );
    return;
  }
  if (!success) return;

  try {
    deleteFn(context, item);
  } catch (deleteError) {
    logContextError(
      context,
      `${logPrefix} Failed to delete processed pending item ${itemId}`,
      deleteError,
    );
  }
}

/**
 * Loads the RootPool_LeafPool mapping for the given root pool, loads leaf pool data,
 * then processes all pending votes for that root pool and deletes each after success.
 * @param context - The handler context
 * @param rootPoolAddress - The root pool address
 * @returns void
 */
export async function processAllPendingVotesForRootPool(
  context: handlerContext,
  rootPoolAddress: string,
): Promise<void> {
  const rootPoolLeafPools =
    (await context.RootPool_LeafPool.getWhere({
      rootPoolAddress: { _eq: rootPoolAddress },
    })) ?? [];

  if (rootPoolLeafPools.length !== 1) {
    return;
  }

  const { leafPoolAddress, leafChainId } = rootPoolLeafPools[0];
  const leafPoolData = await loadPoolData(
    leafPoolAddress,
    leafChainId,
    context,
    undefined,
    undefined,
  );

  if (!leafPoolData) {
    return;
  }

  const pendingVotes = await getPendingVotesByRootPool(
    context,
    rootPoolAddress,
  );

  for (const pendingVote of pendingVotes) {
    // Reload leaf pool data each iteration: processPendingVote updates the pool (e.g. veNFTamountStaked)
    // via updateLiquidityPoolAggregator, so the next vote must see the updated state to compute
    // the correct cumulative totalWeight.
    const currentLeafPoolData = await loadPoolData(
      leafPoolAddress,
      leafChainId,
      context,
      undefined,
      undefined,
    );
    if (!currentLeafPoolData) {
      continue;
    }
    await tryProcessAndDeletePending(
      context,
      pendingVote,
      () => processPendingVote(context, pendingVote, currentLeafPoolData),
      deleteProcessedPendingVote,
      CrossChainPendingResolutionLogPrefix.Votes,
      pendingVote.id,
    );
  }
}

// ---------- Pending distributions ----------

/**
 * Fetches all pending distributions for a given root pool address, sorted by block then log index.
 * Used when the RootPool_LeafPool mapping becomes available to flush deferred distributions.
 * @param context - The handler context
 * @param rootPoolAddress - The root pool address
 * @returns The pending distributions sorted by block number and log index
 */
export async function getPendingDistributionsByRootPool(
  context: handlerContext,
  rootPoolAddress: string,
): Promise<PendingDistribution[]> {
  const list =
    (await context.PendingDistribution.getWhere({
      rootPoolAddress: { _eq: rootPoolAddress },
    })) ?? [];
  return sortByBlockThenLogIndex(
    list,
    (a) => Number(a.blockNumber),
    (a) => a.logIndex,
  );
}

/**
 * Applies a single pending distribution to the leaf pool: loads reward token, computes values,
 * builds LP diff (without gaugeAddress for cross-chain), and updates the LiquidityPoolAggregator.
 * @param context - The handler context
 * @param pending - The pending distribution to process
 * @param leafPoolAddress - The address of the leaf pool
 * @param leafChainId - The chain ID of the leaf pool
 * @returns true if the distribution was applied, false if skipped (e.g. reward token or leaf pool data not found)
 */
export async function processPendingDistribution(
  context: handlerContext,
  pending: PendingDistribution,
  leafPoolAddress: string,
  leafChainId: number,
): Promise<boolean> {
  const rootChainId = pending.rootChainId;
  const blockNumber = Number(pending.blockNumber);

  const blockTimestamp = Math.floor(
    (pending.blockTimestamp instanceof Date
      ? pending.blockTimestamp
      : new Date(Number(pending.blockTimestamp))
    ).getTime() / 1000,
  );

  const rewardTokenAddress =
    CHAIN_CONSTANTS[rootChainId].rewardToken(blockNumber);
  const rewardToken = await context.Token.get(
    TokenId(rootChainId, rewardTokenAddress),
  );
  if (!rewardToken) {
    return false;
  }

  // Don't pass blockNumber/blockTimestamp: they belong to the root chain
  // and cannot be used for RPC queries on the leaf chain.
  const leafPoolData = await loadPoolData(
    leafPoolAddress,
    leafChainId,
    context,
  );
  if (!leafPoolData) {
    return false;
  }

  const currentLiquidityPool = leafPoolData.liquidityPoolAggregator;
  const updatedRewardToken = await refreshTokenPrice(
    rewardToken,
    blockNumber,
    blockTimestamp,
    rootChainId,
    context,
  );

  const result = await computeVoterDistributeValues(
    updatedRewardToken,
    pending.gaugeAddress,
    pending.amount,
    blockNumber,
    rootChainId,
    context,
    currentLiquidityPool.gaugeIsAlive ?? false,
  );

  const timestampMs = blockTimestamp * 1000;
  const poolDiff = buildPoolDiffFromDistribute(result, timestampMs, undefined);

  await updateLiquidityPoolAggregator(
    poolDiff,
    currentLiquidityPool,
    new Date(timestampMs),
    context,
    // Pass rootChainId so the dynamic fee guard detects chain mismatch and skips
    rootChainId,
    blockNumber,
  );
  return true;
}

/**
 * Deletes a PendingDistribution entity after it has been successfully applied.
 * @param context - The handler context
 * @param pending - The pending distribution to delete
 * @returns void
 */
export function deleteProcessedPendingDistribution(
  context: handlerContext,
  pending: PendingDistribution,
): void {
  context.PendingDistribution.deleteUnsafe(pending.id);
}

/**
 * Loads the RootPool_LeafPool mapping for the given root pool, then processes all pending
 * distributions for that root pool in order and deletes each after success.
 * @param context - The handler context
 * @param rootPoolAddress - The root pool address
 * @returns void
 */
export async function processAllPendingDistributionsForRootPool(
  context: handlerContext,
  rootPoolAddress: string,
): Promise<void> {
  const rootPoolLeafPools =
    (await context.RootPool_LeafPool.getWhere({
      rootPoolAddress: { _eq: rootPoolAddress },
    })) ?? [];

  if (rootPoolLeafPools.length !== 1) {
    return;
  }

  const { leafPoolAddress, leafChainId } = rootPoolLeafPools[0];
  const pendingList = await getPendingDistributionsByRootPool(
    context,
    rootPoolAddress,
  );

  for (const pending of pendingList) {
    await tryProcessAndDeletePending(
      context,
      pending,
      () =>
        processPendingDistribution(
          context,
          pending,
          leafPoolAddress,
          leafChainId,
        ),
      deleteProcessedPendingDistribution,
      CrossChainPendingResolutionLogPrefix.Distributions,
      pending.id,
    );
  }
}

// ---------- Flush (orchestration) ----------

/**
 * Runs processAllPendingVotesForRootPool and processAllPendingDistributionsForRootPool
 * for the given root pool. Each is run in its own try/catch so a failure in one is
 * logged and does not prevent the other from running; the handler never throws.
 * @param context - The handler context
 * @param rootPoolAddress - The root pool address
 * @param logPrefix - The log prefix
 * @returns void
 */
export async function flushPendingVotesAndDistributionsForRootPool(
  context: handlerContext,
  rootPoolAddress: string,
  logPrefix: string,
): Promise<void> {
  await runAsyncWithErrorLog(
    context,
    `${logPrefix} processAllPendingVotesForRootPool failed for rootPoolAddress ${rootPoolAddress}`,
    () => processAllPendingVotesForRootPool(context, rootPoolAddress),
  );
  await runAsyncWithErrorLog(
    context,
    `${logPrefix} processAllPendingDistributionsForRootPool failed for rootPoolAddress ${rootPoolAddress}`,
    () => processAllPendingDistributionsForRootPool(context, rootPoolAddress),
  );
}
