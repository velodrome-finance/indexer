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

  // Process the pool created event
  const result = await processCLFactoryPoolCreated(
    event,
    poolToken0,
    poolToken1,
    context,
  );

  // Apply liquidity pool aggregator updates
  updateLiquidityPoolAggregator(
    result.liquidityPoolAggregator,
    result.liquidityPoolAggregator,
    new Date(event.block.timestamp * 1000),
    context,
    event.block.number,
  );
});
