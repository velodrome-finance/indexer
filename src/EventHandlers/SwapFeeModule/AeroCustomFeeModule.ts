import { indexer } from "envio";
import { updatePool } from "../../Aggregators/Pool";
import { PoolId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { Pool } from "../../EntityTypes";
import { resolveCustomSwapFee } from "./CustomSwapFeeSharedLogic";

// Aero V2 pools get custom fees from a per-pool-type CustomFeeModule (one for
// stable, one for volatile pools; pools-<chain>.json). The fee is in basis
// points with the legacy sentinels (ZERO_FEE_INDICATOR() = 420 on-chain; 0 =
// the factory default, 5 bps stable / 30 bps volatile), so it resolves exactly
// like the legacy V2 PoolFactory.SetCustomFee. The fee a swap pays is taken
// from the pool's Fees events, so this only sets the configured fee fields.
indexer.onEvent(
  { contract: "AeroCustomFeeModule", event: "SetCustomFee" },
  async ({ event, context }) => {
    const poolId = PoolId(event.chainId, event.params.pool);
    const pool = await getRehydrated(context.Pool, "Pool", poolId);
    if (!pool) {
      context.log.warn(
        `[AeroCustomFeeModule] Pool ${poolId} not found for SetCustomFee`,
      );
      return;
    }

    const chargedFee = await resolveCustomSwapFee(
      event.params.fee,
      pool,
      false,
      context,
    );
    if (chargedFee === undefined) return;
    const diff: Partial<Pool> = {
      baseFee: chargedFee,
      currentFee: chargedFee, // V2: currentFee = baseFee
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
