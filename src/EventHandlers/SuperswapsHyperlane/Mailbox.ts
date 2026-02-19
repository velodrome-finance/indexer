import {
  type DispatchId_event,
  Mailbox,
  type ProcessId_event,
} from "generated";
import { MailboxMessageId } from "../../Constants";
import { attemptSuperSwapCreationFromProcessId } from "./SuperSwapLogic";

Mailbox.DispatchId.handler(async ({ event, context }) => {
  const messageId = event.params.messageId;
  const entity: DispatchId_event = {
    id: MailboxMessageId(event.transaction.hash, event.chainId, messageId),
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
    messageId: messageId,
  };

  context.DispatchId_event.set(entity);
});

Mailbox.ProcessId.handler(async ({ event, context }) => {
  const messageId = event.params.messageId;
  const entity: ProcessId_event = {
    id: MailboxMessageId(event.transaction.hash, event.chainId, messageId),
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
});
