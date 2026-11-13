import { indexer } from "envio";
import type { DynamicFeeGlobalConfig } from "envio";
import { updatePool } from "../../Aggregators/Pool";
import { PoolId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { Pool } from "../../EntityTypes";
import { resolveCustomSwapFee } from "./CustomSwapFeeSharedLogic";
import { DynamicFeeGlobalConfigId } from "./DynamicFeeGlobalConfigSharedLogic";

indexer.onEvent(
  { contract: "DynamicSwapFeeModule", event: "CustomFeeSet" },
  async ({ event, context }) => {
    const poolId = PoolId(event.chainId, event.params.pool);
    const pool = await getRehydrated(context.Pool, "Pool", poolId);

    if (!pool) {
      context.log.warn(`Pool ${poolId} not found for CustomFeeSet event`);
      return;
    }

    // The custom base fee the module charges (FEE_SCALE 1e6): 420 is the
    // zero-fee indicator, 0 resets to the tick-spacing default. The dynamic
    // part on top of it is measured per swap into currentFee.
    const baseFee = await resolveCustomSwapFee(
      BigInt(event.params.fee),
      pool,
      true,
      context,
    );
    if (baseFee === undefined) {
      return;
    }
    const diff: Partial<Pool> = {
      baseFee,
    };

    await updatePool(
      diff,
      pool,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  },
);

indexer.onEvent(
  { contract: "DynamicSwapFeeModule", event: "SecondsAgoSet" },
  async ({ event, context }) => {
    // secondsAgo is a global setting for the DynamicSwapFeeModule
    // Store it in the DynamicFeeGlobalConfig entity
    const configId = DynamicFeeGlobalConfigId(event.chainId, event.srcAddress);

    const config: DynamicFeeGlobalConfig = {
      id: configId,
      chainId: event.chainId,
      secondsAgo: BigInt(event.params.secondsAgo),
    };

    context.DynamicFeeGlobalConfig.set(config);
  },
);

indexer.onEvent(
  { contract: "DynamicSwapFeeModule", event: "ScalingFactorSet" },
  async ({ event, context }) => {
    const poolId = PoolId(event.chainId, event.params.pool);
    const pool = await getRehydrated(context.Pool, "Pool", poolId);

    if (!pool) {
      context.log.warn(`Pool ${poolId} not found for ScalingFactorSet event`);
      return;
    }

    const diff: Partial<Pool> = {
      scalingFactor: BigInt(event.params.scalingFactor),
    };

    await updatePool(
      diff,
      pool,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  },
);

indexer.onEvent(
  { contract: "DynamicSwapFeeModule", event: "FeeCapSet" },
  async ({ event, context }) => {
    const poolId = PoolId(event.chainId, event.params.pool);
    const pool = await getRehydrated(context.Pool, "Pool", poolId);

    if (!pool) {
      context.log.warn(`Pool ${poolId} not found for FeeCapSet event`);
      return;
    }

    const diff: Partial<Pool> = {
      feeCap: BigInt(event.params.feeCap),
    };

    await updatePool(
      diff,
      pool,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  },
);
