import {
  VelodromeUniversalRouter,
  type oUSDTBridgedTransaction,
} from "generated";
import { OUSDT_ADDRESS } from "../../Constants";
import { processCrossChainSwap } from "./CrossChainSwapLogic";

VelodromeUniversalRouter.UniversalRouterBridge.handler(
  async ({ event, context }) => {
    // Only process events that involve Open USDT (oUSDT)
    if (event.params.token !== OUSDT_ADDRESS) {
      return;
    }

    const entity: oUSDTBridgedTransaction = {
      id: event.transaction.hash,
      transactionHash: event.transaction.hash,
      originChainId: BigInt(event.chainId),
      destinationChainId: event.params.domain,
      sender: event.params.sender,
      recipient: event.params.recipient,
      amount: event.params.amount,
    };

    context.oUSDTBridgedTransaction.set(entity);
  },
);

VelodromeUniversalRouter.CrossChainSwap.handler(async ({ event, context }) => {
  // Load all independent data in parallel
  const [oUSDTBridgedTransactions, sourceChainMessageIdEntities] =
    await Promise.all([
      context.oUSDTBridgedTransaction.getWhere.transactionHash.eq(
        event.transaction.hash,
      ),
      context.DispatchId_event.getWhere.transactionHash.eq(
        event.transaction.hash,
      ),
    ]);

  if (oUSDTBridgedTransactions.length === 0) {
    context.log.warn(
      `No oUSDTBridgedTransaction found for transaction ${event.transaction.hash}`,
    );
    return;
  }

  // Use the first bridged transaction (all should have the same transaction hash)
  const bridgedTransaction = oUSDTBridgedTransactions[0];

  if (sourceChainMessageIdEntities.length === 0) {
    return;
  }

  // Load all ProcessId events in parallel for all message IDs
  // Note: Each messageId maps to exactly 1 ProcessId (1:1 relationship)
  const processIdPromises = sourceChainMessageIdEntities.map((entity) =>
    context.ProcessId_event.getWhere.messageId.eq(entity.messageId),
  );
  const processIdResults = await Promise.all(processIdPromises);

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  await processCrossChainSwap(
    sourceChainMessageIdEntities,
    processIdResults,
    bridgedTransaction,
    event.transaction.hash,
    event.chainId,
    event.params.destinationDomain,
    event.block.timestamp,
    context,
  );
});
