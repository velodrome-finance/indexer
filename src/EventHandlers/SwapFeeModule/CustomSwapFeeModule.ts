import { CustomSwapFeeModule } from "generated";
import type { DynamicFeeGlobalConfig } from "generated";
import { updatePool } from "../../Aggregators/Pool";
import { PoolId } from "../../Constants";
import type { Pool } from "../../EntityTypes";

CustomSwapFeeModule.SetCustomFee.handler(async ({ event, context }) => {
  const poolId = PoolId(event.chainId, event.params.pool);
  const pool = await context.Pool.get(poolId);

  if (!pool) {
    context.log.warn(`Pool ${poolId} not found for SetCustomFee event`);
    return;
  }

  const diff: Partial<Pool> = {
    baseFee: BigInt(event.params.fee),
    currentFee: BigInt(event.params.fee),
  };

  await updatePool(
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
