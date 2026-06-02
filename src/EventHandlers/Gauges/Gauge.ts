import { indexer } from "envio";
import {
  processGaugeClaimRewards,
  processGaugeDeposit,
  processGaugeWithdraw,
} from "./GaugeSharedLogic";

indexer.onEvent(
  { contract: "Gauge", event: "Deposit" },
  async ({ event, context }) => {
    await processGaugeDeposit(
      {
        gaugeAddress: event.srcAddress,
        userAddress: event.params.to,
        chainId: event.chainId,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        amount: event.params.amount,
      },
      context,
      "Gauge.Deposit",
    );
  },
);

indexer.onEvent(
  { contract: "Gauge", event: "Withdraw" },
  async ({ event, context }) => {
    await processGaugeWithdraw(
      {
        gaugeAddress: event.srcAddress,
        userAddress: event.params.from,
        chainId: event.chainId,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        amount: event.params.amount,
      },
      context,
      "Gauge.Withdraw",
    );
  },
);

indexer.onEvent(
  { contract: "Gauge", event: "ClaimRewards" },
  async ({ event, context }) => {
    await processGaugeClaimRewards(
      {
        gaugeAddress: event.srcAddress,
        userAddress: event.params.from,
        chainId: event.chainId,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        amount: event.params.amount,
      },
      context,
      "Gauge.ClaimRewards",
    );
  },
);
