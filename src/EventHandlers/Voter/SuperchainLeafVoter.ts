import { SuperchainLeafVoter } from "generated";

import {
  findPoolByGaugeAddress,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import {
  PoolId,
  SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST,
  SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST,
} from "../../Constants";

SuperchainLeafVoter.GaugeCreated.contractRegister(({ event, context }) => {
  const pf = event.params.poolFactory;
  if (SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST.includes(pf)) {
    context.addCLGauge(event.params.gauge);
  } else if (SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST.includes(pf)) {
    context.addGauge(event.params.gauge);
  }

  context.addFeesVotingReward(event.params.feeVotingReward);
});

SuperchainLeafVoter.GaugeCreated.handler(async ({ event, context }) => {
  // Update the pool entity with the gauge address
  const poolId = PoolId(event.chainId, event.params.pool);
  const gaugeAddress = event.params.gauge;

  const poolEntity = await context.LiquidityPoolAggregator.get(poolId);

  if (poolEntity) {
    const poolUpdateDiff = {
      gaugeAddress: gaugeAddress,
      feeVotingRewardAddress: event.params.feeVotingReward,
      bribeVotingRewardAddress: event.params.incentiveVotingReward,
      gaugeIsAlive: true, // Newly created gauges are always alive
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };

    await updateLiquidityPoolAggregator(
      poolUpdateDiff,
      poolEntity,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  }
});

SuperchainLeafVoter.GaugeKilled.handler(async ({ event, context }) => {
  const poolEntity = await findPoolByGaugeAddress(
    event.params.gauge,
    event.chainId,
    context,
  );
  const poolId = poolEntity?.id;

  if (poolId) {
    const poolUpdateDiff = {
      gaugeIsAlive: false,
      // Keep gaugeAddress, feeVotingRewardAddress and bribeVotingRewardAddress as historical data
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };

    await updateLiquidityPoolAggregator(
      poolUpdateDiff,
      poolEntity,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  }
});

SuperchainLeafVoter.GaugeRevived.handler(async ({ event, context }) => {
  const poolEntity = await findPoolByGaugeAddress(
    event.params.gauge,
    event.chainId,
    context,
  );
  const poolId = poolEntity?.id;

  if (poolId) {
    const poolUpdateDiff = {
      gaugeIsAlive: true,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };

    await updateLiquidityPoolAggregator(
      poolUpdateDiff,
      poolEntity,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  }
});

