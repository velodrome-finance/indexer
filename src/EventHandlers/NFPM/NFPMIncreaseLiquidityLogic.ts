import type {
  CLPoolMintEvent,
  NFPM_IncreaseLiquidity_event,
  NonFungiblePosition,
  handlerContext,
} from "generated";
import { loadPoolData } from "../../Aggregators/LiquidityPoolAggregator";
import {
  type NonFungiblePositionDiff,
  updateNonFungiblePosition,
} from "../../Aggregators/NonFungiblePosition";
import { NonFungiblePositionId, TxCLPoolMintRegistryId } from "../../Constants";
import {
  LiquidityChangeType,
  attributeLiquidityChangeToUserStatsPerPool,
  updateStakedPositionLiquidity,
} from "./NFPMCommonLogic";

/**
 * Calculates the liquidity diff for an IncreaseLiquidity event.
 * Computes new liquidity by adding the event's liquidity to the current liquidity.
 *
 * @param event - The IncreaseLiquidity event
 * @param position - The position to update
 * @returns Partial position object containing the updated liquidity and timestamp fields
 */
export function calculateIncreaseLiquidityDiff(
  event: NFPM_IncreaseLiquidity_event,
): Partial<NonFungiblePositionDiff> {
  const blockDatetime = new Date(event.block.timestamp * 1000);

  // Update position with increased liquidity
  const nonFungiblePositionDiff = {
    incrementalLiquidity: event.params.liquidity,
    lastUpdatedTimestamp: blockDatetime,
  };

  return nonFungiblePositionDiff;
}

/**
 * Main function to process NFPM.IncreaseLiquidity events.
 * Handles finding the position by tokenId and updating liquidity.
 *
 * Process:
 * 1. Find position by tokenId (should exist - Transfer already promoted placeholder)
 * 2. If not found, log error and return
 * 3. Process increase: newLiquidity = currentLiquidity + event.params.liquidity
 * 4. Update position with new liquidity
 *
 * @param event - The NFPM.IncreaseLiquidity event
 * @param context - The handler context
 * @returns Promise that resolves once the position update, orphan-mint cleanup, and downstream attributions are staged
 */
export async function processNFPMIncreaseLiquidity(
  event: NFPM_IncreaseLiquidity_event,
  context: handlerContext,
): Promise<void> {
  // Transfer (relative to mint) runs before IncreaseLiquidity, so the stable position
  // should already exist. Direct O(1) lookup via (chainId, nfpmAddress, tokenId).
  const position = await context.NonFungiblePosition.get(
    NonFungiblePositionId(
      event.chainId,
      event.srcAddress,
      event.params.tokenId,
    ),
  );

  if (!position) {
    context.log.error(
      `NonFungiblePosition with tokenId ${event.params.tokenId} not found during increase liquidity on chain ${event.chainId}`,
    );
    return;
  }

  // Clean up any orphaned CLPoolMintEvent entities from same transaction
  //
  // Event Flow Explanation:
  // CLPool.Mint is emitted for BOTH new mints AND increases to existing positions.
  //
  // Case 1: NEW MINT transaction flow:
  //   1. CLPool.Mint event → creates CLPoolMintEvent (consumedByTokenId: undefined)
  //   2. NFPM.Transfer event (mint, from=0x0) → finds CLPoolMintEvent, creates NonFungiblePosition, DELETES CLPoolMintEvent
  //   3. NFPM.IncreaseLiquidity event → updates position liquidity
  //   Result: CLPoolMintEvent is already deleted by step 2, so nothing to clean up here.
  //
  // Case 2: INCREASE transaction flow:
  //   1. CLPool.Mint event → creates CLPoolMintEvent (consumedByTokenId: undefined)
  //   2. NO NFPM.Transfer event (position already exists, no new NFT minted)
  //   3. NFPM.IncreaseLiquidity event → updates position liquidity
  //   Result: CLPoolMintEvent remains unconsumed and orphaned. We must delete it here.
  //
  // Therefore, if we find an unconsumed CLPoolMintEvent in the same transaction when processing
  // IncreaseLiquidity, it MUST be from an increase (Case 2), because new mints (Case 1) would
  // have already been deleted by the Transfer handler that runs before IncreaseLiquidity.
  const registryId = TxCLPoolMintRegistryId(
    event.chainId,
    event.transaction.hash,
  );
  const registry = await context.TxCLPoolMintRegistry.get(registryId);

  if (registry && registry.mintEventIds.length > 0) {
    const mintEventsInTx = (
      await Promise.all(
        registry.mintEventIds.map((id) => context.CLPoolMintEvent.get(id)),
      )
    ).filter((m): m is CLPoolMintEvent => m !== undefined);

    const matchingMintEvents = mintEventsInTx.filter(
      (m) =>
        m.chainId === event.chainId &&
        m.pool === position.pool &&
        m.tickLower === position.tickLower &&
        m.tickUpper === position.tickUpper &&
        m.liquidity === event.params.liquidity && // Matches the increase amount
        !m.consumedByTokenId &&
        m.logIndex < event.logIndex,
    );

    // Select closest preceding mint by logIndex (deterministic for multiple matches)
    const matchingMintEvent =
      matchingMintEvents.length > 0
        ? matchingMintEvents.reduce((prev, curr) =>
            curr.logIndex > prev.logIndex ? curr : prev,
          )
        : undefined;

    if (matchingMintEvent) {
      // This matches Case 2 (INCREASE) from the explanation above.
      // The CLPoolMintEvent is orphaned because no Transfer event consumed it.
      // Delete it and prune the registry (drop the row when it empties).
      context.CLPoolMintEvent.deleteUnsafe(matchingMintEvent.id);
      const remaining = registry.mintEventIds.filter(
        (id) => id !== matchingMintEvent.id,
      );
      if (remaining.length === 0) {
        context.TxCLPoolMintRegistry.deleteUnsafe(registryId);
      } else {
        context.TxCLPoolMintRegistry.set({
          id: registryId,
          mintEventIds: remaining,
        });
      }
    }
  }

  // Calculate increase liquidity diff
  const nonFungiblePositionDiff = calculateIncreaseLiquidityDiff(event);
  const timestamp =
    nonFungiblePositionDiff.lastUpdatedTimestamp ??
    new Date(event.block.timestamp * 1000);

  // Update position with result (reuse timestamp from diff as single source of truth)
  updateNonFungiblePosition(
    nonFungiblePositionDiff,
    position,
    context,
    timestamp,
  );

  const poolData = await loadPoolData(
    position.pool,
    event.chainId,
    context,
    event.block.number,
    event.block.timestamp,
  );

  if (!poolData) {
    context.log.warn(
      `[NFPMIncreaseLiquidityLogic] Pool data not found for pool ${position.pool} during increase liquidity for tokenId ${event.params.tokenId} on chain ${event.chainId}`,
    );
    return;
  }

  // Attribute liquidity added to position.owner via UserStatsPerPool
  await attributeLiquidityChangeToUserStatsPerPool(
    position.owner,
    position.pool,
    poolData,
    context,
    event.params.amount0,
    event.params.amount1,
    event.block.timestamp,
    LiquidityChangeType.ADD,
  );

  // If the position is staked, update tick entities and staked reserves
  if (position.isStakedInGauge) {
    await updateStakedPositionLiquidity(
      position,
      poolData,
      event.params.liquidity,
      context,
      timestamp,
      event.chainId,
      event.block.number,
    );
  }
}
