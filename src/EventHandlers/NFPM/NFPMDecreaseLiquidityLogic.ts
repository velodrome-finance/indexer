import type { NFPM_DecreaseLiquidity_event, handlerContext } from "generated";
import { loadPoolData } from "../../Aggregators/LiquidityPoolAggregator";
import {
  type NonFungiblePositionDiff,
  updateNonFungiblePosition,
} from "../../Aggregators/NonFungiblePosition";
import { NonFungiblePositionId } from "../../Constants";
import {
  LiquidityChangeType,
  attributeLiquidityChangeToUserStatsPerPool,
  updateStakedPositionLiquidity,
} from "./NFPMCommonLogic";

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
  // Transfer runs before DecreaseLiquidity, so the stable position should already exist.
  // Direct O(1) lookup via (chainId, nfpmAddress, tokenId).
  const position = await context.NonFungiblePosition.get(
    NonFungiblePositionId(
      event.chainId,
      event.srcAddress,
      event.params.tokenId,
    ),
  );

  // This should never happen
  if (!position) {
    context.log.error(
      `NonFungiblePosition with tokenId ${event.params.tokenId} not found during decrease liquidity on chain ${event.chainId}`,
    );
    return;
  }

  // Calculate decrease liquidity diff
  const nonFungiblePositionDiff = calculateDecreaseLiquidityDiff(event);

  // Update position with result
  const timestamp = new Date(event.block.timestamp * 1000);
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
      `[NFPMDecreaseLiquidityLogic] Pool data not found for pool ${position.pool} during decrease liquidity for tokenId ${event.params.tokenId} on chain ${event.chainId}`,
    );
    return;
  }

  // Attribute liquidity removed to position.owner via UserStatsPerPool
  await attributeLiquidityChangeToUserStatsPerPool(
    position.owner,
    position.pool,
    poolData,
    context,
    event.params.amount0,
    event.params.amount1,
    event.block.timestamp,
    LiquidityChangeType.REMOVE,
  );

  // If the position is staked, update tick entities and staked reserves
  if (position.isStakedInGauge) {
    await updateStakedPositionLiquidity(
      position,
      poolData,
      -event.params.liquidity,
      context,
      timestamp,
      event.chainId,
      event.block.number,
    );
  }
}
