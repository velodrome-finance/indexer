import { indexer } from "envio";
import type { DynamicFeeGlobalConfig } from "envio";
import { updatePool } from "../../Aggregators/Pool";
import { PoolId, toCanonicalFeeScale } from "../../Constants";
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

    // Lift to canonical FEE_SCALE (1e6). Keyed on pool.isCL so the stored fee
    // matches the single divisor regardless of which pool type the module
    // targets (issue #812).
    const canonicalFee = toCanonicalFeeScale(
      BigInt(event.params.fee),
      pool.isCL,
    );
    const diff: Partial<Pool> = {
      baseFee: canonicalFee,
      currentFee: canonicalFee,
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
