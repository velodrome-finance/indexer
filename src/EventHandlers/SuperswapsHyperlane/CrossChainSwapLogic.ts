import type {
  DispatchId_event,
  ProcessId_event,
  SuperSwap,
  handlerContext,
  oUSDTBridgedTransaction,
  oUSDTSwaps,
} from "generated";
import { OUSDT_ADDRESS } from "../../Constants";

/**
 * Builds a map from messageId to ProcessId event and collects unique destination transaction hashes.
 * Also logs warnings for messageIds without corresponding ProcessId events.
 * @param sourceChainMessageIdEntities - DispatchId events from the source chain transaction
 * @param processIdResults - ProcessId events queried for each messageId (array of arrays)
 * @param context - Handler context for queries and entity operations
 * @returns A map from messageId to ProcessId event and a set of unique destination transaction hashes
 */
export function buildMessageIdToProcessIdMap(
  sourceChainMessageIdEntities: DispatchId_event[],
  processIdResults: ProcessId_event[][],
  context: handlerContext,
): {
  messageIdToProcessId: Map<string, ProcessId_event>;
  destinationTransactionHashes: Set<string>;
} {
  const destinationTransactionHashes = new Set<string>();
  const messageIdToProcessId = new Map<string, ProcessId_event>();

  // Flatten all ProcessId results and match by messageId field (not array index)
  const allProcessIdEvents = processIdResults.flat();
  for (const processIdEvent of allProcessIdEvents) {
    messageIdToProcessId.set(processIdEvent.messageId, processIdEvent);
    destinationTransactionHashes.add(processIdEvent.transactionHash);
  }

  // Warn for messageIds that have no ProcessId events
  for (const sourceEntity of sourceChainMessageIdEntities) {
    if (!messageIdToProcessId.has(sourceEntity.messageId)) {
      context.log.warn(
        `No ProcessId_event found for messageId ${sourceEntity.messageId}`,
      );
    }
  }

  return { messageIdToProcessId, destinationTransactionHashes };
}

/**
 * Finds the source chain swap where oUSDT is involved.
 * @param transactionHash - The transaction hash of the source chain transaction
 * @param context - Handler context for queries and entity operations
 * @returns The swap and extracts the source chain token information.
 * @throws An error if no source chain swap with oUSDT is found
 */
export async function findSourceSwapWithOUSDT(
  transactionHash: string,
  context: handlerContext,
): Promise<{
  swap: oUSDTSwaps;
  sourceChainToken: string;
  sourceChainTokenAmountSwapped: bigint;
} | null> {
  const sourceChainSwaps =
    await context.oUSDTSwaps.getWhere.transactionHash.eq(transactionHash);

  // Since we only store swaps involving oUSDT, take the first swap
  // (all stored swaps should involve oUSDT, but verify for safety)
  if (sourceChainSwaps.length === 0) {
    context.log.warn(
      `No source chain swap with oUSDT found for transaction ${transactionHash}`,
    );
    return null;
  }

  const sourceSwap = sourceChainSwaps[0];

  // Safety check: verify the swap involves oUSDT
  if (
    sourceSwap.tokenInPool !== OUSDT_ADDRESS &&
    sourceSwap.tokenOutPool !== OUSDT_ADDRESS
  ) {
    context.log.warn(
      `Source swap does not involve oUSDT for transaction ${transactionHash}`,
    );
    return null;
  }

  // Determine source chain token (the non-oUSDT token)
  const sourceChainToken =
    sourceSwap.tokenInPool === OUSDT_ADDRESS
      ? sourceSwap.tokenOutPool
      : sourceSwap.tokenInPool;
  const sourceChainTokenAmountSwapped =
    sourceSwap.tokenInPool === OUSDT_ADDRESS
      ? sourceSwap.amountOut
      : sourceSwap.amountIn;

  return {
    swap: sourceSwap,
    sourceChainToken,
    sourceChainTokenAmountSwapped,
  };
}

/**
 * Loads all destination swaps for the given transaction hashes in parallel.
 * Returns a map from transaction hash to swaps array.
 * @param destinationTransactionHashes - A set of unique destination transaction hashes
 * @param context - Handler context for queries and entity operations
 * @returns A map from transaction hash to swaps array
 */
