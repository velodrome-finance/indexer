/**
 * Cross-chain pending resolution for reward distributions.
 *
 * When the RootPool_LeafPool mapping is not yet available (e.g. leaf pool created after
 * root pool), DistributeReward events are stored as PendingDistribution. This module
 * fetches those pending entities, applies them to the leaf pool once the mapping exists,
 * and exposes a single flush entry point used by CLFactory, PoolFactory, and
 * RootCLPoolFactory when a new pool or mapping is created.
 */

import type { PendingDistribution, handlerContext } from "generated";
import {
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
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
  buildPoolDiffFromDistribute,
  computeVoterDistributeValues,
} from "./VoterCommonLogic";

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
    context.log.warn(
      `${CrossChainPendingResolutionLogPrefix.Distributions} Reward token not found for chain ${rootChainId} at block ${blockNumber}, skipping pending distribution ${pending.id}`,
    );
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
    context.log.warn(
      `${CrossChainPendingResolutionLogPrefix.Distributions} Leaf pool data not found for ${leafPoolAddress} on chain ${leafChainId}, skipping pending distribution ${pending.id}`,
    );
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
    context.log.warn(
      `${CrossChainPendingResolutionLogPrefix.Distributions} Expected exactly one RootPool_LeafPool for rootPoolAddress ${rootPoolAddress}, got ${rootPoolLeafPools.length}. Skipping pending distribution processing.`,
    );
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
 * Flushes all pending distributions for the given root pool. Runs in a try/catch
 * so failures are logged without throwing; the handler never throws.
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
    `${logPrefix} processAllPendingDistributionsForRootPool failed for rootPoolAddress ${rootPoolAddress}`,
    () => processAllPendingDistributionsForRootPool(context, rootPoolAddress),
  );
}
