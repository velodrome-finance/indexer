import { Gauge } from "generated";
import {
  processGaugeClaimRewards,
  processGaugeDeposit,
  processGaugeWithdraw,
} from "./GaugeSharedLogic";

Gauge.Deposit.handler(async ({ event, context }) => {
  await processGaugeDeposit(
    {
      gaugeAddress: event.srcAddress,
      userAddress: event.params.from,
      chainId: event.chainId,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      amount: event.params.amount,
    },
    context,
    "Gauge.Deposit",
  );
});

Gauge.Withdraw.handler(async ({ event, context }) => {
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
});

Gauge.ClaimRewards.handler(async ({ event, context }) => {
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
});
