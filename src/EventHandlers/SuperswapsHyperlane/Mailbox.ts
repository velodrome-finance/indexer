import { indexer } from "envio";
import { recordProcessedMessage } from "./SuperSwapLegLogic";

// Origin side: record the messageId under its tx so the CrossChainSwap later in
// the same tx writes one SuperSwapOriginLeg per dispatched message (ADR 0009,
// flow G).
indexer.onEvent(
  { contract: "Mailbox", event: "DispatchId" },
  async ({ event, context }) => {
    const messageId = event.params.messageId;
    const transactionHash = event.transaction.hash;
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

// Destination side: record the processed message under its tx; the first oUSDT
// swap of the tx writes the SuperSwapDestinationLeg (ADR 0009, flow G).
indexer.onEvent(
  { contract: "Mailbox", event: "ProcessId" },
  async ({ event, context }) => {
    await recordProcessedMessage(
      event.chainId,
      event.transaction.hash,
      event.params.messageId,
      event.block.timestamp,
      context,
    );
  },
);
