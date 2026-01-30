import { DynamicSwapFeeModule } from "generated";
import type {
  DynamicFeeGlobalConfig,
  LiquidityPoolAggregator,
} from "generated";
import { updateLiquidityPoolAggregator } from "../../Aggregators/LiquidityPoolAggregator";
import { PoolId } from "../../Constants";

DynamicSwapFeeModule.CustomFeeSet.handler(async ({ event, context }) => {
  const poolId = PoolId(event.chainId, event.params.pool);
  const pool = await context.LiquidityPoolAggregator.get(poolId);

  if (!pool) {
    context.log.warn(`Pool ${poolId} not found for CustomFeeSet event`);
    return;
  }

  const diff: Partial<LiquidityPoolAggregator> = {
    baseFee: BigInt(event.params.fee),
  };

  await updateLiquidityPoolAggregator(
    diff,
    pool,
    new Date(event.block.timestamp * 1000),
    context,
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
  const pool = await context.LiquidityPoolAggregator.get(poolId);

  if (!pool) {
    context.log.warn(`Pool ${poolId} not found for ScalingFactorSet event`);
    return;
  }

  const diff: Partial<LiquidityPoolAggregator> = {
    scalingFactor: BigInt(event.params.scalingFactor),
  };

  await updateLiquidityPoolAggregator(
    diff,
    pool,
    new Date(event.block.timestamp * 1000),
    context,
    event.block.number,
  );
});

DynamicSwapFeeModule.FeeCapSet.handler(async ({ event, context }) => {
  const poolId = PoolId(event.chainId, event.params.pool);
  const pool = await context.LiquidityPoolAggregator.get(poolId);

  if (!pool) {
    context.log.warn(`Pool ${poolId} not found for FeeCapSet event`);
    return;
  }

  const diff: Partial<LiquidityPoolAggregator> = {
    feeCap: BigInt(event.params.feeCap),
  };

  await updateLiquidityPoolAggregator(
    diff,
    pool,
    new Date(event.block.timestamp * 1000),
    context,
    event.block.number,
  );
});
