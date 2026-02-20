import type { LiquidityPoolAggregator, NonFungiblePosition } from "generated";
import type { PublicClient } from "viem";
import type { MockDb } from "../generated/src/TestHelpers.gen";
import { CHAIN_CONSTANTS, PoolId, toChecksumAddress } from "../src/Constants";

/** Cast string to V3 Address type for mock event data */
export const asAddress = (s: string): `0x${string}` => s as `0x${string}`;

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
        getWhere: vi.fn().mockImplementation(
          async (filter: {
            tokenId?: { _eq: bigint };
            mintTransactionHash?: { _eq: string };
          }) => {
            if (filter.mintTransactionHash?._eq !== undefined) {
              const result = mintTransactionHashHandler
                ? await mintTransactionHashHandler(
                    filter.mintTransactionHash._eq,
                  )
                : storedNFPMs.filter(
                    (entity) =>
                      entity.mintTransactionHash ===
                      filter.mintTransactionHash?._eq,
                  );
              return result ?? [];
            }
            if (filter.tokenId?._eq !== undefined) {
              return storedNFPMs.filter(
                (entity) => entity.tokenId === filter.tokenId?._eq,
              );
            }
            return [];
          },
        ),
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

/**
 * Helper function to set up LiquidityPoolAggregator on a mockDb.
 * Returns the updated mockDb.
 *
 * @param mockDb - The mock database to update
 * @param mockLiquidityPoolData - Base liquidity pool data
 * @param poolAddress - The pool address
 * @returns The updated mockDb with LiquidityPoolAggregator set
 */
export function setupLiquidityPoolAggregator(
  mockDb: ReturnType<typeof MockDb.createMockDb>,
  mockLiquidityPoolData: LiquidityPoolAggregator,
  poolAddress: string,
): ReturnType<typeof MockDb.createMockDb> {
  const poolId = PoolId(mockLiquidityPoolData.chainId, poolAddress);
  const mockLiquidityPoolAggregator = {
    ...mockLiquidityPoolData,
    id: poolId,
    poolAddress: poolAddress,
    isCL: mockLiquidityPoolData.isCL ?? true,
  };
  return mockDb.entities.LiquidityPoolAggregator.set(
    mockLiquidityPoolAggregator,
  );
}
