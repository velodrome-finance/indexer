import {
    ALMLPWrapper,
    ALMLPWrapper_Deposit,
    ALMLPWrapper_Transfer,
    ALMLPWrapper_Withdraw
} from "generated";

ALMLPWrapper.Deposit.handler(async ({ event, context }) => {
  const {
    sender,
    recipient,
    pool,
    amount0,
    amount1,
    lpAmount,
    totalSupply
  } = event.params;

  const entity: ALMLPWrapper_Deposit = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sender,
    recipient,
    pool,
    amount0,
    amount1,
    lpAmount,
    totalSupply,
    timestamp: new Date(event.block.timestamp * 1000),
    chainId: event.chainId,
    blockNumber: event.block.number,
    logIndex: event.logIndex
  };

  context.ALMLPWrapper_Deposit.set(entity);
});

ALMLPWrapper.Withdraw.handler(async ({ event, context }) => {
  const {
    sender,
    recipient,
    pool,
    amount0,
    amount1,
    lpAmount,
    totalSupply
  } = event.params;

  const entity: ALMLPWrapper_Withdraw = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sender,
    recipient,
    pool,
    amount0,
    amount1,
    lpAmount,
    totalSupply,
    timestamp: new Date(event.block.timestamp * 1000),
    chainId: event.chainId,
    blockNumber: event.block.number,
    logIndex: event.logIndex
  };

  context.ALMLPWrapper_Withdraw.set(entity);
});

ALMLPWrapper.Transfer.handler(async ({ event, context }) => {
  const {
    from,
    to,
    value
  } = event.params;

  const entity: ALMLPWrapper_Transfer = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    from,
    to,
    value,
    timestamp: new Date(event.block.timestamp * 1000),
    chainId: event.chainId,
    blockNumber: event.block.number,
    logIndex: event.logIndex
  };

  context.ALMLPWrapper_Transfer.set(entity);
});