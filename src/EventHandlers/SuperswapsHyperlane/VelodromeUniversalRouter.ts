import {
  type SuperSwap,
  VelodromeUniversalRouter,
  type oUSDTBridgedTransaction,
} from "generated";
import { OUSDT_ADDRESS, OUSDT_DECIMALS } from "../../Constants";

VelodromeUniversalRouter.UniversalRouterBridge.handler(
  async ({ event, context }) => {
    // Only process events that involve Open USDT (oUSDT)
    if (event.params.token !== OUSDT_ADDRESS) {
      return;
    }

    const entity: oUSDTBridgedTransaction = {
      id: event.transaction.hash,
      transaction_hash: event.transaction.hash,
      originChainId: event.chainId,
      destinationChainId: Number(event.params.domain),
      sender: event.params.sender,
      recipient: event.params.recipient,
      amount: Number(event.params.amount) / 10 ** OUSDT_DECIMALS,
    };

    context.oUSDTBridgedTransaction.set(entity);
  },
);

VelodromeUniversalRouter.CrossChainSwap.handler(async ({ event, context }) => {
  // If in the same transaction oUSDT was bridged, then it is a SuperSwap
  const oUSDTBridgedTransactions =
    await context.oUSDTBridgedTransaction.getWhere.transaction_hash.eq(
      event.transaction.hash,
    );

  if (oUSDTBridgedTransactions.length === 0) {
    context.log.warn(
      `No oUSDTBridgedTransaction found for transaction ${event.transaction.hash}`,
    );
    return;
  }

  const entity: SuperSwap = {
    id: event.transaction.hash,
    originChainId: oUSDTBridgedTransactions[0].originChainId,
    destinationChainId: oUSDTBridgedTransactions[0].destinationChainId,
    sender: oUSDTBridgedTransactions[0].sender,
    recipient: oUSDTBridgedTransactions[0].recipient,
    amount: oUSDTBridgedTransactions[0].amount,
    timestamp: new Date(event.block.timestamp * 1000),
  };

  context.SuperSwap.set(entity);
});
