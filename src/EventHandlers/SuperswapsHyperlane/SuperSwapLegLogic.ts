/**
 * Per-side SuperSwap rows (ADR 0009 flow G, step 2).
 *
 * Each chain writes its own leg from its own rows only, keyed by the Hyperlane
 * message id: the origin chain at CrossChainSwap (`SuperSwapOriginLeg`), the
 * destination chain at the first oUSDT swap of a transaction that processed
 * messages (`SuperSwapDestinationLeg`). The analytics layer joins them on the
 * message id (`super_swap_legs`), which replaces the `SuperSwap` entity the
 * cross-chain stitching wrote before the per-chain flip.
 */
import type { OUSDTSwaps } from "envio";
import { OUSDT_ADDRESS } from "../../Constants";
import type { handlerContext } from "../../EntityTypes";

/**
 * Entity id of a SuperSwap leg: `{chainId}-{messageId}`.
 *
 * @param chainId - Chain of the leg
 * @param messageId - Hyperlane message id
 * @returns The id
 */
export const SuperSwapLegId = (chainId: number, messageId: string) =>
  `${chainId}-${messageId}`;

/**
 * Entity id of a TxProcessIdRegistry row: `{chainId}-{transactionHash}`.
 *
 * @param chainId - Chain of the transaction
 * @param transactionHash - The transaction
 * @returns The id
 */
export const TxProcessIdRegistryId = (
  chainId: number,
  transactionHash: string,
) => `${chainId}-${transactionHash}`;

/**
 * The non-oUSDT side of an oUSDT swap: the token sold for oUSDT (origin) or
 * bought with it (destination) and its amount, as the SuperSwap stitching
 * stitching read it. Undefined when the swap does not involve oUSDT.
 *
 * @param swap - An OUSDTSwaps row (or the registry's copy of it)
 * @returns The token and amount, or undefined
 */
export function nonOUSDTSide(
  swap: Pick<
    OUSDTSwaps,
    "tokenInPool" | "tokenOutPool" | "amountIn" | "amountOut"
  >,
): { token: string; amount: bigint } | undefined {
  if (swap.tokenInPool === OUSDT_ADDRESS) {
    return { token: swap.tokenOutPool, amount: swap.amountOut };
  }
  if (swap.tokenOutPool === OUSDT_ADDRESS) {
    return { token: swap.tokenInPool, amount: swap.amountIn };
  }
  return undefined;
}

/**
 * Writes the origin legs of a CrossChainSwap: one row per message the
 * transaction dispatched (in dispatch order), with the bridge and the
 * transaction's first oUSDT swap. Nothing when the bridge is not oUSDT, the
 * transaction dispatched nothing or swapped no oUSDT (the conditions under
 * which the former stitching created no SuperSwap either).
 *
 * @param chainId - Origin chain
 * @param transactionHash - The CrossChainSwap transaction
 * @param destinationChainId - EVM chain id of the destination
 * @param blockTimestamp - Block time in seconds
 * @param context - Handler context
 * @returns Promise resolving to the number of legs written
 */
export async function writeSuperSwapOriginLegs(
  chainId: number,
  transactionHash: string,
  destinationChainId: bigint,
  blockTimestamp: number,
  context: handlerContext,
): Promise<number> {
  const [bridge, dispatches, swap] = await Promise.all([
    context.OUSDTBridgedTransaction.get(transactionHash),
    context.TxDispatchIdRegistry.get(transactionHash),
    context.TxOUSDTSwapRegistry.get(transactionHash),
  ]);
  const side = swap ? nonOUSDTSide(swap) : undefined;
  if (!bridge || !dispatches || dispatches.messageIds.length === 0 || !side) {
    return 0;
  }
  dispatches.messageIds.forEach((messageId, dispatchIndex) => {
    context.SuperSwapOriginLeg.set({
      id: SuperSwapLegId(chainId, messageId),
      messageId,
      dispatchIndex,
      transactionHash,
      destinationChainId,
      sender: bridge.sender,
      recipient: bridge.recipient,
      oUSDTamount: bridge.amount,
      sourceChainToken: side.token,
      sourceChainTokenAmountSwapped: side.amount,
      timestamp: new Date(blockTimestamp * 1000),
    });
  });
  return dispatches.messageIds.length;
}

/**
 * Records a processed message (Mailbox.ProcessId) under its transaction and,
 * when the transaction's first oUSDT swap is already recorded, writes the
 * destination legs. (Hyperlane emits ProcessId before it calls the recipient,
 * so the swap normally comes later in the same transaction and
 * {@link writeSuperSwapDestinationLegsForSwap} writes them.)
 *
 * @param chainId - Destination chain
 * @param transactionHash - The ProcessId transaction
 * @param messageId - The processed message
 * @param blockTimestamp - Block time in seconds
 * @param context - Handler context
 * @returns Promise that resolves once the registry (and any legs) are staged
 */
export async function recordProcessedMessage(
  chainId: number,
  transactionHash: string,
  messageId: string,
  blockTimestamp: number,
  context: handlerContext,
): Promise<void> {
  const id = TxProcessIdRegistryId(chainId, transactionHash);
  const [registry, swap] = await Promise.all([
    context.TxProcessIdRegistry.get(id),
    context.TxOUSDTSwapRegistry.get(transactionHash),
  ]);
  const messageIds = registry?.messageIds.includes(messageId)
    ? registry.messageIds
    : [...(registry?.messageIds ?? []), messageId];
  const timestamp = new Date(blockTimestamp * 1000);
  context.TxProcessIdRegistry.set({ id, messageIds, timestamp });
  const side = swap ? nonOUSDTSide(swap) : undefined;
  if (side) {
    writeDestinationLegs(
      chainId,
      transactionHash,
      [messageId],
      side,
      timestamp,
      context,
    );
  }
}

/**
 * At the first oUSDT swap of a transaction: writes a destination leg for every
 * message the transaction processed.
 *
 * @param chainId - Chain of the swap
 * @param transactionHash - The swap's transaction
 * @param swap - The transaction's first oUSDT swap
 * @param context - Handler context
 * @returns Promise that resolves once the legs (if any) are staged
 */
export async function writeSuperSwapDestinationLegsForSwap(
  chainId: number,
  transactionHash: string,
  swap: Pick<
    OUSDTSwaps,
    "tokenInPool" | "tokenOutPool" | "amountIn" | "amountOut"
  >,
  context: handlerContext,
): Promise<void> {
  const registry = await context.TxProcessIdRegistry.get(
    TxProcessIdRegistryId(chainId, transactionHash),
  );
  const side = nonOUSDTSide(swap);
  if (!registry || !side) {
    return;
  }
  writeDestinationLegs(
    chainId,
    transactionHash,
    registry.messageIds,
    side,
    registry.timestamp,
    context,
  );
}

/**
 * Stages one destination leg per message.
 *
 * @param chainId - Destination chain
 * @param transactionHash - Destination transaction
 * @param messageIds - Messages processed in it
 * @param side - Token and amount received for oUSDT
 * @param timestamp - Block time
 * @param context - Handler context
 * @returns Nothing; the legs are staged
 */
function writeDestinationLegs(
  chainId: number,
  transactionHash: string,
  messageIds: readonly string[],
  side: { token: string; amount: bigint },
  timestamp: Date,
  context: handlerContext,
): void {
  for (const messageId of messageIds) {
    context.SuperSwapDestinationLeg.set({
      id: SuperSwapLegId(chainId, messageId),
      messageId,
      transactionHash,
      destinationChainToken: side.token,
      destinationChainTokenAmountSwapped: side.amount,
      timestamp,
    });
  }
}
