import { indexer } from "envio";
import type { DispatchId_event, ProcessId_event } from "envio";
import { MailboxMessageId, SuperSwapId } from "../../Constants";
import { logPerChainStubOnce } from "../../PerChainStubs";
import { attemptSuperSwapCreationFromProcessId } from "./SuperSwapLogic";

indexer.onEvent(
  { contract: "Mailbox", event: "DispatchId" },
  async ({ event, context }) => {
    const messageId = event.params.messageId;
    const transactionHash = event.transaction.hash;
    const entity: DispatchId_event = {
      id: MailboxMessageId(messageId),
      transactionHash,
      messageId: messageId,
    };

    context.DispatchId_event.set(entity);
    // TODO(ADR 0009, flow G): the destination chain's ProcessId_event / swap
    // rows are not visible from here (and vice versa), so a SuperSwap is only
    // stitched when both legs are on this chain. Each side keeps its own rows;
    // the migration writes per-side SuperSwap rows joined by messageId in
    // ClickHouse and drops the staging rows.
    logPerChainStubOnce(
      context,
      "G",
      "SuperSwap stitching only sees this chain's legs; cross-chain pairs stay unstitched.",
    );

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
      event.chainId,
    );
  },
);
