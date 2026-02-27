import type { PendingVote, handlerContext } from "generated";
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
import { VoterEventType } from "./VoterCommonLogic";
import { computeVoterRelatedEntitiesDiff } from "./VoterCommonLogic";

/**
 * Fetches all pending votes for a given root pool address.
 * Used when the RootPool_LeafPool mapping becomes available to flush deferred votes.
 * @param context - The handler context
 * @param rootPoolAddress - The root pool address
 * @returns A list of pending votes
 */
export async function getPendingVotesByRootPool(
  context: handlerContext,
  rootPoolAddress: string,
): Promise<PendingVote[]> {
  const list =
    (await context.PendingVote.getWhere({
      rootPoolAddress: { _eq: rootPoolAddress },
    })) ?? [];
  return list.sort(
    (a, b) =>
      (a.timestamp instanceof Date
        ? a.timestamp.getTime()
        : Number(a.timestamp)) -
      (b.timestamp instanceof Date
        ? b.timestamp.getTime()
        : Number(b.timestamp)),
  );
}

/**
 * Applies a single pending vote to the leaf pool: updates LiquidityPoolAggregator,
 * UserStatsPerPool, and VeNFTPoolVote. Uses incremental pool update (current total + delta)
 * since we don't have the event's totalWeight.
 * @param context - The handler context
 * @param pendingVote - The pending vote to process
 * @param leafPoolData - The leaf pool data
 * @returns void
 */
export async function processPendingVote(
  context: handlerContext,
  pendingVote: PendingVote,
  leafPoolData: PoolData,
): Promise<void> {
  const veNFTState = await loadVeNFTState(
    pendingVote.chainId,
    pendingVote.tokenId,
    context,
  );
  if (!veNFTState) {
    context.log.warn(
      `[processPendingVote] VeNFTState not found for tokenId ${pendingVote.tokenId} on chain ${pendingVote.chainId}, skipping pending vote ${pendingVote.id}`,
    );
    return;
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
      leafChainId,
      Number(pendingVote.blockNumber),
    ),
    updateUserStatsPerPool(userStatsPerPoolDiff, userStats, context, timestamp),
    updateVeNFTPoolVote(veNFTPoolVoteDiff, veNFTPoolVote, context),
  ]);
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
    context.log.warn(
      `[processAllPendingVotesForRootPool] Expected exactly one RootPool_LeafPool for rootPoolAddress ${rootPoolAddress}, got ${rootPoolLeafPools.length}. Skipping pending vote processing.`,
    );
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
    context.log.warn(
      `[processAllPendingVotesForRootPool] Leaf pool data not found for ${leafPoolAddress} on chain ${leafChainId}. Skipping pending vote processing.`,
    );
    return;
  }

  const pendingVotes = await getPendingVotesByRootPool(
    context,
    rootPoolAddress,
  );

  for (const pendingVote of pendingVotes) {
    const currentLeafPoolData = await loadPoolData(
      leafPoolAddress,
      leafChainId,
      context,
      undefined,
      undefined,
    );
    if (!currentLeafPoolData) {
      context.log.warn(
        `[processAllPendingVotesForRootPool] Leaf pool data not found for leafPoolAddress ${leafPoolAddress} on chain ${leafChainId}, skipping pending vote ${pendingVote.id}`,
      );
      continue;
    }
    await processPendingVote(context, pendingVote, currentLeafPoolData);
    deleteProcessedPendingVote(context, pendingVote);
  }
}
