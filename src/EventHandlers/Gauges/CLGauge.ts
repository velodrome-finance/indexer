import { indexer } from "envio";
import {
  processGaugeClaimRewards,
  processGaugeDeposit,
  processGaugeWithdraw,
} from "./GaugeSharedLogic";

indexer.onEvent(
  { contract: "CLGauge", event: "Deposit" },
  async ({ event, context }) => {
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
  },
);

indexer.onEvent(
  { contract: "CLGauge", event: "Withdraw" },
  async ({ event, context }) => {
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
  },
);

indexer.onEvent(
  { contract: "CLGauge", event: "ClaimRewards" },
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
      "CLGauge.ClaimRewards",
    );
  },
);
