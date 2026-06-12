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
//
// Issue #861: the min-of-trusted-legs pick on `volumeInUSD` systematically
// undercounts generated-fee USD by the per-swap slippage (output_USD <
// input_USD by the slippage), so cumulative `totalFeesCollectedUSD` (priced
// from the actually-claimed input-side amounts at Claim time) drifted above
// `totalFeesGeneratedUSD` on 1,313 pools (Base + OP). The fee on-chain is
// charged on the INPUT leg, so the honest USD valuation is the input leg's
// trusted USD × feeRate. We keep the min-pick fallback when the input leg is
// untrusted so the #733/#797 scam-token defense survives.

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
 * Fee USD: `inputUsdValue × (currentFee ?? baseFee ?? 0n) / FEE_SCALE` where
 * `inputUsdValue` is the trusted USD of the swap's input leg (the side fees
 * are actually charged on, on-chain). Falls back to the min-protected
 * `volumeInUSD` when the input leg is untrusted so the #733/#797 scam-token
 * defense survives. Tracks Custom/Dynamic fee-module changes via `currentFee`.
 * `processPoolFees` no longer writes any USD field. See issue #861 for the
 * fix to the slippage-induced collected > generated drift.
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

  // Derive fee USD from the INPUT-side trusted USD (where the fee is actually
  // charged on-chain), but only when it agrees with the other leg within
  // SLIPPAGE_TOLERANCE (10×) — well above realistic AMM slippage but small
  // enough to catch poisoned prices that are typically 1e10× or worse. When
  // input is untrusted OR is wildly out of band with the counterparty, fall
  // back to the min-protected `volumeInUSD` so #733/#797's scam-token defence
  // survives. See file header for the #861 rationale.
  const feeRate =
    liquidityPoolAggregator.currentFee ?? liquidityPoolAggregator.baseFee ?? 0n;
  // `?? 0n` because the trust gate sometimes returns undefined under mocked
  // calculateTokenAmountUSD paths in tests; treating undefined as untrusted
  // keeps the bigint arithmetic safe.
  const inputUsdValue =
    (event.params.amount0In > 0n ? token0UsdValue : token1UsdValue) ?? 0n;
  const counterUsdValue =
    (event.params.amount0In > 0n ? token1UsdValue : token0UsdValue) ?? 0n;
  const SLIPPAGE_TOLERANCE = 10n;
  const inputIsCredible =
    inputUsdValue !== 0n &&
    (counterUsdValue === 0n ||
      inputUsdValue <= counterUsdValue * SLIPPAGE_TOLERANCE);
  const feeBaseUSD = inputIsCredible ? inputUsdValue : volumeInUSD;
  const feeUSD = (feeBaseUSD * feeRate) / FEE_SCALE;

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
