import type { handlerContext } from "generated";
import type { NonFungiblePosition } from "generated";

export const NonFungiblePositionId = (chainId: number, tokenId: bigint) =>
  `${chainId}_${tokenId}`;

/**
 * Updates NonFungiblePosition with the provided diff
 * Uses spread operator to handle immutable entities
 * Handles both replacement (owner, tickUpper, tickLower) and delta (amount0, amount1, amountUSD) updates
 */
export function updateNonFungiblePosition(
  diff: Partial<NonFungiblePosition>,
  current: NonFungiblePosition,
  timestamp: Date,
  context: handlerContext,
): void {
  const nonFungiblePosition: NonFungiblePosition = {
    ...current,
    owner: diff.owner ?? current.owner,
    amount0: (diff.amount0 ?? 0n) + current.amount0,
    amount1: (diff.amount1 ?? 0n) + current.amount1,
    amountUSD: diff.amountUSD ?? current.amountUSD,
    lastUpdatedTimestamp: timestamp,
  };
  context.NonFungiblePosition.set(nonFungiblePosition);
}
