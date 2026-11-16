import type { OUSDTSwaps, Token } from "envio";
import { OUSDTSwapsId } from "../Constants";
import type { handlerContext } from "../EntityTypes";
import { writeSuperSwapDestinationLegsForSwap } from "../EventHandlers/SuperswapsHyperlane/SuperSwapLegLogic";

/**
 * Creates an OUSDTSwaps entity for swap events.
 * Accepts In/Out amounts for both tokens and determines swap direction.
 *
 * Also records the swap in `TxOUSDTSwapRegistry` when it is the first oUSDT
 * swap seen in its transaction (read by primary key by the SuperSwap legs, see
 * `SuperSwapLegLogic.ts`), and then writes the transaction's destination legs.
 *
 * @param transactionHash - Transaction hash of the swap
 * @param chainId - Chain ID of the swap
 * @param token0Instance - Pool token0
 * @param token1Instance - Pool token1
 * @param amount0In - token0 amount going into the pool
 * @param amount0Out - token0 amount leaving the pool
 * @param amount1In - token1 amount going into the pool
 * @param amount1Out - token1 amount leaving the pool
 * @param context - Handler context
 * @returns Promise that resolves once the swap (and, if first in its tx, the registry row) is staged
 */
export async function createOUSDTSwapEntity(
  transactionHash: string,
  chainId: number,
  token0Instance: Token,
  token1Instance: Token,
  amount0In: bigint,
  amount0Out: bigint,
  amount1In: bigint,
  amount1Out: bigint,
  context: handlerContext,
): Promise<void> {
  if (!token0Instance || !token1Instance) {
    return;
  }

  let swap: OUSDTSwaps;
  // Determine which token is going in and which is going out
  if (amount0In > 0n) {
    // Token0 is going in, token1 is going out
    swap = {
      id: OUSDTSwapsId(
        transactionHash,
        chainId,
        token0Instance.address,
        amount0In,
        token1Instance.address,
        amount1Out,
      ),
      transactionHash,
      tokenInPool: token0Instance.address,
      tokenOutPool: token1Instance.address,
      amountIn: amount0In,
      amountOut: amount1Out,
    };
  } else if (amount1In > 0n) {
    // Token1 is going in, token0 is going out
    swap = {
      id: OUSDTSwapsId(
        transactionHash,
        chainId,
        token1Instance.address,
        amount1In,
        token0Instance.address,
        amount0Out,
      ),
      transactionHash,
      tokenInPool: token1Instance.address,
      tokenOutPool: token0Instance.address,
      amountIn: amount1In,
      amountOut: amount0Out,
    };
  } else {
    // If both are 0, no swap occurred, so we don't create an entity
    return;
  }

  context.OUSDTSwaps.set(swap);

  // First writer wins: getWhere returned a tx's rows in the order they were
  // first written, and consumers only ever looked at the first one.
  const registry = await context.TxOUSDTSwapRegistry.get(transactionHash);
  if (registry) {
    return;
  }
  context.TxOUSDTSwapRegistry.set({
    id: transactionHash,
    swapId: swap.id,
    tokenInPool: swap.tokenInPool,
    tokenOutPool: swap.tokenOutPool,
    amountIn: swap.amountIn,
    amountOut: swap.amountOut,
  });
  // The first oUSDT swap of a transaction that processed Hyperlane messages
  // is the destination side of their SuperSwaps (ADR 0009).
  await writeSuperSwapDestinationLegsForSwap(
    chainId,
    transactionHash,
    swap,
    context,
  );
}
