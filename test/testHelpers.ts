import type { DispatchId_event, OUSDTSwaps, createTestIndexer } from "envio";
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
  };
  indexer.Pool.set(mockPool);
}

/**
 * Seeds an OUSDTSwaps row on the test indexer the way the swap handlers write
 * it: the swap itself plus, when it is the first oUSDT swap of its tx, the
 * TxOUSDTSwapRegistry row the SuperSwap stitching reads.
 *
 * @param indexer - The test indexer to seed
 * @param swap - The OUSDTSwaps row
 * @returns Promise that resolves once both rows are staged
 */
export async function seedOUSDTSwap(
  indexer: ReturnType<typeof createTestIndexer>,
  swap: OUSDTSwaps,
): Promise<void> {
  indexer.OUSDTSwaps.set(swap);
  if (await indexer.TxOUSDTSwapRegistry.get(swap.transactionHash)) return;
  indexer.TxOUSDTSwapRegistry.set({
    id: swap.transactionHash,
    swapId: swap.id,
    tokenInPool: swap.tokenInPool,
    tokenOutPool: swap.tokenOutPool,
    amountIn: swap.amountIn,
    amountOut: swap.amountOut,
  });
}

/**
 * Seeds a DispatchId_event row on the test indexer the way the Mailbox
 * DispatchId handler writes it: the row plus its messageId appended to the
 * tx's TxDispatchIdRegistry.
 *
 * @param indexer - The test indexer to seed
 * @param dispatch - The DispatchId_event row
 * @returns Promise that resolves once both rows are staged
 */
export async function seedDispatchIdEvent(
  indexer: ReturnType<typeof createTestIndexer>,
  dispatch: DispatchId_event,
): Promise<void> {
  indexer.DispatchId_event.set(dispatch);
  const registry = await indexer.TxDispatchIdRegistry.get(
    dispatch.transactionHash,
  );
  indexer.TxDispatchIdRegistry.set({
    id: dispatch.transactionHash,
    messageIds: [...(registry?.messageIds ?? []), dispatch.messageId],
  });
}
