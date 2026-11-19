import { indexer } from "envio";
import {
  type SAeroEventContext,
  processSAeroBurn,
  processSAeroDeposit,
  processSAeroPermanence,
  processSAeroRebalance,
  processSAeroSupply,
  processSAeroTransfer,
  processSAeroWithdraw,
} from "./AeroVotingEscrowLogic";

/**
 * Aero VotingEscrow (sAERO) on Base: positions, stakes, permanence, owner
 * changes, VoterPaymentsModule rebalances, accumulator burns and supply
 * (ADR 0006). Logic in AeroVotingEscrowLogic.ts.
 */

function eventContext(event: {
  chainId: number;
  block: { number: number; timestamp: number };
  transaction: { hash: string };
  logIndex: number;
}): SAeroEventContext {
  return {
    chainId: event.chainId,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  };
}

indexer.onEvent(
  { contract: "AeroVotingEscrow", event: "Transfer" },
  async ({ event, context }) => {
    await processSAeroTransfer(
      eventContext(event),
      event.params.from,
      event.params.to,
      event.params.tokenId,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVotingEscrow", event: "Deposit" },
  async ({ event, context }) => {
    await processSAeroDeposit(
      eventContext(event),
      event.params.provider,
      event.params.tokenId,
      BigInt(event.params.depositType),
      event.params.value,
      event.params.unstakeTime,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVotingEscrow", event: "Withdraw" },
  async ({ event, context }) => {
    await processSAeroWithdraw(
      eventContext(event),
      event.params.provider,
      event.params.tokenId,
      event.params.value,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVotingEscrow", event: "UpgradeToPermanentStake" },
  async ({ event, context }) => {
    await processSAeroPermanence(
      eventContext(event),
      event.params.tokenId,
      true,
      event.params.ts,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVotingEscrow", event: "DowngradeFromPermanentStake" },
  async ({ event, context }) => {
    await processSAeroPermanence(
      eventContext(event),
      event.params.tokenId,
      false,
      event.params.ts,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVotingEscrow", event: "Rebalance" },
  async ({ event, context }) => {
    await processSAeroRebalance(
      eventContext(event),
      event.params.sources,
      event.params.destinations,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVotingEscrow", event: "Burn" },
  async ({ event, context }) => {
    await processSAeroBurn(eventContext(event), event.params.amount, context);
  },
);

indexer.onEvent(
  { contract: "AeroVotingEscrow", event: "Supply" },
  async ({ event, context }) => {
    await processSAeroSupply(eventContext(event), event.params.supply, context);
  },
);
