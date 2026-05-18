import { indexer } from "envio";
import { PoolId } from "../../Constants";
import {
  applySetDefaultCap,
  applySetDefaultMinStakeTime,
  applySetEmissionCap,
  applySetPenaltyRate,
} from "./CLGaugeFactorySharedLogic";

indexer.onEvent(
  { contract: "CLGaugeFactoryV3", event: "SetDefaultCap" },
  async ({ event, context }) => {
    await applySetDefaultCap(
      event.chainId,
      event.params._newDefaultCap,
      event.block.timestamp,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "CLGaugeFactoryV3", event: "SetEmissionCap" },
  async ({ event, context }) => {
    await applySetEmissionCap(
      event.params._gauge,
      event.params._newEmissionCap,
      event.block.timestamp,
      "CLGaugeFactoryV3",
      context,
    );
  },
);

indexer.onEvent(
  { contract: "CLGaugeFactoryV3", event: "SetDefaultMinStakeTime" },
  async ({ event, context }) => {
    await applySetDefaultMinStakeTime(
      event.chainId,
      event.params._minStakeTime,
      event.block.timestamp,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "CLGaugeFactoryV3", event: "SetPoolMinStakeTime" },
  async ({ event, context }) => {
    const poolId = PoolId(event.chainId, event.params._pool);
    const pool = await context.Pool.get(poolId);

    if (!pool) {
      context.log.error(
        `[CLGaugeFactoryV3] Pool ${event.params._pool} not found on chain ${event.chainId} for SetPoolMinStakeTime`,
      );
      return;
    }

    context.Pool.set({
      ...pool,
      minStakeTime: event.params._minStakeTime,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    });
  },
);

indexer.onEvent(
  { contract: "CLGaugeFactoryV3", event: "SetPenaltyRate" },
  async ({ event, context }) => {
    await applySetPenaltyRate(
      event.chainId,
      event.params._penaltyRate,
      event.block.timestamp,
      context,
    );
  },
);
