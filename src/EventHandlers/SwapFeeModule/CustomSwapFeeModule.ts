import { indexer } from "envio";
import type { DynamicFeeGlobalConfig } from "envio";
import { updatePool } from "../../Aggregators/Pool";
import { PoolId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { Pool } from "../../EntityTypes";

indexer.onEvent(
  { contract: "CustomSwapFeeModule", event: "SetCustomFee" },
  async ({ event, context }) => {
    const poolId = PoolId(event.chainId, event.params.pool);
    const pool = await getRehydrated(context.Pool, "Pool", poolId);

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
  },
);
