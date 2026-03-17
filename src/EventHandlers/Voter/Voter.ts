import { Voter } from "generated";

import {
  findPoolByGaugeAddress,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import {
  CHAIN_CONSTANTS,
  PendingDistributionId,
  PoolId,
  RootGaugeRootPoolId,
  TokenId,
  VOTER_CLPOOLS_FACTORY_LIST,
  VOTER_NONCL_POOLS_FACTORY_LIST,
} from "../../Constants";
import { refreshTokenPrice } from "../../PriceOracle";
import {
  buildPoolDiffFromDistribute,
  computeVoterDistributeValues,
  resolveLeafPoolForRootGauge,
} from "./VoterCommonLogic";

Voter.GaugeCreated.contractRegister(({ event, context }) => {
  const pf = event.params.poolFactory;
  if (VOTER_CLPOOLS_FACTORY_LIST.includes(pf)) {
    context.addCLGauge(event.params.gauge);
  } else if (VOTER_NONCL_POOLS_FACTORY_LIST.includes(pf)) {
    context.addGauge(event.params.gauge);
  }

  context.addFeesVotingReward(event.params.feeVotingReward);
  context.addBribesVotingReward(event.params.bribeVotingReward);
});

Voter.GaugeCreated.handler(async ({ event, context }) => {
  // Update the pool entity with the gauge address
  const poolId = PoolId(event.chainId, event.params.pool);
  const gaugeAddress = event.params.gauge;

  const poolEntity = await context.LiquidityPoolAggregator.get(poolId);

  if (poolEntity) {
    const poolUpdateDiff = {
      gaugeAddress: gaugeAddress,
      feeVotingRewardAddress: event.params.feeVotingReward,
      bribeVotingRewardAddress: event.params.bribeVotingReward,
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
  } else {
    // RootPool case: no LiquidityPoolAggregator on this chain
    // Store root gauge → root pool for DistributeReward cross-chain resolution
    const id = RootGaugeRootPoolId(event.chainId, event.params.gauge);
    context.RootGauge_RootPool.set({
      id,
      rootChainId: event.chainId,
      rootGaugeAddress: event.params.gauge,
      rootPoolAddress: event.params.pool,
    });
  }
});

Voter.DistributeReward.handler(async ({ event, context }) => {
  const eventChainId = event.chainId;
  const rewardTokenAddress = CHAIN_CONSTANTS[eventChainId].rewardToken(
    event.block.number,
  );

  const [poolResult, rewardToken] = await Promise.all([
    (async () => {
      const poolEntity = await findPoolByGaugeAddress(
        event.params.gauge,
        eventChainId,
        context,
      );
      if (poolEntity) {
        const pool =
          (await context.LiquidityPoolAggregator.get(poolEntity.id)) ?? null;
        return pool ? { pool, isCrossChain: false } : null;
      }
      return resolveLeafPoolForRootGauge(
        context,
        eventChainId,
        event.params.gauge,
      );
    })(),
    context.Token.get(TokenId(eventChainId, rewardTokenAddress)),
  ]);

  if (!poolResult || !rewardToken) {
    // If this is a root gauge but RootPool_LeafPool mapping is missing, defer for later processing
    if (poolResult === null) {
      const rootGaugeMapping = await context.RootGauge_RootPool.get(
        RootGaugeRootPoolId(eventChainId, event.params.gauge),
      );
      if (rootGaugeMapping) {
        const rootPoolLeafPools =
          (await context.RootPool_LeafPool.getWhere({
            rootPoolAddress: { _eq: rootGaugeMapping.rootPoolAddress },
          })) ?? [];
        if (rootPoolLeafPools.length !== 1) {
          const logIndex = event.logIndex;
          context.PendingDistribution.set({
            id: PendingDistributionId(
              eventChainId,
              rootGaugeMapping.rootPoolAddress,
              event.block.number,
              logIndex,
            ),
            rootChainId: eventChainId,
            rootPoolAddress: rootGaugeMapping.rootPoolAddress,
            gaugeAddress: event.params.gauge,
            amount: event.params.amount,
            blockNumber: BigInt(event.block.number),
            blockTimestamp: new Date(event.block.timestamp * 1000),
            logIndex,
          });
          context.log.warn(
            `[Voter.DistributeReward] RootPool_LeafPool mapping missing/ambiguous (count=${rootPoolLeafPools.length}) for gauge ${event.params.gauge}. PendingDistribution stored for later processing.`,
          );
          return;
        }
      }
    }
    context.log.warn(
      `[Voter.DistributeReward] Missing pool or reward token for gauge ${event.params.gauge.toString()} on chain ${eventChainId}`,
    );
    return;
  }

  const currentLiquidityPool = poolResult.pool;
  const isCrossChainDistribution = poolResult.isCrossChain;

  // Refresh reward token price if it's zero (token was just created or price fetch failed previously)
  // Or if more than 1h has passed since last update
  const updatedRewardToken = await refreshTokenPrice(
    rewardToken,
    event.block.number,
    event.block.timestamp,
    eventChainId,
    context,
  );

  const result = await computeVoterDistributeValues(
    updatedRewardToken,
    event.params.gauge,
    event.params.amount,
    event.block.number,
    eventChainId,
    context,
    currentLiquidityPool.gaugeIsAlive ?? false,
  );

  const timestampMs = event.block.timestamp * 1000;
  const poolDiff = buildPoolDiffFromDistribute(
    result,
    timestampMs,
    isCrossChainDistribution ? undefined : event.params.gauge,
  );

  await updateLiquidityPoolAggregator(
    poolDiff,
    currentLiquidityPool,
    new Date(timestampMs),
    context,
    // For cross-chain distributions, pass eventChainId (OP) so the dynamic fee
    // guard in updateDynamicFeePools detects the chain mismatch and skips.
    isCrossChainDistribution ? eventChainId : currentLiquidityPool.chainId,
    event.block.number,
  );
});

Voter.GaugeKilled.handler(async ({ event, context }) => {
  // Update the pool entity - mark gauge as not alive and clear gauge address
  // Keep voting reward addresses as historical data
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

Voter.GaugeRevived.handler(async ({ event, context }) => {
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
