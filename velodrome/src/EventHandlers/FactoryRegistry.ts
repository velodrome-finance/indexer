import { FactoryRegistry, FactoryRegistry_Approve, FactoryRegistry_Unapprove } from "generated";

FactoryRegistry.Approve.handler(async ({ event, context }) => {
  const entity: FactoryRegistry_Approve = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    poolFactory: event.params.poolFactory,
    votingRewardsFactory: event.params.votingRewardsFactory,
    gaugeFactory: event.params.gaugeFactory,
    timestamp: new Date(event.block.timestamp * 1000),
    transactionHash: event.transaction.hash,
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
  };

  context.FactoryRegistry_Approve.set(entity);
});

FactoryRegistry.Unapprove.handler(async ({ event, context }) => {

  const entity: FactoryRegistry_Unapprove = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    poolFactory: event.params.poolFactory,
    votingRewardsFactory: event.params.votingRewardsFactory,
    gaugeFactory: event.params.gaugeFactory,
    timestamp: new Date(event.block.timestamp * 1000),
    transactionHash: event.transaction.hash,
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
  };

  context.FactoryRegistry_Unapprove.set(entity);
});