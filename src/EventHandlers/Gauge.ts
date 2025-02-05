import {
  Gauge,
  Gauge_NotifyReward,
  Gauge_Deposit,
  Gauge_Withdraw,
} from "generated";

Gauge.NotifyReward.handler(async ({ event, context }) => {
  const entity: Gauge_NotifyReward = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    from: event.params.from,
    amount: event.params.amount,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    sourceAddress: event.srcAddress,
    chainId: event.chainId,
  };

  console.log(entity);
  context.Gauge_NotifyReward.set(entity);
});

Gauge.Deposit.handler(async ({ event, context }) => {

  const entity: Gauge_Deposit = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    from: event.params.from,
    amount: event.params.amount,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    sourceAddress: event.srcAddress,
    chainId: event.chainId,
  };

  context.Gauge_Deposit.set(entity);
});

Gauge.Withdraw.handler(async ({ event, context }) => {
  const entity: Gauge_Withdraw = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    from: event.params.from,
    amount: event.params.amount,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    sourceAddress: event.srcAddress,
    chainId: event.chainId,
  };

  context.Gauge_Withdraw.set(entity);
});
