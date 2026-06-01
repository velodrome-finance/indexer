import { indexer } from "envio";
import { getRehydrated } from "../EntityTimestamps";

indexer.onEvent(
  { contract: "FactoryRegistry", event: "Approve" },
  async ({ event, context }) => {
    // Update FactoryRegistryConfig with the newly approved factories
    const configId = `${event.srcAddress}_${event.chainId}`;
    const existingConfig = await context.FactoryRegistryConfig.getOrCreate({
      id: configId,
      currentActivePoolFactory: event.params.poolFactory,
      currentActiveVotingRewardsFactory: event.params.votingRewardsFactory,
      currentActiveGaugeFactory: event.params.gaugeFactory,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    });

    // Update the config with new values (getOrCreate may return existing unchanged)
    context.FactoryRegistryConfig.set({
      ...existingConfig,
      currentActivePoolFactory: event.params.poolFactory,
      currentActiveVotingRewardsFactory: event.params.votingRewardsFactory,
      currentActiveGaugeFactory: event.params.gaugeFactory,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    });
  },
);

indexer.onEvent(
  { contract: "FactoryRegistry", event: "Unapprove" },
  async ({ event, context }) => {
    // Update FactoryRegistryConfig if the unapproved factories match the current active ones
    const configId = `${event.srcAddress}_${event.chainId}`;
    const existingConfig = await getRehydrated(
      context.FactoryRegistryConfig,
      "FactoryRegistryConfig",
      configId,
    );

    if (!existingConfig) {
      context.log.warn(
        `FactoryRegistryConfig ${configId} not found for Unapprove event. Should have been created by Approve event.`,
      );
      return;
    }

    context.FactoryRegistryConfig.set({
      ...existingConfig,
      currentActivePoolFactory: "",
      currentActiveVotingRewardsFactory: "",
      currentActiveGaugeFactory: "",
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    });
  },
);
