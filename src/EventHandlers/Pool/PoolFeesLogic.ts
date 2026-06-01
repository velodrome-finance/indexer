import type { EvmEvent } from "envio";
import type { PoolDiff } from "../../Aggregators/Pool";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";

export interface PoolFeesResult {
  liquidityPoolDiff?: Partial<PoolDiff>;
  userDiff?: Partial<UserStatsPerPoolDiff>;
}

/**
 * Process a V2 Pool Fees event into raw token-amount diffs only.
 *
 * USD fee aggregates are deliberately NOT written here. Per issue #797 they
 * are now derived in `processPoolSwap` from trusted volume × pool fee rate
 * (`volumeInUSD × currentFee / V2_FEE_SCALE`), mirroring CL's path
 * (`CLPoolSwapLogic.calculateSwapFees`) and completing the #733 / regression
 * of #670 invariant `cumulative_fees ≤ cumulative_volume × fee_ratio`. The
 * Fees event only carries the input-side leg, so its old single-leg
 * `pickTrustedSwapVolumeUSD` valuation had no second leg to clamp against and
 * leaked any inflated/inconsistent input price straight into the USD
 * aggregate (1000/1000 `[FEE_VOLUME_DIVERGENCE]` warned pools on c9b8978 were V2).
 *
 * @param event - V2 Pool Fees event
 * @returns Pool and user diffs with raw token-unit fee amounts only
 */
export function processPoolFees(
  event: EvmEvent<"Pool", "Fees">,
): PoolFeesResult {
  // Create liquidity pool diff — raw token amounts only; USD fee is written
  // in processPoolSwap (see file-top doc / issue #797).
  const liquidityPoolDiff = {
    incrementalTotalFeesGenerated0: event.params.amount0,
    incrementalTotalFeesGenerated1: event.params.amount1,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Prepare user diff data
  const userDiff = {
    incrementalTotalFeesContributed0: event.params.amount0,
    incrementalTotalFeesContributed1: event.params.amount1,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userDiff,
  };
}
