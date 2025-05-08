import {
    ALMLPWrapper,
    ALMLPWrapper_Deposit,
    ALMLPWrapper_Transfer,
    ALMLPWrapper_Withdraw,
    ALMLPWrapper_TotalSupplyLimitUpdated
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
    transactionHash: event.transaction.hash,
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
    transactionHash: event.transaction.hash,
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
    transactionHash: event.transaction.hash,
    timestamp: new Date(event.block.timestamp * 1000),
    chainId: event.chainId,
    blockNumber: event.block.number,
    logIndex: event.logIndex
  };

  context.ALMLPWrapper_Transfer.set(entity);
});

ALMLPWrapper.TotalSupplyLimitUpdated.handler(async ({ event, context }) => {
  const {
    newTotalSupplyLimit,
    totalSupplyLimitOld,
    totalSupplyCurrent
  } = event.params;

  const entity: ALMLPWrapper_TotalSupplyLimitUpdated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    newTotalSupplyLimit,
    totalSupplyLimitOld,
    totalSupplyCurrent,
    transactionHash: event.transaction.hash,
    timestamp: new Date(event.block.timestamp * 1000),
    chainId: event.chainId,
    blockNumber: event.block.number,
    logIndex: event.logIndex
  };

  context.ALMLPWrapper_TotalSupplyLimitUpdated.set(entity);
}); 