import { CLFactory, Token } from "generated";
import { updateLiquidityPoolAggregator } from "../Aggregators/LiquidityPoolAggregator";
import { TokenIdByChain } from "../Constants";
import { processCLFactoryPoolCreated } from "./CLFactory/CLFactoryPoolCreatedLogic";

CLFactory.PoolCreated.contractRegister(({ event, context }) => {
  context.addCLPool(event.params.pool);
});

CLFactory.PoolCreated.handlerWithLoader({
  loader: async ({ event, context }) => {
    const [poolToken0, poolToken1] = await Promise.all([
      context.Token.get(TokenIdByChain(event.params.token0, event.chainId)),
      context.Token.get(TokenIdByChain(event.params.token1, event.chainId)),
    ]);

    return { poolToken0, poolToken1 };
  },
  handler: async ({ event, context, loaderReturn }) => {
    // Process the pool created event
    const result = await processCLFactoryPoolCreated(
      event,
      loaderReturn,
      context,
    );

    // Apply the result to the database
    context.CLFactory_PoolCreated.set(result.CLFactoryPoolCreatedEntity);

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
  },
});
