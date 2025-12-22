import type { PublicClient } from "viem";
import type { MockDb } from "../generated/src/TestHelpers.gen";
import type { NonFungiblePosition } from "../generated/src/Types.gen";
import { CHAIN_CONSTANTS } from "../src/Constants";

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

/**
 * Mutates CHAIN_CONSTANTS for a specific chainId and returns the original value
 * along with a cleanup function to restore it.
 *
 * @param chainId - The chain ID to mutate
 * @param value - The new value to set
 * @returns An object containing the original value and a cleanup function
 */
export function mutateChainConstants(
  chainId: number,
  value: { eth_client: PublicClient; lpHelperAddress: string },
): {
  originalValue:
    | { eth_client: PublicClient; lpHelperAddress: string }
    | undefined;
  cleanup: () => void;
} {
  const chainConstants = CHAIN_CONSTANTS as Record<
    number,
    { eth_client: PublicClient; lpHelperAddress: string } | undefined
  >;
  const originalValue = chainConstants[chainId];
  chainConstants[chainId] = value;

  return {
    originalValue,
    cleanup: () => {
      if (originalValue !== undefined) {
        chainConstants[chainId] = originalValue;
      } else {
        delete chainConstants[chainId];
      }
    },
  };
}
