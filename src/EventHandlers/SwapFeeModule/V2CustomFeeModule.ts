import { indexer } from "envio";
import { updatePool } from "../../Aggregators/Pool";
import { PoolId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { Pool } from "../../EntityTypes";
import { resolveCustomSwapFee } from "./CustomSwapFeeSharedLogic";

// V2 custom-fee modules: the superchain leaf PoolFactory's fee module (its
// `feeModule()`, set by FeeModuleChanged) and the Aero stable / volatile
// CustomFeeModules (pools-<chain>.json). All emit SetCustomFee(address indexed
// pool, uint256 indexed fee) in basis points with the legacy sentinels
// (ZERO_FEE_INDICATOR() = 420 on-chain; 0 = the factory default), so they
// resolve like the Optimism / Base PoolFactory.SetCustomFee. The fee a swap
// pays is taken from the pool's Fees events; this sets the configured fee.
indexer.onEvent(
  { contract: "V2CustomFeeModule", event: "SetCustomFee" },
  async ({ event, context }) => {
    const poolId = PoolId(event.chainId, event.params.pool);
    const pool = await getRehydrated(context.Pool, "Pool", poolId);
    if (!pool) {
      context.log.warn(
        `[V2CustomFeeModule] Pool ${poolId} not found for SetCustomFee`,
      );
      return;
    }

    const chargedFee = await resolveCustomSwapFee(
      event.params.fee,
      pool,
      false,
      context,
      event.chainId,
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
