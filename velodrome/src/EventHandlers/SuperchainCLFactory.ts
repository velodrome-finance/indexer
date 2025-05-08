import { SuperchainCLFactory, SuperchainCLFactory_RootPoolCreated } from "generated";

SuperchainCLFactory.RootPoolCreated.handler(async ({ event, context }) => {
  const poolChainId = event.params.chainid;
  const entity: SuperchainCLFactory_RootPoolCreated = {
    id: `${poolChainId}_${event.block.number}_${event.logIndex}`,
    token0: event.params.token0,
    token1: event.params.token1,
    pool: event.params.pool,
    poolFactory: event.srcAddress,
    timestamp: new Date(event.block.timestamp * 1000),
    chainId: event.chainId,
    poolChainId: Number(poolChainId),
    tickSpacing: event.params.tickSpacing,
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    transactionHash: event.transaction.hash
  };

  context.SuperchainCLFactory_RootPoolCreated.set(entity);
});