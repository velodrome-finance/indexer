import { indexer } from "envio";
import type { OUSDTBridgedTransaction } from "envio";
import { OUSDT_ADDRESS } from "../../Constants";
import { domainToChainId } from "./HyperlaneDomain";
import { writeSuperSwapOriginLegs } from "./SuperSwapLegLogic";
import { handleCrossChainSwapEvent } from "./SuperSwapLogic";

indexer.onEvent(
  { contract: "VelodromeUniversalRouter", event: "UniversalRouterBridge" },
  async ({ event, context }) => {
    // Only process events that involve Open USDT (oUSDT)
    if (event.params.token !== OUSDT_ADDRESS) {
      return;
    }

    const entity: OUSDTBridgedTransaction = {
      id: event.transaction.hash,
      transactionHash: event.transaction.hash,
      originChainId: BigInt(event.chainId),
      destinationChainId: domainToChainId(event.params.domain),
      sender: event.params.sender,
      recipient: event.params.recipient,
      amount: event.params.amount,
    };

    context.OUSDTBridgedTransaction.set(entity);
  },
);

indexer.onEvent(
  { contract: "VelodromeUniversalRouter", event: "CrossChainSwap" },
  async ({ event, context }) => {
    // Origin side of the SuperSwap, from this chain's rows (ADR 0009)
    await writeSuperSwapOriginLegs(
      event.chainId,
      event.transaction.hash,
      domainToChainId(event.params.destinationDomain),
      event.block.timestamp,
      context,
    );
    await handleCrossChainSwapEvent(
      event.transaction.hash,
      event.chainId,
      domainToChainId(event.params.destinationDomain),
      event.block.timestamp,
      context,
    );
  },
);
