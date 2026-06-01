import type { createTestIndexer } from "envio";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, PoolId } from "../src/Constants";
import type { Pool } from "../src/EntityTypes";

/** Cast string to V3 Address type for mock event data */
export const asAddress = (s: string): `0x${string}` => s as `0x${string}`;

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
 * Helper function to seed a Pool on the test indexer.
 *
 * @param indexer - The test indexer to seed
 * @param mockLiquidityPoolData - Base liquidity pool data
 * @param poolAddress - The pool address
 * @returns void; the Pool is staged on the indexer in place
 */
export function setupPool(
  indexer: ReturnType<typeof createTestIndexer>,
  mockLiquidityPoolData: Pool,
  poolAddress: string,
): void {
  const poolId = PoolId(mockLiquidityPoolData.chainId, poolAddress);
  const mockPool = {
    ...mockLiquidityPoolData,
    id: poolId,
    poolAddress: poolAddress,
    isCL: mockLiquidityPoolData.isCL ?? true,
    // Array fields: force mutable bigint[] (envio types use readonly; set() wants mutable).
    stakedTickEdges: [...mockLiquidityPoolData.stakedTickEdges],
    stakedTickEdgeNets: [...mockLiquidityPoolData.stakedTickEdgeNets],
    tickEdges: [...mockLiquidityPoolData.tickEdges],
    tickEdgeNets: [...mockLiquidityPoolData.tickEdgeNets],
  };
  indexer.Pool.set(mockPool);
}
