import { TEN_TO_THE_18_BI } from "./Constants";

/** 2^192 — denominator of `(sqrtPriceX96 / 2^96)^2` once the square is taken. */
const Q192 = 2n ** 192n;

/**
 * A pool's internal exchange-rate pair, both as 1e18 fixed-point BigInts.
 *
 * These are derived purely from the pool's own state (reserves for V2,
 * `sqrtPriceX96` for CL) and are therefore independent of any token's USD
 * price. The field semantics match `Pool.token0Price` / `Pool.token1Price`
 * in schema.graphql.
 */
export interface PoolPriceRatios {
  /** Price of token0 denominated in token1 (whole token1 per whole token0), 1e18-scaled. */
  token0Price: bigint;
  /** Price of token1 denominated in token0 (whole token0 per whole token1), 1e18-scaled. */
  token1Price: bigint;
}

/**
 * An exact spot price as a fraction `num / den`, in whole-token units:
 * how many whole token1 one whole token0 is worth. Kept unreduced and
 * undivided so callers can fold further factors (a USD price, a 1e18 scale)
 * into the numerator before the single trailing division — no intermediate
 * truncation, which matters for very cheap tokens.
 */
export interface SpotPriceFraction {
  readonly num: bigint;
  readonly den: bigint;
}

/**
 * Spot price of token0 in token1 for a V2 volatile (constant-product,
 * `x·y = k`) pool: `(reserve1 / 10^d1) / (reserve0 / 10^d0)`.
 *
 * @param reserve0 - Reserve of token0 in raw token units
 * @param reserve1 - Reserve of token1 in raw token units
 * @param decimals0 - Decimals of token0 (0 is a valid value)
 * @param decimals1 - Decimals of token1 (0 is a valid value)
 * @returns The exact fraction, or `undefined` when either reserve is
 *   non-positive (an empty pool has no defined price).
 */
export function v2VolatileSpotPrice0(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: bigint,
  decimals1: bigint,
): SpotPriceFraction | undefined {
  if (reserve0 <= 0n || reserve1 <= 0n) return undefined;
  return {
    num: reserve1 * 10n ** decimals0,
    den: reserve0 * 10n ** decimals1,
  };
}

/**
 * Spot (marginal) price of token0 in token1 for a V2 stable (sAMM) pool.
 *
 * Velodrome/Aerodrome stable pools trade on `k = x³y + xy³` where `x`, `y` are
 * the reserves normalised to whole-token units (`Pool._k` scales each reserve
 * by `1e18 / 10^decimals` before applying the curve). The marginal price is the
 * slope of the invariant curve:
 *
 *     dy/dx = (∂k/∂x) / (∂k/∂y) = (3x²y + y³) / (x³ + 3xy²)
 *           = y·(3x² + y²) / (x·(x² + 3y²))
 *
 * which is exactly 1 for a balanced pool and moves far less than the
 * constant-product ratio `y/x` as the pool becomes imbalanced (x = 2y gives
 * 0.93, not 0.5).
 *
 * The expression is homogeneous of degree 0 in (x, y), so instead of dividing
 * each reserve by its own `10^decimals` (and truncating) both are multiplied by
 * the common factor `10^d0 · 10^d1`: `x' = reserve0 · 10^d1`,
 * `y' = reserve1 · 10^d0`. The result is exact for any decimals pair,
 * including 0-decimal tokens.
 *
 * @param reserve0 - Reserve of token0 in raw token units
 * @param reserve1 - Reserve of token1 in raw token units
 * @param decimals0 - Decimals of token0 (0 is a valid value)
 * @param decimals1 - Decimals of token1 (0 is a valid value)
 * @returns The exact fraction, or `undefined` when either reserve is
 *   non-positive.
 */
export function v2StableSpotPrice0(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: bigint,
  decimals1: bigint,
): SpotPriceFraction | undefined {
  if (reserve0 <= 0n || reserve1 <= 0n) return undefined;
  const x = reserve0 * 10n ** decimals1;
  const y = reserve1 * 10n ** decimals0;
  return {
    num: y * (3n * x * x + y * y),
    den: x * (x * x + 3n * y * y),
  };
}

/**
 * Spot price of token0 in token1 for a CL (Uniswap-v3-style) pool:
 * `(sqrtPriceX96 / 2^96)² · 10^d0 / 10^d1`.
 *
 * @param sqrtPriceX96 - Current pool sqrt price as Q64.96 fixed point
 * @param decimals0 - Decimals of token0 (0 is a valid value)
 * @param decimals1 - Decimals of token1 (0 is a valid value)
 * @returns The exact fraction, or `undefined` when `sqrtPriceX96` is
 *   non-positive (an uninitialised pool has no defined price).
 */
export function clSpotPrice0(
  sqrtPriceX96: bigint,
  decimals0: bigint,
  decimals1: bigint,
): SpotPriceFraction | undefined {
  if (sqrtPriceX96 <= 0n) return undefined;
  return {
    num: sqrtPriceX96 * sqrtPriceX96 * 10n ** decimals0,
    den: Q192 * 10n ** decimals1,
  };
}

