import { CLFactory } from "generated";
import { CHAIN_CONSTANTS, TokenIdByChain } from "../Constants";
import { processCLFactoryPoolCreated } from "./CLFactory/CLFactoryPoolCreatedLogic";

CLFactory.PoolCreated.contractRegister(({ event, context }) => {
  context.addCLPool(event.params.pool);
});

CLFactory.PoolCreated.handler(async ({ event, context }) => {
  // Load token instances efficiently
  const [poolToken0, poolToken1, CLGaugeConfig] = await Promise.all([
    context.Token.get(TokenIdByChain(event.params.token0, event.chainId)),
    context.Token.get(TokenIdByChain(event.params.token1, event.chainId)),
    context.CLGaugeConfig.get(
      CHAIN_CONSTANTS[event.chainId].newCLGaugeFactoryAddress,
    ),
  ]);

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  // Process the pool created event
  const result = await processCLFactoryPoolCreated(
    event,
    poolToken0,
    poolToken1,
    CLGaugeConfig,
    context,
  );

  // For new pool creation, set the entity directly (updateLiquidityPoolAggregator is for updates, not creation)
  context.LiquidityPoolAggregator.set(result.liquidityPoolAggregator);
});
