import type { OUSDTSwaps, createTestIndexer } from "envio";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, PoolId } from "../src/Constants";
import type { Pool } from "../src/EntityTypes";

/**
 * An entity as the test indexer stores it in per-chain mode (ADR 0009): the
 * handler type plus envio's own `chainId`, which `indexer.X.set` requires and
 * rows read back from the test indexer carry.
 */
export type WithChain<T> = T & { readonly chainId: number };

/** Cast string to V3 Address type for mock event data */
export const asAddress = (s: string): `0x${string}` => s as `0x${string}`;

/**
 * A copy of a chain's constants whose legacy reward-token lookup is replaced.
 *
 * @param constants - The chain's CHAIN_CONSTANTS entry (must have a legacy deployment)
 * @param rewardToken - Replacement `legacy.rewardToken`
 * @returns The patched copy, to assign back into CHAIN_CONSTANTS
 */
export function withLegacyRewardToken(
  constants: (typeof CHAIN_CONSTANTS)[number],
  rewardToken: (blockNumber: number) => string,
): (typeof CHAIN_CONSTANTS)[number] {
  if (!constants.legacy) throw new Error("chain has no legacy deployment");
  return { ...constants, legacy: { ...constants.legacy, rewardToken } };
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
  value: { eth_client: PublicClient; legacy: { lpHelperAddress: string } },
): {
  originalValue:
    | { eth_client: PublicClient; legacy: { lpHelperAddress: string } }
    | undefined;
  cleanup: () => void;
} {
  const chainConstants = CHAIN_CONSTANTS as unknown as Record<
    number,
    | { eth_client: PublicClient; legacy: { lpHelperAddress: string } }
    | undefined
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
  mockLiquidityPoolData: WithChain<Pool>,
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
 * TxOUSDTSwapRegistry row the SuperSwap legs read.
 *
 * @param indexer - The test indexer to seed
 * @param swap - The OUSDTSwaps row
 * @param chainId - Chain of the swap
 * @returns Promise that resolves once both rows are staged
 */
export async function seedOUSDTSwap(
  indexer: ReturnType<typeof createTestIndexer>,
  swap: OUSDTSwaps,
  chainId: number,
): Promise<void> {
  indexer.OUSDTSwaps.set({ ...swap, chainId });
  if (await indexer.TxOUSDTSwapRegistry.get(swap.transactionHash)) return;
  indexer.TxOUSDTSwapRegistry.set({
    chainId,
    id: swap.transactionHash,
    swapId: swap.id,
    tokenInPool: swap.tokenInPool,
    tokenOutPool: swap.tokenOutPool,
    amountIn: swap.amountIn,
    amountOut: swap.amountOut,
  });
}

/**
 * Seeds a dispatched Hyperlane message the way the Mailbox DispatchId handler
 * records it: its messageId appended to the tx's TxDispatchIdRegistry.
 *
 * @param indexer - The test indexer to seed
 * @param chainId - Origin chain
 * @param transactionHash - The dispatching transaction
 * @param messageId - The message id
 * @returns Promise that resolves once the registry row is staged
 */
export async function seedDispatchedMessage(
  indexer: ReturnType<typeof createTestIndexer>,
  chainId: number,
  transactionHash: string,
  messageId: string,
): Promise<void> {
  const registry = await indexer.TxDispatchIdRegistry.get(transactionHash);
  indexer.TxDispatchIdRegistry.set({
    chainId,
    id: transactionHash,
    messageIds: [...(registry?.messageIds ?? []), messageId],
  });
}
