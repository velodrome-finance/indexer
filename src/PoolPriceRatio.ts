import { TEN_TO_THE_18_BI } from "./Constants";

/** 2^192 — denominator of `(sqrtPriceX96 / 2^96)^2` once the square is taken. */
const Q192 = 2n ** 192n;

/**
 * A pool's internal exchange-rate pair, both as 1e18 fixed-point BigInts.
 *
 * These are derived purely from the pool's own state (reserves for V2,
 * `sqrtPriceX96` for CL) and are therefore independent of the token price
 * oracle. The field semantics match `Pool.token0Price` / `Pool.token1Price`
 * in schema.graphql.
 */
export interface PoolPriceRatios {
  /** Price of token0 denominated in token1 (whole token1 per whole token0), 1e18-scaled. */
  token0Price: bigint;
  /** Price of token1 denominated in token0 (whole token0 per whole token1), 1e18-scaled. */
  token1Price: bigint;
}

/**
 * Derives a V2 (constant-product) pool's internal price ratios from its reserves.
 *
 * The marginal price of token0 in token1 units is `reserve1 / reserve0`,
 * decimal-adjusted to whole-token units and scaled to 1e18 fixed point.
 * `token1Price` is the exact reciprocal ratio (computed independently from the
 * same reserves rather than from `token0Price`, to avoid compounding rounding).
 *
 * All multiplications are applied before the single trailing division so the
 * result keeps maximum integer precision (no intermediate truncation).
 *
 * @param reserve0 - Reserve of token0 in raw token units
 * @param reserve1 - Reserve of token1 in raw token units
 * @param decimals0 - Decimals of token0
 * @param decimals1 - Decimals of token1
 * @returns The 1e18-scaled ratio pair, or `{0n, 0n}` when either reserve is
 *   non-positive (an empty pool has no defined price).
 */
export function deriveV2PriceRatios(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: bigint,
  decimals1: bigint,
): PoolPriceRatios {
  if (reserve0 <= 0n || reserve1 <= 0n) {
    return { token0Price: 0n, token1Price: 0n };
  }
  const scale0 = 10n ** decimals0;
  const scale1 = 10n ** decimals1;
  const token0Price =
    (reserve1 * scale0 * TEN_TO_THE_18_BI) / (reserve0 * scale1);
  const token1Price =
    (reserve0 * scale1 * TEN_TO_THE_18_BI) / (reserve1 * scale0);
  return { token0Price, token1Price };
}

/**
 * Derives a CL (Uniswap-v3-style) pool's internal price ratios from `sqrtPriceX96`.
 *
 * The raw on-chain price (token1 per token0, in smallest units) is
 * `(sqrtPriceX96 / 2^96)^2`; decimal-adjusting to whole-token units and scaling
 * to 1e18 fixed point gives `token0Price`. `token1Price` is the reciprocal
 * ratio, computed independently from the same `sqrtPriceX96`.
 *
 * Squaring is done before dividing by `2^192` (and all decimal/scale factors
 * are folded into the numerator) so the single trailing division keeps maximum
 * integer precision.
 *
 * @param sqrtPriceX96 - Current pool sqrt price as Q64.96 fixed point
 * @param decimals0 - Decimals of token0
 * @param decimals1 - Decimals of token1
 * @returns The 1e18-scaled ratio pair, or `{0n, 0n}` when `sqrtPriceX96` is
 *   non-positive (an uninitialised pool has no defined price).
 */
export function deriveCLPriceRatios(
  sqrtPriceX96: bigint,
  decimals0: bigint,
  decimals1: bigint,
): PoolPriceRatios {
  if (sqrtPriceX96 <= 0n) {
    return { token0Price: 0n, token1Price: 0n };
  }
  const scale0 = 10n ** decimals0;
  const scale1 = 10n ** decimals1;
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  const token0Price = (priceX192 * scale0 * TEN_TO_THE_18_BI) / (Q192 * scale1);
  const token1Price = (Q192 * scale1 * TEN_TO_THE_18_BI) / (priceX192 * scale0);
  return { token0Price, token1Price };
}

/**
 * Merges freshly derived ratios with the pool's last-known ratios, keeping the
 * last-known value for any leg that derives to a non-positive (0n) price.
 *
 * Both the CL Swap and V2 Sync writers compute ratios from live pool state, but
 * that state is momentarily undefined for an empty/uninitialised pool (zero
 * reserves or `sqrtPriceX96`) or when token decimals are unavailable — cases
 * where the derive functions return `0n`. Writing `0n` would clobber a
 * previously valid ratio with a meaningless zero, so each non-positive leg
 * falls back to its last-known value instead. Centralizing the rule here keeps
 * it identical across both writers (#783).
 *
 * @param derived - Ratios computed from current pool state (legs may be 0n)
 * @param lastKnown - The pool's previously stored ratios to fall back on
 * @returns The 1e18-scaled ratio pair with each non-positive leg replaced by
 *   its last-known value.
 */
export function pickPriceRatios(
  derived: PoolPriceRatios,
  lastKnown: PoolPriceRatios,
): PoolPriceRatios {
  return {
    token0Price:
      derived.token0Price > 0n ? derived.token0Price : lastKnown.token0Price,
    token1Price:
      derived.token1Price > 0n ? derived.token1Price : lastKnown.token1Price,
  };
}
