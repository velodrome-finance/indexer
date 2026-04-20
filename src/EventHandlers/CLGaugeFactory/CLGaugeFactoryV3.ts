import { CLGaugeFactoryV3 } from "generated";
import { PoolId } from "../../Constants";
import {
  applySetDefaultCap,
  applySetDefaultMinStakeTime,
  applySetEmissionCap,
  applySetPenaltyRate,
} from "./CLGaugeFactorySharedLogic";

CLGaugeFactoryV3.SetDefaultCap.handler(async ({ event, context }) => {
  await applySetDefaultCap(
    event.chainId,
    event.params._newDefaultCap,
    event.block.timestamp,
    context,
  );
});

CLGaugeFactoryV3.SetEmissionCap.handler(async ({ event, context }) => {
  await applySetEmissionCap(
    event.params._gauge,
    event.params._newEmissionCap,
    event.block.timestamp,
    "CLGaugeFactoryV3",
    context,
  );
});

CLGaugeFactoryV3.SetDefaultMinStakeTime.handler(async ({ event, context }) => {
  await applySetDefaultMinStakeTime(
    event.chainId,
    event.params._minStakeTime,
    event.block.timestamp,
    context,
  );
});

CLGaugeFactoryV3.SetPoolMinStakeTime.handler(async ({ event, context }) => {
  const poolId = PoolId(event.chainId, event.params._pool);
  const pool = await context.LiquidityPoolAggregator.get(poolId);

  if (!pool) {
    context.log.error(
      `[CLGaugeFactoryV3] Pool ${event.params._pool} not found on chain ${event.chainId} for SetPoolMinStakeTime`,
    );
    return;
  }

  context.LiquidityPoolAggregator.set({
    ...pool,
    minStakeTime: event.params._minStakeTime,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  });
});

CLGaugeFactoryV3.SetPenaltyRate.handler(async ({ event, context }) => {
  await applySetPenaltyRate(
    event.chainId,
    event.params._penaltyRate,
    event.block.timestamp,
    context,
  );
});
