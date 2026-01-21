import type { NFPM_DecreaseLiquidity_event, handlerContext } from "generated";
import {
  type NonFungiblePositionDiff,
  updateNonFungiblePosition,
} from "../../Aggregators/NonFungiblePosition";
import { findPositionByTokenId } from "./NFPMCommonLogic";

/**
 * Calculates the liquidity diff for a DecreaseLiquidity event.
 * Computes new liquidity by subtracting the event's liquidity from the current liquidity.
 *
 * @param event - The DecreaseLiquidity event
 * @param position - The position to update
 * @returns Partial position object containing the updated liquidity and timestamp fields
 */
export function calculateDecreaseLiquidityDiff(
  event: NFPM_DecreaseLiquidity_event,
): Partial<NonFungiblePositionDiff> {
  const blockDatetime = new Date(event.block.timestamp * 1000);

  // Update position with decreased liquidity
  const nonFungiblePositionDiff = {
    incrementalLiquidity: -event.params.liquidity,
    lastUpdatedTimestamp: blockDatetime,
  };

  return nonFungiblePositionDiff;
}

/**
 * Main function to process NFPM.DecreaseLiquidity events.
 * Handles finding the position by tokenId and updating liquidity.
 *
 * Process:
 * 1. Find position by tokenId (should always exist - Transfer already promoted placeholder)
 * 2. If not found, log error and return
 * 3. Process decrease: newLiquidity = max(0, currentLiquidity - event.params.liquidity)
 * 4. Update position with new liquidity
 *
 * @param event - The NFPM.DecreaseLiquidity event
 * @param context - The handler context
 */
export async function processNFPMDecreaseLiquidity(
  event: NFPM_DecreaseLiquidity_event,
  context: handlerContext,
): Promise<void> {
  // Get position by tokenId
  // Transfer should have already run and updated the placeholder, so position should exist when a DecreaseLiquidity event is processed
  // Filter by chainId to avoid cross-chain collisions (same tokenId can exist on different chains)
  const positions = await findPositionByTokenId(
    event.params.tokenId,
    event.chainId,
    context,
  );

  // This should never happen
  if (positions.length === 0) {
    context.log.error(
      `NonFungiblePosition with tokenId ${event.params.tokenId} not found during decrease liquidity on chain ${event.chainId}`,
    );
    return;
  }

  const position = positions[0];

  // Calculate decrease liquidity diff
  const nonFungiblePositionDiff = calculateDecreaseLiquidityDiff(event);

  updateNonFungiblePosition(nonFungiblePositionDiff, position, context);
}
