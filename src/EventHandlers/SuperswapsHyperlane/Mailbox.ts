import {
  type DispatchId_event,
  Mailbox,
  type ProcessId_event,
} from "generated";

Mailbox.DispatchId.handler(async ({ event, context }) => {
  const messageId = event.params.messageId;
  const entity: DispatchId_event = {
    id: `${event.transaction.hash}_${event.chainId}_${messageId}`,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
    messageId: messageId,
  };

  context.DispatchId_event.set(entity);
});

Mailbox.ProcessId.handler(async ({ event, context }) => {
  const messageId = event.params.messageId;
  const entity: ProcessId_event = {
    id: `${event.transaction.hash}_${event.chainId}_${messageId}`,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
    messageId: messageId,
  };

  context.ProcessId_event.set(entity);
});
