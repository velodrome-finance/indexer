import { CLGauge } from "generated";
import {
  processGaugeClaimRewards,
  processGaugeDeposit,
  processGaugeWithdraw,
} from "./GaugeSharedLogic";

CLGauge.Deposit.handler(async ({ event, context }) => {
  await processGaugeDeposit(
    {
      gaugeAddress: event.srcAddress,
      userAddress: event.params.user,
      chainId: event.chainId,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      amount: event.params.liquidityToStake,
      tokenId: event.params.tokenId,
    },
    context,
    "CLGauge.Deposit",
  );
});

CLGauge.Withdraw.handler(async ({ event, context }) => {
  await processGaugeWithdraw(
    {
      gaugeAddress: event.srcAddress,
      userAddress: event.params.user,
      chainId: event.chainId,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      amount: event.params.liquidityToStake,
      tokenId: event.params.tokenId,
    },
    context,
    "CLGauge.Withdraw",
  );
});

CLGauge.ClaimRewards.handler(async ({ event, context }) => {
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
    "CLGauge.ClaimRewards",
  );
});
