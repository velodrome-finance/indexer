import {
  CLGauge,
  CLGauge_NotifyReward,
  CLGauge_Deposit,
  CLGauge_Withdraw,
  CLGauge_ClaimRewards
} from "generated";

CLGauge.NotifyReward.handler(async ({ event, context }) => {
  const entity: CLGauge_NotifyReward = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    from: event.params.from,
    amount: event.params.amount,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    sourceAddress: event.srcAddress,
    chainId: event.chainId,
    transactionHash: event.transaction.hash
  };

  context.Gauge_NotifyReward.set(entity);
});

CLGauge.Deposit.handler(async ({ event, context }) => {

  const entity: CLGauge_Deposit = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    tokenId: event.params.tokenId,
    user: event.params.user,
    liquidityToStake: event.params.liquidityToStake,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    sourceAddress: event.srcAddress,
    chainId: event.chainId,
    transactionHash: event.transaction.hash
  };

  context.CLGauge_Deposit.set(entity);
});

CLGauge.Withdraw.handler(async ({ event, context }) => {
  const entity: CLGauge_Withdraw = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    tokenId: event.params.tokenId,
    user: event.params.user,
    liquidityToStake: event.params.liquidityToStake,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    sourceAddress: event.srcAddress,
    chainId: event.chainId,
    transactionHash: event.transaction.hash
  };

  context.CLGauge_Withdraw.set(entity);
});

CLGauge.ClaimRewards.handler(async ({ event, context }) => {
  const entity: CLGauge_ClaimRewards = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    from: event.params.from,
    amount: event.params.amount,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    sourceAddress: event.srcAddress,
    chainId: event.chainId,
    transactionHash: event.transaction.hash
  };

  context.CLGauge_ClaimRewards.set(entity);
});
