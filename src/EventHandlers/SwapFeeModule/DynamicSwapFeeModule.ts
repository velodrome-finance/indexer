import { DynamicSwapFeeModule } from "generated";
import type { DynamicFeeGlobalConfig } from "generated";
import { updatePool } from "../../Aggregators/Pool";
import { PoolId } from "../../Constants";
import type { Pool } from "../../EntityTypes";

DynamicSwapFeeModule.CustomFeeSet.handler(async ({ event, context }) => {
  const poolId = PoolId(event.chainId, event.params.pool);
  const pool = await context.Pool.get(poolId);

  if (!pool) {
    context.log.warn(`Pool ${poolId} not found for CustomFeeSet event`);
    return;
  }

  const diff: Partial<Pool> = {
    baseFee: BigInt(event.params.fee),
  };

  await updatePool(
    diff,
    pool,
    new Date(event.block.timestamp * 1000),
    context,
    event.chainId,
    event.block.number,
  );
});

DynamicSwapFeeModule.SecondsAgoSet.handler(async ({ event, context }) => {
  // secondsAgo is a global setting for the DynamicSwapFeeModule
  // Store it in the DynamicFeeGlobalConfig entity
  const configId = event.srcAddress;

  const config: DynamicFeeGlobalConfig = {
    id: configId,
    chainId: event.chainId,
    secondsAgo: BigInt(event.params.secondsAgo),
  };

  context.DynamicFeeGlobalConfig.set(config);
});

DynamicSwapFeeModule.ScalingFactorSet.handler(async ({ event, context }) => {
  const poolId = PoolId(event.chainId, event.params.pool);
  const pool = await context.Pool.get(poolId);

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
});

DynamicSwapFeeModule.FeeCapSet.handler(async ({ event, context }) => {
  const poolId = PoolId(event.chainId, event.params.pool);
  const pool = await context.Pool.get(poolId);

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
});
