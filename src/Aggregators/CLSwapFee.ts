import { FEE_SCALE } from "../Constants";

/**
 * Swap-derived CL fee (replaces the per-hour `getSwapFee` archive `eth_call`).
 *
 * A Slipstream swap charges its fee on the input token only, and the fee never
 * moves the price: every swap step takes `principal + fee` from the trader,
 * where `principal` is exactly the token amount implied by the sqrt-price move
 * at the step's in-range liquidity (`L·Δ√P` for token1, `L·Δ(1/√P)` for
 * token0). `processTickCrossings(…, "total")` integrates that principal over
 * the pool's tick map, so for the input token
 *
 *     feeIn = amountIn − principalIn,   effective rate = feeIn / amountIn.
 *
 * This is the fee the pool actually charged, including the per-step round-up
 * and the exact-input remainder that Slipstream credits to LPs, so it is exact
 * on dynamic-fee pools whose rate moves swap to swap. Verified against the
 * chain by `scripts/verify-cl-fee-derivation.ts`.
 */

/**
 * A derived fee above `amountIn / MAX_PLAUSIBLE_FEE_DIVISOR` (10%) is treated
 * as tick-map drift, not a real fee: Slipstream's `MAX_FEE` is 3% (dynamic fee
 * caps sit well below that). The one legitimate exception is a dust swap too
 * small to move the price, where the whole input is fee; it also lands here and
 * is valued with the stored rate, which differs by a few wei.
 */
export const MAX_PLAUSIBLE_FEE_DIVISOR = 10n;

/**
 * Minimum input amount (raw token units) for a swap's effective rate to be
 * written to `Pool.currentFee`. The derived fee carries about one wei of
 * rounding per swap step (Slipstream rounds the fee and the principal up per
 * step; the indexer rounds the principal to nearest per tick segment), so the
 * rate of a tiny swap is noisy in FEE_SCALE units: on chain, a 1.96e6-wei swap
 * on a 360 pool shows 360.97. At 1e7 wei, one wei is 0.1 FEE_SCALE units, so
 * a swap crossing up to three ticks still rounds to the charged integer rate
 * (verified swaps from 8.9e6 wei up round correctly). Smaller swaps still
 * record their exact derived fee amounts; they just leave `currentFee` as it
 * was. 1e7 wei is $10 of a 6-decimal stablecoin, 0.1 of an 8-decimal token
 * and dust for 18-decimal tokens.
 */
export const MIN_AMOUNT_IN_FOR_FEE_RATE = 10_000_000n;

/** Why a swap's fee could not be derived from its price move. */
export type CLSwapFeeFallbackReason =
  /** The walk's ending in-range liquidity differs from the event's `liquidity`. */
  | "liquidity_mismatch"
  /** amountIn < principalIn: the walk over-counts the principal. */
  | "negative_fee"
  /** feeIn > amountIn / {@link MAX_PLAUSIBLE_FEE_DIVISOR}. */
  | "fee_above_cap";

/** Inputs to {@link deriveCLSwapFee}; all amounts in raw token units. */
export interface CLSwapFeeInput {
  /** `Swap.amount0` (signed; positive = into the pool). */
  amount0: bigint;
  /** `Swap.amount1` (signed; positive = into the pool). */
  amount1: bigint;
  /** Fee-free token0 delta from `processTickCrossings(…, "total")`. */
  principal0: bigint;
  /** Fee-free token1 delta from `processTickCrossings(…, "total")`. */
  principal1: bigint;
  /** In-range liquidity at the end of the walk. */
  walkEndLiquidity: bigint;
  /** `Swap.liquidity`: the pool's authoritative post-swap in-range liquidity. */
  eventLiquidity: bigint;
}

/** Result of {@link deriveCLSwapFee}. */
export type CLSwapFeeDerivation =
  | {
      ok: true;
      /** Fee charged in token0 (raw units; 0 when token1 was the input). */
      feeAmount0: bigint;
      /** Fee charged in token1 (raw units; 0 when token0 was the input). */
      feeAmount1: bigint;
      /** Input amount the fee was charged on (raw units of the input token). */
      amountIn: bigint;
      /**
       * Effective rate in FEE_SCALE (1e6) units, rounded half-up, or undefined
       * when the swap is too small for the rate to be meaningful
       * ({@link MIN_AMOUNT_IN_FOR_FEE_RATE}) or had no input.
       */
      feeRate: bigint | undefined;
    }
  | {
      ok: false;
      reason: CLSwapFeeFallbackReason;
      /** The rejected `amountIn − principalIn`, for the diagnostic log. */
      derivedFee: bigint;
      /** Input amount (raw units of the input token). */
      amountIn: bigint;
    };

/**
 * Derives a CL swap's fee from its price move: `feeIn = amountIn − principalIn`
 * on the input token, guarded against tick-map drift.
 *
 * Rejects the derivation (caller falls back to the stored rate) when the walk's
 * ending in-range liquidity disagrees with the event's, when the derived fee is
 * negative, or when it exceeds 10% of `amountIn`. A swap with no positive leg
 * (both amounts ≤ 0, which Slipstream never emits) derives a zero fee.
 *
 * @param input - Event amounts, the walk's principal deltas and liquidities
 * @returns The fee per token and the effective rate, or the rejection reason
 */
export function deriveCLSwapFee(input: CLSwapFeeInput): CLSwapFeeDerivation {
  const token0In = input.amount0 > 0n;
  const token1In = !token0In && input.amount1 > 0n;
  if (!token0In && !token1In) {
    return {
      ok: true,
      feeAmount0: 0n,
      feeAmount1: 0n,
      amountIn: 0n,
      feeRate: undefined,
    };
  }
  const amountIn = token0In ? input.amount0 : input.amount1;
  const principalIn = token0In ? input.principal0 : input.principal1;
  const fee = amountIn - principalIn;

  if (input.walkEndLiquidity !== input.eventLiquidity) {
    return {
      ok: false,
      reason: "liquidity_mismatch",
      derivedFee: fee,
      amountIn,
    };
  }
  if (fee < 0n) {
    return { ok: false, reason: "negative_fee", derivedFee: fee, amountIn };
  }
  if (fee * MAX_PLAUSIBLE_FEE_DIVISOR > amountIn) {
    return { ok: false, reason: "fee_above_cap", derivedFee: fee, amountIn };
  }

  const feeRate =
    amountIn >= MIN_AMOUNT_IN_FOR_FEE_RATE
      ? (fee * FEE_SCALE * 2n + amountIn) / (2n * amountIn)
      : undefined;
  return {
    ok: true,
    feeAmount0: token0In ? fee : 0n,
    feeAmount1: token0In ? 0n : fee,
    amountIn,
    feeRate,
  };
}
