import {
    ALMCore,
    ALMCore_Rebalance,
    ALMCore_Rebalance_AmmPosition,
} from "generated";

ALMCore.Rebalance.handler(async ({ event, context }) => {
  const [ pool, ammPositionInfo, sqrtPriceX96, amount0, amount1, ammPositionIdBefore, ammPositionIdAfter ] = event.params.rebalanceEventParams;
  const [ token0, token1, property, tickLower, tickUpper, liquidity ] = ammPositionInfo;
  const entity: ALMCore_Rebalance = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    pool,
    tickLower,
    tickUpper,
    sqrtPriceX96,
    amount0,
    amount1,
    ammPositionIdBefore,
    ammPositionIdAfter,
    transactionHash: event.transaction.hash,
    timestamp: new Date(event.block.timestamp * 1000),
    chainId: event.chainId,
    blockNumber: event.block.number,
    logIndex: event.logIndex
  };

  context.ALMCore_Rebalance.set(entity);

  const ammPosition_entity: ALMCore_Rebalance_AmmPosition = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    pool,
    token0,
    token1,
    property,
    tickLower,
    tickUpper,
    liquidity,
    transactionHash: event.transaction.hash,
    timestamp: new Date(event.block.timestamp * 1000),
    chainId: event.chainId,
    blockNumber: event.block.number,
    logIndex: event.logIndex
  };

  context.ALMCore_Rebalance_AmmPosition.set(ammPosition_entity);
}); 
