import { indexer } from "envio";
import type { DynamicFeeGlobalConfig } from "envio";
import { updatePool } from "../../Aggregators/Pool";
import { PoolId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { Pool } from "../../EntityTypes";
import { resolveCustomSwapFee } from "./CustomSwapFeeSharedLogic";
import { DynamicFeeGlobalConfigId } from "./DynamicFeeGlobalConfigSharedLogic";

indexer.onEvent(
  { contract: "CustomSwapFeeModule", event: "SetCustomFee" },
  async ({ event, context }) => {
    const poolId = PoolId(event.chainId, event.params.pool);
    const pool = await getRehydrated(context.Pool, "Pool", poolId);

    if (!pool) {
      context.log.warn(`Pool ${poolId} not found for SetCustomFee event`);
      return;
    }

    // Store the fee the module charges, in canonical FEE_SCALE (1e6): 420 is
    // the zero-fee indicator, 0 resets to the tick-spacing default, anything
    // else is lifted keyed on pool.isCL (issue #812). For a CL pool currentFee
    // is then re-measured by every swap; this seeds the fallback rate.
    const chargedFee = await resolveCustomSwapFee(
      BigInt(event.params.fee),
      pool,
      pool.isCL,
      context,
    );
    if (chargedFee !== undefined) {
      const diff: Partial<Pool> = {
        baseFee: chargedFee,
        currentFee: chargedFee,
      };

      await updatePool(
        diff,
        pool,
        new Date(event.block.timestamp * 1000),
        context,
        event.chainId,
        event.block.number,
      );
    }

    const configId = DynamicFeeGlobalConfigId(event.chainId, event.srcAddress);

    const config: DynamicFeeGlobalConfig = {
      id: configId,
      secondsAgo: undefined, // This is only defined for DynamicSwapFeeModule.ts
    };

    context.DynamicFeeGlobalConfig.set(config);
  },
);
