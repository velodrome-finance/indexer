import { RootCLPoolFactory } from "generated";
import type { RootPool_LeafPool } from "generated";

RootCLPoolFactory.RootPoolCreated.handler(async ({ event, context }) => {
  const rootChainId = event.chainId;
  const leafChainId = Number(event.params.chainid);

  if (leafChainId !== 252) {
    return;
  }

  const rootPoolAddress = event.params.pool;
  const token0 = event.params.token0;
  const token1 = event.params.token1;
  const tickSpacing = BigInt(event.params.tickSpacing);

  // Hash uses token0/token1 order
  const hash = `${leafChainId}_${token0}_${token1}_${tickSpacing}`;

  // Query by rootPoolMatchingHash
  const pools =
    await context.LiquidityPoolAggregator.getWhere.rootPoolMatchingHash.eq(
      hash,
    );

  // There should be only one matching pool
  if (pools.length !== 1) {
    context.log.error(
      `Expected exactly one matching LiquidityPoolAggregator for RootPoolCreated: token0=${token0}, token1=${token1}, chainId=${leafChainId}, tickSpacing=${tickSpacing}`,
    );
    return;
  }
  const matchingPool = pools[0];

  const leafPoolAddress = matchingPool.id;
  const rootPoolLeafPoolId = `${rootPoolAddress}_${rootChainId}_${leafPoolAddress}_${leafChainId}`;

  const rootPoolLeafPool: RootPool_LeafPool = {
    id: rootPoolLeafPoolId,
    rootChainId,
    rootPoolAddress,
    leafChainId,
    leafPoolAddress,
  };

  context.RootPool_LeafPool.set(rootPoolLeafPool);
});
