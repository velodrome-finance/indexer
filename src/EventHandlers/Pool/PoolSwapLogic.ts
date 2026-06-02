import type { EvmEvent, Token } from "envio";
import type { PoolDiff } from "../../Aggregators/Pool";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { FEE_SCALE } from "../../Constants";
import type { Pool } from "../../EntityTypes";
import { pickTrustedSwapVolumeUSD } from "../../Helpers";
import { getTrustedUSD } from "../../PriceTrust";

// Issue #797 (completes #733 / regression of #670): V2 fee USD must respect
// the AMM invariant `cumulative_fees ≤ cumulative_volume × fee_ratio`. The V2
// `Pool.Fees` event has only one non-zero leg (fee is taken on the input side),
// so the prior single-leg `pickTrustedSwapVolumeUSD` valuation degenerated to
// "return that one leg unclamped" and inflated/inconsistent input-leg prices
// flowed straight into `totalFeesGeneratedUSD`. We now mirror the CL twin
// (`CLPoolSwapLogic.calculateSwapFees`) and derive the USD fee at Swap time
// from the already-min-protected `volumeInUSD`, multiplied by the pool's
// current fee rate. `processPoolFees` is now USD-silent.

export interface PoolSwapResult {
  liquidityPoolDiff: Partial<PoolDiff>;
  userSwapDiff: Partial<UserStatsPerPoolDiff>;
}

/**
 * Process a V2 Pool Swap event into pool + user diffs.
 *
 * Volume USD: per-leg `getTrustedUSD` then `pickTrustedSwapVolumeUSD` (min of
 * trusted legs) — defends against scam-token / poisoned-oracle inflation
 * (issues #699, #737, #755).
 *
 * Fee USD: `volumeInUSD × (currentFee ?? baseFee ?? 0n) / FEE_SCALE` —
 * inherits the volume path's min-protection by construction and tracks
 * Custom/Dynamic fee-module changes via `currentFee` (issue #797, mirrors
 * `CLPoolSwapLogic.calculateSwapFees`). `processPoolFees` no longer writes
 * any USD field.
 *
 * @param event - V2 Pool Swap event
 * @param liquidityPoolAggregator - Pool entity providing the fee rate
 * @param token0Instance - Token0 entity with price + decimals + trust state
 * @param token1Instance - Token1 entity with price + decimals + trust state
 * @returns Pool + user diffs with raw token-unit volumes and trusted-leg USD volume + fee
 */
export function processPoolSwap(
  event: EvmEvent<"Pool", "Swap">,
  liquidityPoolAggregator: Pool,
  token0Instance: Token,
  token1Instance: Token,
): PoolSwapResult {
  // Calculate net amounts (sum of in and out)
  const netAmount0 = event.params.amount0In + event.params.amount0Out;
  const netAmount1 = event.params.amount1In + event.params.amount1Out;

  // Per-leg USD via PriceTrust gate: untrusted legs contribute 0n. The min
  // pick then guards against scam-token / poisoned-oracle inflation on the
  // remaining trusted leg (issues #699, #737, #755).
  const token0UsdValue = getTrustedUSD(netAmount0, token0Instance);
  const token1UsdValue = getTrustedUSD(netAmount1, token1Instance);

  const volumeInUSD = pickTrustedSwapVolumeUSD(token0UsdValue, token1UsdValue);

  // Derive fee USD from trusted volume — see file header for the #797 rationale.
  const feeRate =
    liquidityPoolAggregator.currentFee ?? liquidityPoolAggregator.baseFee ?? 0n;
  const feeUSD = (volumeInUSD * feeRate) / FEE_SCALE;

  // Create liquidity pool diff.
  //
  // token0Price/token1Price (the pool-internal exchange rate) are intentionally
  // NOT written here. A V2 swap always calls _update → emits Sync in the same
  // tx, and processPoolSync derives the ratio from reserves (#783). Echoing the
  // token oracle prices here would re-inflate the ratio whenever a token is
  // mispriced — exactly the bug #783 fixes — so the field is left to Sync.
  const liquidityPoolDiff = {
    incrementalTotalVolume0: netAmount0,
    incrementalTotalVolume1: netAmount1,
    incrementalTotalVolumeUSD: volumeInUSD,
    incrementalTotalFeesGeneratedUSD: feeUSD,
    incrementalNumberOfSwaps: 1n,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Create user swap diff
  const userSwapDiff = {
    incrementalNumberOfSwaps: 1n,
    incrementalTotalSwapVolumeUSD: volumeInUSD,
    incrementalTotalSwapVolumeAmount0: netAmount0,
    incrementalTotalSwapVolumeAmount1: netAmount1,
    incrementalTotalFeesContributedUSD: feeUSD,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userSwapDiff,
  };
}
