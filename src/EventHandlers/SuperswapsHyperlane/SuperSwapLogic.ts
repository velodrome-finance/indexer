import type {
  DispatchId_event,
  OUSDTBridgedTransaction,
  OUSDTSwaps,
  ProcessId_event,
  SuperSwap,
} from "envio";
import { loadFirstOUSDTSwapInTx } from "../../Aggregators/OUSDTSwaps";
import { MailboxMessageId, OUSDT_ADDRESS, SuperSwapId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";

/**
 * Loads the live (not yet consumed) DispatchId_event rows of a source
 * transaction, in dispatch order, via `TxDispatchIdRegistry` and primary-key
 * reads. Same rows as `DispatchId_event.getWhere({ transactionHash })`.
 * @param transactionHash - Source transaction hash
 * @param context - Handler context
 * @returns Promise resolving to the tx's DispatchId_event rows
 */
export async function loadDispatchIdEventsInTx(
  transactionHash: string,
  context: handlerContext,
): Promise<DispatchId_event[]> {
  const registry = await context.TxDispatchIdRegistry.get(transactionHash);
  if (!registry) {
    return [];
  }
  const rows = await Promise.all(
    registry.messageIds.map((messageId) =>
      context.DispatchId_event.get(MailboxMessageId(messageId)),
    ),
  );
  return rows.filter((row): row is DispatchId_event => row !== undefined);
}

/**
 * Loads the ProcessId_event rows for a messageId by primary key, in the shape
 * `ProcessId_event.getWhere({ messageId })` returned (zero or one row).
 * @param messageId - Hyperlane message id
 * @param context - Handler context
 * @returns Promise resolving to `[]` or `[processIdEvent]`
 */
export async function loadProcessIdEvents(
  messageId: string,
  context: handlerContext,
): Promise<ProcessId_event[]> {
  const row = await context.ProcessId_event.get(MailboxMessageId(messageId));
  return row ? [row] : [];
}

/**
 * Builds a map from messageId to ProcessId event and collects unique destination transaction hashes.
 * @param sourceChainMessageIdEntities - DispatchId events from the source chain transaction
 * @param processIdResults - ProcessId events queried for each messageId (array of arrays)
 * @returns A map from messageId to ProcessId event and a set of unique destination transaction hashes
 */
export function buildMessageIdToProcessIdMap(
  sourceChainMessageIdEntities: DispatchId_event[],
  processIdResults: ProcessId_event[][],
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
  swap: OUSDTSwaps;
  sourceChainToken: string;
  sourceChainTokenAmountSwapped: bigint;
} | null> {
  const sourceChainSwaps = await loadFirstOUSDTSwapInTx(
    transactionHash,
    context,
  );

  // Since we only store swaps involving oUSDT, take the first swap
  // (all stored swaps should involve oUSDT, but verify for safety)
  if (sourceChainSwaps.length === 0) {
    return null;
  }

  const sourceSwap = sourceChainSwaps[0];

  // Safety check: verify the swap involves oUSDT
  if (
    sourceSwap.tokenInPool !== OUSDT_ADDRESS &&
    sourceSwap.tokenOutPool !== OUSDT_ADDRESS
  ) {
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
): Promise<Map<string, OUSDTSwaps[]>> {
  const transactionHashesArray = Array.from(destinationTransactionHashes);
  const swapPromises = transactionHashesArray.map((txHash) =>
    loadFirstOUSDTSwapInTx(txHash, context),
  );
  const swapResults = await Promise.all(swapPromises);

  // Build map in single pass: O(T) instead of O(2T) from Array.from + forEach
  const transactionHashToSwaps = new Map<string, OUSDTSwaps[]>();
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
 * @returns The swap and extracts the destination chain token information.
 */
export function findDestinationSwapWithOUSDT(
  sourceChainMessageIdEntities: DispatchId_event[],
  messageIdToProcessId: Map<string, ProcessId_event>,
  transactionHashToSwaps: Map<string, OUSDTSwaps[]>,
): {
  destinationSwap: OUSDTSwaps;
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
      continue;
    }

    const destinationSwaps = transactionHashToSwaps.get(
      processIdEvent.transactionHash,
    );

    if (!destinationSwaps || destinationSwaps.length === 0) {
      continue;
    }

    const destinationChainSwapWithOUSDT = destinationSwaps[0];

    // Safety check: verify the swap involves oUSDT
    if (
      destinationChainSwapWithOUSDT.tokenInPool !== OUSDT_ADDRESS &&
      destinationChainSwapWithOUSDT.tokenOutPool !== OUSDT_ADDRESS
    ) {
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
export async function createSuperSwapEntity(
  transactionHash: string,
  chainId: number,
  destinationDomain: bigint,
  bridgedTransaction: OUSDTBridgedTransaction,
  messageId: string,
  sourceSwap: OUSDTSwaps,
  sourceChainToken: string,
  sourceChainTokenAmountSwapped: bigint,
  destinationChainToken: string,
  destinationChainTokenAmountSwapped: bigint,
  blockTimestamp: number,
  context: handlerContext,
): Promise<void> {
  const superSwapId = SuperSwapId(messageId);

  // Check if SuperSwap already exists (idempotency check)
  const existingSuperSwap = await getRehydrated(
    context.SuperSwap,
    "SuperSwap",
    superSwapId,
  );
  if (existingSuperSwap) {
    return;
  }

  const superSwapEntity: SuperSwap = {
    id: superSwapId,
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
 * Deletes the matched DispatchId_event / ProcessId_event correlator pair for a
 * messageId whose SuperSwap has been confirmed created (or already exists).
 *
 * Only the matched pair is removed — other (unmatched) messageIds dispatched in
 * the same source transaction are retained for their own not-yet-created
 * SuperSwaps. Deletion is idempotent (deleteUnsafe on an already-removed id is a
 * no-op), so a backfill / reorg re-apply that re-reaches this point is safe.
 * This stops the Mailbox scratch tables from growing without bound (#817 Part B),
 * mirroring the delete-on-consume pattern used for PoolTransferInTx (#629).
 *
 * @param matchingMessageId - The messageId whose SuperSwap was just created
 * @param sourceChainMessageIdEntities - DispatchId events from the source transaction
 * @param messageIdToProcessId - Map from messageId to its ProcessId event
 * @param context - Handler context for entity operations
 * @returns Nothing; stages the matched pair's deletion
 */
function deleteConsumedMailboxPair(
  matchingMessageId: string,
  sourceChainMessageIdEntities: DispatchId_event[],
  messageIdToProcessId: Map<string, ProcessId_event>,
  context: handlerContext,
): void {
  const dispatchEntity = sourceChainMessageIdEntities.find(
    (entity) => entity.messageId === matchingMessageId,
  );
  if (dispatchEntity) {
    context.DispatchId_event.deleteUnsafe(dispatchEntity.id);
    // Once every message dispatched in the tx is consumed, the tx registry
    // lists only deleted rows, so drop it too.
    if (
      sourceChainMessageIdEntities.every(
        (entity) => entity.messageId === matchingMessageId,
      )
    ) {
      context.TxDispatchIdRegistry.deleteUnsafe(dispatchEntity.transactionHash);
    }
  }

  const processEntity = messageIdToProcessId.get(matchingMessageId);
  if (processEntity) {
    context.ProcessId_event.deleteUnsafe(processEntity.id);
  }
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
  bridgedTransaction: OUSDTBridgedTransaction,
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
    );

  // Find source swap with oUSDT
  const sourceSwapData = await findSourceSwapWithOUSDT(
    transactionHash,
    context,
  );
  if (!sourceSwapData) {
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
  );
  if (!destinationSwapData) {
    return;
  }

  // Create SuperSwap entity
  await createSuperSwapEntity(
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

  // The SuperSwap for matchingMessageId is now confirmed to exist (just created
  // or idempotently pre-existing), so its DispatchId/ProcessId correlators are
  // consumed and can be deleted to stop the Mailbox scratch tables from growing.
  // Only the matched pair is removed; unmatched messageIds in this source tx are
  // retained for their own not-yet-created SuperSwaps (#817 Part B).
  deleteConsumedMailboxPair(
    destinationSwapData.matchingMessageId,
    sourceChainMessageIdEntities,
    messageIdToProcessId,
    context,
  );
}

/**
 * Handles a CrossChainSwap event by loading the OUSDT bridge record and related
 * mailbox state, then delegating to processCrossChainSwap for SuperSwap entity
 * creation.
 *
 * CrossChainSwap fires for every cross-chain swap through VelodromeUniversalRouter,
 * including non-OUSDT bridges that the UniversalRouterBridge producer filtered out.
 * To avoid spamming warnings for those non-OUSDT bridges, this function treats the
 * absence of an OUSDTBridgedTransaction as an error ONLY when an OUSDTSwaps record
 * for the same transaction exists (meaning OUSDT was actually swapped but the
 * bridge correlation is missing).
 */
export async function handleCrossChainSwapEvent(
  transactionHash: string,
  chainId: number,
  destinationDomain: bigint,
  blockTimestamp: number,
  context: handlerContext,
): Promise<void> {
  // OUSDTBridgedTransaction is keyed by its tx hash, so a primary-key read
  // returns exactly the row getWhere({ transactionHash }) did.
  const [bridgedTransaction, sourceChainMessageIdEntities] = await Promise.all([
    context.OUSDTBridgedTransaction.get(transactionHash),
    loadDispatchIdEventsInTx(transactionHash, context),
  ]);

  if (!bridgedTransaction) {
    // No OUSDTBridgedTransaction for this tx — distinguish two cases via
    // the OUSDTSwaps lookup, preserving symmetry with the UniversalRouterBridge
    // producer (which only records OUSDTBridgedTransaction when token === OUSDT):
    //   - sourceChainOUSDTSwaps.length > 0: OUSDT was swapped on source chain
    //     but the bridge record is missing → real correlation failure, uerror.
    //   - sourceChainOUSDTSwaps.length === 0: bridged token was not OUSDT,
    //     so neither OUSDTBridgedTransaction nor OUSDTSwaps exist → silent skip.
    const sourceChainOUSDTSwaps = await loadFirstOUSDTSwapInTx(
      transactionHash,
      context,
    );
    if (sourceChainOUSDTSwaps.length > 0) {
      context.log.error(
        `No OUSDTBridgedTransaction found for OUSDT swap at chain ${chainId} tx ${transactionHash}`,
        new Error(
          `Missing OUSDTBridgedTransaction for transaction ${transactionHash}`,
        ),
      );
    }
    return;
  }

  if (sourceChainMessageIdEntities.length === 0) {
    return;
  }

  const processIdPromises = sourceChainMessageIdEntities.map(
    (entity: { messageId: string }) =>
      loadProcessIdEvents(entity.messageId, context),
  );
  const processIdResults = await Promise.all(processIdPromises);

  await processCrossChainSwap(
    sourceChainMessageIdEntities,
    processIdResults,
    bridgedTransaction,
    transactionHash,
    chainId,
    destinationDomain,
    blockTimestamp,
    context,
  );
}

/**
 * Attempts to create a SuperSwap entity when ProcessId is available.
 * This handles the case where ProcessId is processed after CrossChainSwap.
 * Since we are running Unordered Multichain Mode, there's no deterministic
 * order in which the indexer processes events, so we account for superswap
 * creation in both scenarios.
 *
 * @param messageId - The message ID from the ProcessId event
 * @param blockTimestamp - Block timestamp in seconds
 * @param context - Handler context for queries and entity operations
 * @param handlerChainId - Chain of the ProcessId event. Per-chain (ADR 0009) a
 *   DispatchId_event this handler can load lives on that chain; its id is the
 *   bare messageId, so it carries no chain of its own.
 */
export async function attemptSuperSwapCreationFromProcessId(
  messageId: string,
  blockTimestamp: number,
  context: handlerContext,
  handlerChainId: number,
): Promise<void> {
  try {
    // Find the matching DispatchId_event (keyed by messageId)
    const dispatchIdEvent = await context.DispatchId_event.get(
      MailboxMessageId(messageId),
    );

    if (!dispatchIdEvent) {
      return;
    }

    const sourceTransactionHash = dispatchIdEvent.transactionHash;
    const sourceChainId = handlerChainId;

    // Load OUSDTBridgedTransaction and DispatchId_event entities in parallel
    const [bridgedTransaction, sourceChainMessageIdEntities] =
      await Promise.all([
        context.OUSDTBridgedTransaction.get(sourceTransactionHash),
        loadDispatchIdEventsInTx(sourceTransactionHash, context),
      ]);

    if (!bridgedTransaction) {
      return;
    }

    if (sourceChainMessageIdEntities.length === 0) {
      return;
    }

    // Load all ProcessId_event entities for all messageIds from the DispatchId events
    const processIdPromises = sourceChainMessageIdEntities.map((entity) =>
      loadProcessIdEvents(entity.messageId, context),
    );
    const processIdResults = await Promise.all(processIdPromises);

    // Get destination domain from the bridged transaction
    const destinationDomain = bridgedTransaction.destinationChainId;

    // Attempt to create SuperSwap entity
    await processCrossChainSwap(
      sourceChainMessageIdEntities,
      processIdResults,
      bridgedTransaction,
      sourceTransactionHash,
      sourceChainId,
      destinationDomain,
      blockTimestamp,
      context,
    );
  } catch (error) {
    // Log error but don't throw - retry is best-effort
    context.log.warn(
      `Error attempting to create SuperSwap from ProcessId handler for messageId ${messageId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
