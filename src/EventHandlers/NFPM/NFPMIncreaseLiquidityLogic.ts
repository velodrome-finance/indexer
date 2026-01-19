import type {
  CLPoolMintEvent,
  NFPM_IncreaseLiquidity_event,
  NonFungiblePosition,
  handlerContext,
} from "generated";
import {
  type NonFungiblePositionDiff,
  updateNonFungiblePosition,
} from "../../Aggregators/NonFungiblePosition";
import { findPositionByTokenId } from "./NFPMCommonLogic";

/**
 * Calculates the liquidity diff for an IncreaseLiquidity event.
 * Computes new liquidity by adding the event's liquidity to the current liquidity.
 *
 * Note: amount0, amount1, amountUSD are removed from schema - compute on-demand from liquidity + sqrtPriceX96 + ticks.
 *
 * @param event - The IncreaseLiquidity event
 * @param position - The position to update
 * @returns Partial position object containing the updated liquidity and timestamp fields
 * @internal
 */
export function _calculateIncreaseLiquidityDiff(
  event: NFPM_IncreaseLiquidity_event,
): Partial<NonFungiblePositionDiff> {
  const blockDatetime = new Date(event.block.timestamp * 1000);

  // Update position with increased liquidity
  // Note: amount0, amount1, amountUSD removed from schema - compute on-demand from liquidity + sqrtPriceX96 + ticks
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
 */
export async function processNFPMIncreaseLiquidity(
  event: NFPM_IncreaseLiquidity_event,
  context: handlerContext,
): Promise<void> {
  // Get position by tokenId
  // Transfer (i.e. relative to mint) should have already run and updated the placeholder, so position should exist when an IncreaseLiquidity event is processed
  // Filter by chainId to avoid cross-chain collisions (same tokenId can exist on different chains)
  const positions = await findPositionByTokenId(
    event.params.tokenId,
    event.chainId,
    context,
  );

  if (positions.length === 0) {
    context.log.error(
      `NonFungiblePosition with tokenId ${event.params.tokenId} not found during increase liquidity on chain ${event.chainId}`,
    );
    return;
  }

  const position = positions[0];

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
  const mintEventsInTx =
    await context.CLPoolMintEvent.getWhere.transactionHash.eq(
      event.transaction.hash,
    );

  if (mintEventsInTx && mintEventsInTx.length > 0) {
    const matchingMintEvent = mintEventsInTx.find(
      (m: CLPoolMintEvent) =>
        m.chainId === event.chainId &&
        m.pool === position.pool &&
        m.tickLower === position.tickLower &&
        m.tickUpper === position.tickUpper &&
        m.liquidity === event.params.liquidity && // Matches the increase amount
        !m.consumedByTokenId &&
        m.logIndex < event.logIndex,
    );

    if (matchingMintEvent) {
      // This matches Case 2 (INCREASE) from the explanation above.
      // The CLPoolMintEvent is orphaned because no Transfer event consumed it.
      // Delete it to prevent accumulation of temporary entities.
      context.CLPoolMintEvent.deleteUnsafe(matchingMintEvent.id);
    }
  }

  // Calculate increase liquidity diff
  const nonFungiblePositionDiff = _calculateIncreaseLiquidityDiff(event);

  // Update position with result
  updateNonFungiblePosition(nonFungiblePositionDiff, position, context);
}
