import type { NonFungiblePosition, handlerContext } from "generated";

/**
 * Finds a NonFungiblePosition entity by tokenId, filtering by chainId to avoid cross-chain collisions.
 * This is a shared utility function used across NFPM event handlers.
 *
 * @param tokenId - The token ID to search for
 * @param chainId - The chain ID to filter by
 * @param context - The handler context for database operations
 * @returns Array of matching positions (should be 0 or 1), filtered by chainId
 * @internal
 */
export async function findPositionByTokenId(
  tokenId: bigint,
  chainId: number,
  context: handlerContext,
): Promise<NonFungiblePosition[]> {
  const positions =
    await context.NonFungiblePosition.getWhere.tokenId.eq(tokenId);

  if (!positions || positions.length === 0) {
    return [];
  }

  // Filter by chainId to ensure we get the position from the correct chain
  return positions.filter((pos) => pos.chainId === chainId);
}
