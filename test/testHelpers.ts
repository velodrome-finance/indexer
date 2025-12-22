import type { MockDb } from "../generated/src/TestHelpers.gen";
import type { NonFungiblePosition } from "../generated/src/Types.gen";

/**
 * Extends mockDb with getWhere functionality for NonFungiblePosition queries
 * @param mockDb - The base mock database
 * @param storedNFPMs - Array of NonFungiblePosition entities to query from (defaults to empty array)
 * @param mintTransactionHashHandler - Optional custom handler for mintTransactionHash queries.
 *   If not provided, filters storedNFPMs by transaction hash.
 * @returns Extended mockDb with getWhere functionality
 */
export function extendMockDbWithGetWhere(
  mockDb: ReturnType<typeof MockDb.createMockDb>,
  storedNFPMs: NonFungiblePosition[] = [],
  mintTransactionHashHandler?: (
    txHash: string,
  ) => Promise<NonFungiblePosition[] | null | undefined>,
) {
  return {
    ...mockDb,
    entities: {
      ...mockDb.entities,
      NonFungiblePosition: {
        ...mockDb.entities.NonFungiblePosition,
        getWhere: {
          tokenId: {
            eq: async () => [],
          },
          mintTransactionHash: {
            eq:
              mintTransactionHashHandler ||
              (async (txHash: string) => {
                return storedNFPMs.filter(
                  (entity) => entity.mintTransactionHash === txHash,
                );
              }),
          },
        },
      },
    },
  };
}
