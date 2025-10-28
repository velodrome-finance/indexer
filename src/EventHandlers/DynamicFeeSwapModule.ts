import { DynamicFeeSwapModule } from "generated";
import type {
  DynamicFeeGlobalConfig,
  LiquidityPoolAggregator,
} from "generated";
import { updateLiquidityPoolAggregator } from "../Aggregators/LiquidityPoolAggregator";
import { toChecksumAddress } from "../Constants";

DynamicFeeSwapModule.CustomFeeSet.handler(async ({ event, context }) => {
  const pool = await context.LiquidityPoolAggregator.get(
    toChecksumAddress(event.params.pool),
  );

  if (!pool) {
    context.log.warn(
      `Pool ${event.params.pool} not found for CustomFeeSet event`,
    );
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

DynamicFeeSwapModule.SecondsAgoSet.handler(async ({ event, context }) => {
  // secondsAgo is a global setting for the DynamicFeeSwapModule
  // Store it in the DynamicFeeGlobalConfig entity
  const configId = toChecksumAddress(event.srcAddress);

  const config: DynamicFeeGlobalConfig = {
    id: configId,
    chainId: event.chainId,
    secondsAgo: BigInt(event.params.secondsAgo),
  };

  context.DynamicFeeGlobalConfig.set(config);
});

DynamicFeeSwapModule.ScalingFactorSet.handler(async ({ event, context }) => {
  const pool = await context.LiquidityPoolAggregator.get(
    toChecksumAddress(event.params.pool),
  );

  if (!pool) {
    context.log.warn(
      `Pool ${event.params.pool} not found for ScalingFactorSet event`,
    );
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

DynamicFeeSwapModule.FeeCapSet.handler(async ({ event, context }) => {
  const pool = await context.LiquidityPoolAggregator.get(
    toChecksumAddress(event.params.pool),
  );

  if (!pool) {
    context.log.warn(`Pool ${event.params.pool} not found for FeeCapSet event`);
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