export async function loadDestinationSwaps(
  destinationTransactionHashes: Set<string>,
  context: handlerContext,
): Promise<Map<string, oUSDTSwaps[]>> {
  const transactionHashesArray = Array.from(destinationTransactionHashes);
  const swapPromises = transactionHashesArray.map((txHash) =>
    context.oUSDTSwaps.getWhere.transactionHash.eq(txHash),
  );
  const swapResults = await Promise.all(swapPromises);

  // Build map in single pass: O(T) instead of O(2T) from Array.from + forEach
  const transactionHashToSwaps = new Map<string, oUSDTSwaps[]>();
  for (let i = 0; i < transactionHashesArray.length; i++) {
    transactionHashToSwaps.set(transactionHashesArray[i], swapResults[i]);
  }

  return transactionHashToSwaps;
}

/**
 * Finds the destination swap with oUSDT and the matching messageId.
 * Returns the swap and extracts the destination chain token information.
 * @param sourceChainMessageIdEntities - DispatchId events from the source chain transaction
 * @param messageIdToProcessId - A map from messageId to ProcessId event
 * @param transactionHashToSwaps - A map from transaction hash to swaps array
 * @param context - Handler context for queries and entity operations
 * @returns The swap and extracts the destination chain token information.
 * @throws An error if no destination chain swap with oUSDT is found
 */
export function findDestinationSwapWithOUSDT(
  sourceChainMessageIdEntities: DispatchId_event[],
  messageIdToProcessId: Map<string, ProcessId_event>,
  transactionHashToSwaps: Map<string, oUSDTSwaps[]>,
  context: handlerContext,
): {
  destinationSwap: oUSDTSwaps;
  matchingMessageId: string;
  destinationChainToken: string;
  destinationChainTokenAmountSwapped: bigint;
} | null {
  for (const sourceChainMessageIdEntity of sourceChainMessageIdEntities) {
    const processIdEvent = messageIdToProcessId.get(
      sourceChainMessageIdEntity.messageId,
    );

    // Skip if no ProcessId event is found for the messageId being processed
    if (!processIdEvent) {
      context.log.warn(
        `No ProcessId event found for messageId ${sourceChainMessageIdEntity.messageId}`,
      );
      continue;
    }

    const destinationSwaps = transactionHashToSwaps.get(
      processIdEvent.transactionHash,
    );

    if (!destinationSwaps || destinationSwaps.length === 0) {
      context.log.warn(
        `No destination swaps found for transaction hash ${processIdEvent.transactionHash}`,
      );
      continue;
    }

    // Since we only store swaps involving oUSDT, take the first swap
    // (all stored swaps should involve oUSDT, but verify for safety)
    if (destinationSwaps.length === 0) {
      context.log.warn(
        `No destination chain swap with oUSDT found for transaction hash ${processIdEvent.transactionHash}`,
      );
      continue;
    }

    const destinationChainSwapWithOUSDT = destinationSwaps[0];

    // Safety check: verify the swap involves oUSDT
    if (
      destinationChainSwapWithOUSDT.tokenInPool !== OUSDT_ADDRESS &&
      destinationChainSwapWithOUSDT.tokenOutPool !== OUSDT_ADDRESS
    ) {
      context.log.warn(
        `Destination swap does not involve oUSDT for transaction hash ${processIdEvent.transactionHash}`,
      );
      continue;
    }

    // Determine destination chain token (the non-oUSDT token)
    const destinationChainToken =
      destinationChainSwapWithOUSDT.tokenInPool === OUSDT_ADDRESS
        ? destinationChainSwapWithOUSDT.tokenOutPool
        : destinationChainSwapWithOUSDT.tokenInPool;
    const destinationChainTokenAmountSwapped =
      destinationChainSwapWithOUSDT.tokenInPool === OUSDT_ADDRESS
        ? destinationChainSwapWithOUSDT.amountOut
        : destinationChainSwapWithOUSDT.amountIn;

    return {
      destinationSwap: destinationChainSwapWithOUSDT,
      matchingMessageId: sourceChainMessageIdEntity.messageId,
      destinationChainToken,
      destinationChainTokenAmountSwapped,
    };
  }

  context.log.warn(
    "No destination chain swap with oUSDT found for any ProcessId transaction",
  );
  return null;
}