/**
 * Spot price of token0 in token1 for any pool kind, dispatching on the pool's
 * shape: CL pools use `sqrtPriceX96`, V2 stable pools the sAMM marginal price,
 * V2 volatile pools the reserve ratio.
 *
 * @param pool - The pool state the price is read from
 * @param pool.isCL - Whether the pool is a CL pool
 * @param pool.isStable - Whether a V2 pool is a stable (sAMM) pool
 * @param pool.reserve0 - Reserve of token0 in raw token units (V2)
 * @param pool.reserve1 - Reserve of token1 in raw token units (V2)
 * @param pool.sqrtPriceX96 - Current sqrt price (CL); nullish ⇒ uninitialised
 * @param decimals0 - Decimals of token0
 * @param decimals1 - Decimals of token1
 * @returns The exact fraction, or `undefined` when the pool has no defined price
 */
export function poolSpotPrice0(
  pool: {
    readonly isCL: boolean;
    readonly isStable: boolean;
    readonly reserve0: bigint;
    readonly reserve1: bigint;
    readonly sqrtPriceX96?: bigint | null;
  },
  decimals0: bigint,
  decimals1: bigint,
): SpotPriceFraction | undefined {
  if (pool.isCL) {
    return clSpotPrice0(pool.sqrtPriceX96 ?? 0n, decimals0, decimals1);
  }
  if (pool.isStable) {
    return v2StableSpotPrice0(
      pool.reserve0,
      pool.reserve1,
      decimals0,
      decimals1,
    );
  }
  return v2VolatileSpotPrice0(
    pool.reserve0,
    pool.reserve1,
    decimals0,
    decimals1,
  );
}

/**
 * Converts an exact token0-in-token1 fraction into the 1e18-scaled ratio pair.
 * `token1Price` is the reciprocal, computed independently from the same
 * fraction rather than from `token0Price`, so neither leg compounds the other's
 * rounding.
 *
 * @param fraction - Exact spot price of token0 in token1, or `undefined`
 * @returns The 1e18-scaled ratio pair, or `{0n, 0n}` when `fraction` is undefined
 */
function ratiosFromFraction(
  fraction: SpotPriceFraction | undefined,
): PoolPriceRatios {
  if (!fraction) return { token0Price: 0n, token1Price: 0n };
  return {
    token0Price: (fraction.num * TEN_TO_THE_18_BI) / fraction.den,
    token1Price: (fraction.den * TEN_TO_THE_18_BI) / fraction.num,
  };
}

/**
 * Derives a V2 volatile (constant-product) pool's internal price ratios from
 * its reserves: `token0Price = reserve1 / reserve0`, decimal-adjusted to
 * whole-token units and scaled to 1e18.
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
  return ratiosFromFraction(
    v2VolatileSpotPrice0(reserve0, reserve1, decimals0, decimals1),
  );
}

/**
 * Derives a V2 stable (sAMM, `x³y + xy³`) pool's internal price ratios from its
 * reserves using the curve's marginal price (see {@link v2StableSpotPrice0}).
 *
 * @param reserve0 - Reserve of token0 in raw token units
 * @param reserve1 - Reserve of token1 in raw token units
 * @param decimals0 - Decimals of token0
 * @param decimals1 - Decimals of token1
 * @returns The 1e18-scaled ratio pair, or `{0n, 0n}` when either reserve is
 *   non-positive.
 */
export function deriveV2StablePriceRatios(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: bigint,
  decimals1: bigint,
): PoolPriceRatios {
  return ratiosFromFraction(
    v2StableSpotPrice0(reserve0, reserve1, decimals0, decimals1),
  );
}

/**
 * Derives a CL (Uniswap-v3-style) pool's internal price ratios from
 * `sqrtPriceX96`: `token0Price = (sqrtPriceX96 / 2^96)²`, decimal-adjusted to
 * whole-token units and scaled to 1e18.
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
  return ratiosFromFraction(clSpotPrice0(sqrtPriceX96, decimals0, decimals1));
}

/**
 * Merges freshly derived ratios with the pool's last-known ratios: keeps the
 * last-known pair when the derivation is undefined (both legs 0n), and the
 * derived pair otherwise.
 *
 * Both the CL Swap and V2 Sync writers compute ratios from live pool state, but
 * that state is momentarily undefined for an empty/uninitialised pool (zero
 * reserves or `sqrtPriceX96`) or when token decimals are unavailable — cases
 * where the derive functions return `0n` for both legs. Writing `0n` would
 * clobber a previously valid ratio with a meaningless zero, so the pair falls
 * back to its last-known value instead. Centralizing the rule here keeps it
 * identical across both writers (#783).
 *
 * A defined price never derives to `0n` on both legs, but one leg is `0n` when
 * it is below 1e-18: a CL pool pushed to a tick bound (±887272, e.g. a drained
 * pool) or an extremely lopsided V2 pool. That `0n` is the true 1e18-scaled
 * ratio and is kept, with the other leg's true (very large) ratio; falling back
 * per leg would pair it with a stale, healthy-looking price.
 *
 * @param derived - Ratios computed from current pool state (legs may be 0n)
 * @param lastKnown - The pool's previously stored ratios to fall back on
 * @returns The 1e18-scaled ratio pair: `lastKnown` when both derived legs are
 *   non-positive, else `derived` (a 0n leg being a price below 1e-18).
 */
export function pickPriceRatios(
  derived: PoolPriceRatios,
  lastKnown: PoolPriceRatios,
): PoolPriceRatios {
  if (derived.token0Price <= 0n && derived.token1Price <= 0n) {
    return {
      token0Price: lastKnown.token0Price,
      token1Price: lastKnown.token1Price,
    };
  }
  return {
    token0Price: derived.token0Price,
    token1Price: derived.token1Price,
  };
}
