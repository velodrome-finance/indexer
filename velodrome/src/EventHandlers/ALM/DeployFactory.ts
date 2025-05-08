import { ALMDeployFactory, ALMDeployFactory_StrategyCreated, ALMDeployFactory_StrategyCreated_AmmPosition } from "generated";


ALMDeployFactory.StrategyCreated.contractRegister(
  ({ event, context }) => {
    const [
        pool,
        ammPosition,
        strategyParams,
        lpWrapper,
        caller
    ] = event.params.params;
    context.addALMLPWrapper(lpWrapper);
  },
  { preRegisterDynamicContracts: true }
);

ALMDeployFactory.StrategyCreated.handler(async ({ event, context }) => {
  const [
    pool,
    ammPosition,
    strategyParams,
    lpWrapper,
    caller
  ] = event.params.params;

  const [
    strategyType,
    tickNeighborhood,
    tickSpacing,
    width,
    maxLiquidityRatioDeviationX96
  ] = strategyParams;

  const ammPositionList = ammPosition.map((vals) => {
    const [token0, token1, property, tickLower, tickUpper, liquidity] = vals;
    return {
      token0,
      token1,
      property,
      tickLower,
      tickUpper,
      liquidity
    };
  });

  const strategy_created_entity: ALMDeployFactory_StrategyCreated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    pool,
    lpWrapper,
    strategyType,
    tickNeighborhood,
    tickSpacing,
    width,
    maxLiquidityRatioDeviationX96,
    transactionHash: event.transaction.hash,
    timestamp: new Date(event.block.timestamp * 1000),
    chainId: event.chainId,
    blockNumber: event.block.number,
    logIndex: event.logIndex
  };

  context.ALMDeployFactory_StrategyCreated.set(strategy_created_entity);

  for (const ammPosition of ammPositionList) {
    const { token0, token1, property, tickLower, tickUpper, liquidity } = ammPosition;
    const ammPosition_entity: ALMDeployFactory_StrategyCreated_AmmPosition = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      pool,
      lpWrapper,
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

    context.ALMDeployFactory_StrategyCreated_AmmPosition.set(ammPosition_entity);
  }
});