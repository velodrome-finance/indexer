import { CLFactory, Token } from "generated";
import { updateLiquidityPoolAggregator } from "../Aggregators/LiquidityPoolAggregator";
import { TokenIdByChain } from "../Constants";
import { processCLFactoryPoolCreated } from "./CLFactory/CLFactoryPoolCreatedLogic";

CLFactory.PoolCreated.contractRegister(({ event, context }) => {
  context.addCLPool(event.params.pool);
});

CLFactory.PoolCreated.handler(async ({ event, context }) => {
  // Load token instances efficiently
  const [poolToken0, poolToken1] = await Promise.all([
    context.Token.get(TokenIdByChain(event.params.token0, event.chainId)),
    context.Token.get(TokenIdByChain(event.params.token1, event.chainId)),
  ]);

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  // Create loader return object for compatibility with existing logic
  const loaderReturn = {
    _type: "success" as const,
    poolToken0,
    poolToken1,
  };

  // Process the pool created event
  const result = await processCLFactoryPoolCreated(
    event,
    loaderReturn,
    context,
  );

  // Handle errors
  if (result.error) {
    context.log.error(result.error);
    return;
  }

  // Apply liquidity pool aggregator updates
  if (result.liquidityPoolAggregator) {
    updateLiquidityPoolAggregator(
      result.liquidityPoolAggregator,
      result.liquidityPoolAggregator,
      new Date(event.block.timestamp * 1000),
      context,
      event.block.number,
    );
  }
});
