import {
  type OUSDTBridgedTransaction,
  VelodromeUniversalRouter,
} from "generated";
import { OUSDT_ADDRESS } from "../../Constants";
import { handleCrossChainSwapEvent } from "./SuperSwapLogic";

VelodromeUniversalRouter.UniversalRouterBridge.handler(
  async ({ event, context }) => {
    // Only process events that involve Open USDT (oUSDT)
    if (event.params.token !== OUSDT_ADDRESS) {
      return;
    }

    const entity: OUSDTBridgedTransaction = {
      id: event.transaction.hash,
      transactionHash: event.transaction.hash,
      originChainId: BigInt(event.chainId),
      destinationChainId: event.params.domain,
      sender: event.params.sender,
      recipient: event.params.recipient,
      amount: event.params.amount,
    };

    context.OUSDTBridgedTransaction.set(entity);
  },
);

VelodromeUniversalRouter.CrossChainSwap.handler(async ({ event, context }) => {
  await handleCrossChainSwapEvent(
    event.transaction.hash,
    event.chainId,
    event.params.destinationDomain,
    event.block.timestamp,
    context,
  );
});
