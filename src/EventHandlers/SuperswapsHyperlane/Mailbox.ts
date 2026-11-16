import { indexer } from "envio";
import type { DispatchId_event, ProcessId_event } from "envio";
import { MailboxMessageId, SuperSwapId } from "../../Constants";
import { recordProcessedMessage } from "./SuperSwapLegLogic";
import { attemptSuperSwapCreationFromProcessId } from "./SuperSwapLogic";

indexer.onEvent(
  { contract: "Mailbox", event: "DispatchId" },
  async ({ event, context }) => {
    const messageId = event.params.messageId;
    const transactionHash = event.transaction.hash;
    const entity: DispatchId_event = {
      id: MailboxMessageId(messageId),
      chainId: event.chainId,
      transactionHash,
      messageId: messageId,
    };

    context.DispatchId_event.set(entity);

    // Record the messageId under its tx so consumers can list a source tx's
    // dispatches by primary key (see TxDispatchIdRegistry in schema.graphql).
    const registryRead = context.TxDispatchIdRegistry.get(transactionHash);

    if (context.isPreload) {
      // The CrossChainSwap later in this tx looks this message's ProcessId_event
      // up (and, when the message was already delivered, the destination swap
      // and the SuperSwap). Its own preload cannot: it only learns the
      // messageId from this row, which a preload pass does not write. Issue
      // those reads here so they are batched instead of made one by one.
      const processed = await context.ProcessId_event.get(
        MailboxMessageId(messageId),
      );
      if (processed) {
        await Promise.all([
          context.TxOUSDTSwapRegistry.get(processed.transactionHash),
          context.SuperSwap.get(SuperSwapId(messageId)),
        ]);
      }
    }

    const registry = await registryRead;
    if (registry?.messageIds.includes(messageId)) {
      return;
    }
    context.TxDispatchIdRegistry.set({
      id: transactionHash,
      messageIds: [...(registry?.messageIds ?? []), messageId],
    });
  },
);

indexer.onEvent(
  { contract: "Mailbox", event: "ProcessId" },
  async ({ event, context }) => {
    const messageId = event.params.messageId;
    const entity: ProcessId_event = {
      id: MailboxMessageId(messageId),
      chainId: event.chainId,
      transactionHash: event.transaction.hash,
      messageId: messageId,
    };

    context.ProcessId_event.set(entity);
    // Destination side of the SuperSwap, from this chain's rows (ADR 0009)
    await recordProcessedMessage(
      event.chainId,
      event.transaction.hash,
      messageId,
      event.block.timestamp,
      context,
    );

    // Attempt to create SuperSwap entity when ProcessId is available
    // This handles the case where ProcessId is processed after CrossChainSwap
    await attemptSuperSwapCreationFromProcessId(
      messageId,
      event.block.timestamp,
      context,
    );
  },
);
