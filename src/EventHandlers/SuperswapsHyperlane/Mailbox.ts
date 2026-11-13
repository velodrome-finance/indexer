import { indexer } from "envio";
import type { DispatchId_event, ProcessId_event } from "envio";
import { MailboxMessageId } from "../../Constants";
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
    const registry = await context.TxDispatchIdRegistry.get(transactionHash);
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

    // Attempt to create SuperSwap entity when ProcessId is available
    // This handles the case where ProcessId is processed after CrossChainSwap
    await attemptSuperSwapCreationFromProcessId(
      messageId,
      event.block.timestamp,
      context,
    );
  },
);
