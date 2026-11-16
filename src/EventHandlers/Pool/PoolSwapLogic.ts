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

/** The fee a V2 swap paid, from the Fees events it emitted (raw token units). */
export interface V2SwapFees {
  fee0: bigint;
  fee1: bigint;
}

/**
 * Below this input (raw units) a swap's fee is too coarse to measure its rate:
 * with 1e7 units even a 1 bps fee is 1,000 units, so the rate rounds to the
 * exact basis point. Same threshold as the CL path (src/Aggregators/CLSwapFee.ts).
 */
const MIN_AMOUNT_IN_FOR_RATE = 10_000_000n;

/**
 * Effective V2 fee rate of one swap in FEE_SCALE (1e6): the fee over the input
 * amount, rounded to the nearest basis point (V2 fees are whole basis points;
 * the pool floors `amountIn × fee / 10000`, so the measured rate is a hair
 * under the configured one).
 *
 * @param feeIn - Fee taken on the input token (raw units)
 * @param amountIn - Input amount (raw units)
 * @returns The rate in FEE_SCALE, or undefined when `amountIn` is below
 *   {@link MIN_AMOUNT_IN_FOR_RATE}
 */
export function deriveV2FeeRate(
  feeIn: bigint,
  amountIn: bigint,
): bigint | undefined {
  if (amountIn < MIN_AMOUNT_IN_FOR_RATE) return undefined;
  const bps = (feeIn * 20_000n + amountIn) / (2n * amountIn);
  return bps * 100n;
}

/**
 * Process a V2 Pool Swap event into pool + user diffs.
 *
 * Volume USD: per-leg `getTrustedUSD` then `pickTrustedSwapVolumeUSD` (min of
 * trusted legs) — defends against scam-token / poisoned-oracle inflation
 * (issues #699, #737, #755).
 *
 * Fee USD: from the fee the swap actually paid (`swapFees`, the amounts its
 * `Fees` events reported, handed over through V2SwapFeesInTx): the fee legs'
 * trusted USD when the input leg is credible, else the min-protected
 * `volumeInUSD` scaled by `feeIn / amountIn`, so the #733/#797 scam-token
 * defense survives. A stored rate is only used when `swapFees` is not given
 * (callers outside the handler). The stored rate used to be the only source,
 * and it was wrong whenever a fee module the indexer did not follow changed a
 * pool's fee (e.g. a 200 bps leaf stable pool stored at 5 bps).
 *
 * Effective rate: a swap with input >= 1e7 raw units writes `currentFee` =
 * `feeIn / amountIn` rounded to the nearest basis point (FEE_SCALE), as the CL
 * path derives it from the swap. See issue #861 for the slippage-induced
 * collected > generated drift that the input-leg valuation fixes.
 *
 * @param event - V2 Pool Swap event
 * @param liquidityPoolAggregator - Pool entity providing the fallback fee rate
 * @param token0Instance - Token0 entity with price + decimals + trust state
 * @param token1Instance - Token1 entity with price + decimals + trust state
 * @param swapFees - The fee this swap paid (raw units), from its Fees events;
 *   `{fee0: 0n, fee1: 0n}` when it emitted none (a zero fee)
 * @returns Pool + user diffs with raw token-unit volumes and trusted-leg USD volume + fee
 */
export function processPoolSwap(
  event: EvmEvent<"Pool", "Swap">,
  liquidityPoolAggregator: Pool,
  token0Instance: Token,
  token1Instance: Token,
  swapFees?: V2SwapFees,
): PoolSwapResult {
  // Calculate net amounts (sum of in and out)
  const netAmount0 = event.params.amount0In + event.params.amount0Out;
  const netAmount1 = event.params.amount1In + event.params.amount1Out;

  // Per-leg USD via PriceTrust gate: untrusted legs contribute 0n. The min
  // pick then guards against scam-token / poisoned-oracle inflation on the
  // remaining trusted leg (issues #699, #737, #755).
  const token0UsdValue = getTrustedUSD(
    netAmount0,
    token0Instance,
    event.chainId,
  );
  const token1UsdValue = getTrustedUSD(
    netAmount1,
    token1Instance,
    event.chainId,
  );

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
  const inputIsToken0 = event.params.amount0In > 0n;
  const amountIn = inputIsToken0
    ? event.params.amount0In
    : event.params.amount1In;
  let feeUSD: bigint;
  let measuredRate: bigint | undefined;
  if (swapFees) {
    const feeIn = inputIsToken0 ? swapFees.fee0 : swapFees.fee1;
    measuredRate = deriveV2FeeRate(feeIn, amountIn);
    if (inputIsCredible) {
      // The fee legs at their token prices (both legs when both were input).
      feeUSD =
        getTrustedUSD(swapFees.fee0, token0Instance, event.chainId) +
        getTrustedUSD(swapFees.fee1, token1Instance, event.chainId);
    } else {
      feeUSD = amountIn > 0n ? (volumeInUSD * feeIn) / amountIn : 0n;
    }
  } else {
    const feeBaseUSD = inputIsCredible ? inputUsdValue : volumeInUSD;
    feeUSD = (feeBaseUSD * feeRate) / FEE_SCALE;
  }

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
    ...(measuredRate !== undefined ? { currentFee: measuredRate } : {}),
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
