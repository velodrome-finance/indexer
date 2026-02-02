import { CustomSwapFeeModule } from "generated";
import type {
  DynamicFeeGlobalConfig,
  LiquidityPoolAggregator,
} from "generated";
import { updateLiquidityPoolAggregator } from "../../Aggregators/LiquidityPoolAggregator";
import { PoolId } from "../../Constants";

CustomSwapFeeModule.SetCustomFee.handler(async ({ event, context }) => {
  const poolId = PoolId(event.chainId, event.params.pool);
  const pool = await context.LiquidityPoolAggregator.get(poolId);

  if (!pool) {
    context.log.warn(`Pool ${poolId} not found for SetCustomFee event`);
    return;
  }

  const diff: Partial<LiquidityPoolAggregator> = {
    baseFee: BigInt(event.params.fee),
    currentFee: BigInt(event.params.fee),
  };

  await updateLiquidityPoolAggregator(
    diff,
    pool,
    new Date(event.block.timestamp * 1000),
    context,
    event.chainId,
    event.block.number,
  );

  const configId = event.srcAddress;

  const config: DynamicFeeGlobalConfig = {
    id: configId,
    chainId: event.chainId,
    secondsAgo: undefined, // This is only defined for DynamicSwapFeeModule.ts
  };

  context.DynamicFeeGlobalConfig.set(config);
});