/**
 * Creates a SuperSwap entity linking source and destination chain swaps.
 * @param transactionHash - The transaction hash of the source chain transaction
 * @param chainId - The chain ID of the source chain
 * @param destinationDomain - The destination domain ID
 * @param bridgedTransaction - The oUSDT bridged transaction data
 * @param messageId - The message ID of the source chain transaction
 * @param sourceSwap - The source chain swap
 * @param sourceChainToken - The source chain token
 * @param sourceChainTokenAmountSwapped - The source chain token amount swapped
 * @param destinationChainToken - The destination chain token
 * @param destinationChainTokenAmountSwapped - The destination chain token amount swapped
 * @param blockTimestamp - The block timestamp in seconds
 * @param context - Handler context for queries and entity operations
 */
export function createSuperSwapEntity(
  transactionHash: string,
  chainId: number,
  destinationDomain: bigint,
  bridgedTransaction: oUSDTBridgedTransaction,
  messageId: string,
  sourceSwap: oUSDTSwaps,
  sourceChainToken: string,
  sourceChainTokenAmountSwapped: bigint,
  destinationChainToken: string,
  destinationChainTokenAmountSwapped: bigint,
  blockTimestamp: number,
  context: handlerContext,
): void {
  const superSwapEntity: SuperSwap = {
    id: `${transactionHash}_${BigInt(chainId)}_${destinationDomain}_${bridgedTransaction.amount}_${messageId}_${sourceSwap.tokenInPool}_${sourceSwap.amountIn}_${sourceSwap.tokenOutPool}_${sourceSwap.amountOut}`,
    originChainId: BigInt(chainId),
    destinationChainId: destinationDomain,
    sender: bridgedTransaction.sender,
    recipient: bridgedTransaction.recipient,
    oUSDTamount: bridgedTransaction.amount,
    sourceChainToken: sourceChainToken,
    sourceChainTokenAmountSwapped: sourceChainTokenAmountSwapped,
    destinationChainToken: destinationChainToken,
    destinationChainTokenAmountSwapped: destinationChainTokenAmountSwapped,
    timestamp: new Date(blockTimestamp * 1000),
  };

  context.SuperSwap.set(superSwapEntity);
}

/**
 * Processes cross-chain swap events to create SuperSwap entities.
 * Maps DispatchId events to ProcessId events, loads swap data, and creates SuperSwap entities.
 *
 * @param sourceChainMessageIdEntities - DispatchId events from the source chain transaction
 * @param processIdResults - ProcessId events queried for each messageId (array of arrays)
 * @param bridgedTransaction - oUSDT bridged transaction data
 * @param transactionHash - Source transaction hash
 * @param chainId - Origin chain ID
 * @param destinationDomain - Destination chain domain ID
 * @param blockTimestamp - Block timestamp in seconds
 * @param context - Handler context for queries and entity operations
 * @returns A promise that resolves when the SuperSwap entity is created
 * @throws An error if no source chain swap with oUSDT is found or no destination chain swap with oUSDT is found
 */
export async function processCrossChainSwap(
  sourceChainMessageIdEntities: DispatchId_event[],
  processIdResults: ProcessId_event[][],
  bridgedTransaction: oUSDTBridgedTransaction,
  transactionHash: string,
  chainId: number,
  destinationDomain: bigint,
  blockTimestamp: number,
  context: handlerContext,
): Promise<void> {
  // Build messageId to ProcessId mapping
  const { messageIdToProcessId, destinationTransactionHashes } =
    buildMessageIdToProcessIdMap(
      sourceChainMessageIdEntities,
      processIdResults,
      context,
    );

  // Find source swap with oUSDT
  const sourceSwapData = await findSourceSwapWithOUSDT(
    transactionHash,
    context,
  );
  if (!sourceSwapData) {
    context.log.warn(
      `No source chain swap with oUSDT found for transaction ${transactionHash}`,
    );
    return;
  }

  // Load destination swaps
  const transactionHashToSwaps = await loadDestinationSwaps(
    destinationTransactionHashes,
    context,
  );

  // Find destination swap with oUSDT
  const destinationSwapData = findDestinationSwapWithOUSDT(
    sourceChainMessageIdEntities,
    messageIdToProcessId,
    transactionHashToSwaps,
    context,
  );
  if (!destinationSwapData) {
    return;
  }

  // Create SuperSwap entity
  createSuperSwapEntity(
    transactionHash,
    chainId,
    destinationDomain,
    bridgedTransaction,
    destinationSwapData.matchingMessageId,
    sourceSwapData.swap,
    sourceSwapData.sourceChainToken,
    sourceSwapData.sourceChainTokenAmountSwapped,
    destinationSwapData.destinationChainToken,
    destinationSwapData.destinationChainTokenAmountSwapped,
    blockTimestamp,
    context,
  );
}
