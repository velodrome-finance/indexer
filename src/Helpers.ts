import {
  SqrtPriceMath,
  TickMath,
  maxLiquidityForAmounts,
} from "@uniswap/v3-sdk";
import type { Token } from "envio";
import JSBI from "jsbi";
import { TEN_TO_THE_18_BI } from "./Constants";
import type { handlerContext } from "./EntityTypes";
import type { Pool } from "./EntityTypes";
import { multiplyBase1e18 } from "./Maths";
import { getHardAnchorUnitUSD, getTrustedUSD } from "./PriceTrust";

// Directional TVL cap (issue #892). A pool leg is re-valued at its pool-implied
// price only when its oracle price exceeds that implied price by more than this
// ratio. Reuses the 10× band of the #668 price-spike guard.
const TVL_CAP_RATIO = 10n;

// Minimum anchor-leg reserve USD (1e18-base) for the directional cap to engage.
// Below this the pool is too thin for its spot ratio to be a trustworthy
// witness — a drained / edge pool's implied price can blow up in either
// direction (the #784/#785 failure mode). $1,000 isolated the live LFI/USDC
// poison on Base while leaving every drained-stablecoin false positive (e.g.
// Swell USDe/rUSDC) untouched.
const TVL_CAP_ANCHOR_FLOOR_USD = 1_000n * TEN_TO_THE_18_BI;

/**
 * Normalises an unknown value to an error message string.
 * @param err - The unknown value to normalize
 * @returns The error message string
 */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Logs an error via context. If err is provided, appends ": " + getErrorMessage(err) to the message.
 * @param context - The handler context
 * @param message - The message to log
 * @param err - The unknown value to log
 * @returns void
 */
export function logContextError(
  context: handlerContext,
  message: string,
  err?: unknown,
): void {
  if (err !== undefined) {
    context.log.error(`${message}: ${getErrorMessage(err)}`);
  } else {
    context.log.error(message);
  }
}

/**
 * Runs an async function and logs via context if it throws. Does not rethrow.
 * Use for best-effort operations where failure should be logged but not abort the handler.
 * @param context - The handler context
 * @param message - Message to log on error (error message is appended via logContextError)
 * @param fn - The async function to run
 * @returns void
 */
export async function runAsyncWithErrorLog(
  context: handlerContext,
  message: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logContextError(context, message, error);
  }
}

// Helper function to normalize token amounts to 1e18
export const normalizeTokenAmountTo1e18 = (
  amount: bigint,
  tokenDecimals: number,
): bigint => {
  if (tokenDecimals !== 0) {
    return (amount * TEN_TO_THE_18_BI) / BigInt(10 ** tokenDecimals);
  }
  return amount;
};

// Helper function to calculate USD value from token amount, decimals, and price
export function calculateTokenAmountUSD(
  amount: bigint,
  tokenDecimals: number,
  pricePerUSDNew: bigint,
): bigint {
  const normalizedAmount = normalizeTokenAmountTo1e18(amount, tokenDecimals);
  return multiplyBase1e18(normalizedAmount, pricePerUSDNew);
}

/**
 * Picks the more-trusted USD leg of a swap.
 *
 * Returns the smaller of the two legs when both are non-zero, falling back
 * to the non-zero leg when only one is priced. Corrupted token prices
 * (poisoned oracle paths, scam tokens) are universally *inflated* — see
 * issue #699 — so the honest leg is reliably the smaller of the two when
 * both contribute.
 *
 * Trust is enforced by callers via {@link getTrustedUSD}: an untrusted leg
 * arrives here as `0n` regardless of its raw `amount × price`, so the
 * single-leg fallback only ever returns the value of a trusted leg. This
 * subsumes the #737 single-leg WL gate that previously lived inside this
 * function — the picker is now a pure min/single-leg picker over pre-gated
 * inputs (issue #755).
 *
 * @param token0UsdValue - Token0's trusted USD leg, or `undefined`/`0n` when
 *   token0 is untrusted or unpriced
 * @param token1UsdValue - Token1's trusted USD leg, or `undefined`/`0n` when
 *   token1 is untrusted or unpriced
 * @returns The picked volume in USD, or `0n` when neither leg is priced
 */
export function pickTrustedSwapVolumeUSD(
  token0UsdValue: bigint | undefined,
  token1UsdValue: bigint | undefined,
): bigint {
  const t0 = token0UsdValue ?? 0n;
  const t1 = token1UsdValue ?? 0n;
  if (t0 !== 0n && t1 !== 0n) return t0 < t1 ? t0 : t1;
  if (t0 !== 0n) return t0;
  if (t1 !== 0n) return t1;
  return 0n;
}

// Helper function to get generate the pool name given token0 and token1 symbols and isStable boolean
export function generatePoolName(
  token0Symbol: string,
  token1Symbol: string,
  isStable: boolean,
  clTickSpacing: number,
): string {
  let poolType = "";
  if (isStable) {
    poolType = "Stable";
  } else {
    poolType = "Volatile";
  }
  if (clTickSpacing !== 0) {
    poolType = `CL-${clTickSpacing}`;
  }
  return `${poolType} AMM - ${token0Symbol}/${token1Symbol}`;
}

/**
 * Sorts items by blockchain event order: block number ascending, then log index ascending.
 * Use when replaying deferred events (e.g. PendingVote, PendingDistribution) so they are
 * applied in the same order they occurred on-chain.
 * @param items - Array to sort (not mutated; returns a new sorted array)
 * @param getBlockNumber - Extracts block number from each item
 * @param getLogIndex - Optional. Extracts log index from each item; defaults to 0 when omitted
 */
export function sortByBlockThenLogIndex<T>(
  items: T[],
  getBlockNumber: (item: T) => number,
  getLogIndex?: (item: T) => number,
): T[] {
  const getLog = getLogIndex ?? (() => 0);
  return [...items].sort((a, b) => {
    const blockA = getBlockNumber(a);
    const blockB = getBlockNumber(b);
    if (blockA !== blockB) return blockA - blockB;
    return getLog(a) - getLog(b);
  });
}

/**
 * Calculates total USD from amounts and token prices, gated by the
 * {@link getTrustedUSD} price-trust seam (#755).
 *
 * Each leg is routed through `getTrustedUSD`, so a leg whose token fails the
 * two-tier gate (`isWhitelisted = false` OR present in the operator
 * BLACKLIST) contributes `0n` to the total. This closes the un-gated TVL
 * contamination hole where a single poisoned non-WL token could inflate
 * `totalLiquidityUSD` to astronomical values (see #755 empirical audit).
 *
 * Undefined token entities continue to contribute `0n`, matching the
 * pre-migration behavior.
 *
 * @param amount0 - Token0 amount (raw, in token0's decimal base)
 * @param amount1 - Token1 amount (raw, in token1's decimal base)
 * @param token0 - Token0 instance; undefined or untrusted contributes 0n
 * @param token1 - Token1 instance; undefined or untrusted contributes 0n
 * @returns Total USD (1e18-base), summing only trusted legs
 */
export function calculateTotalUSD(
  amount0: bigint,
  amount1: bigint,
  token0: Token | undefined,
  token1: Token | undefined,
): bigint {
  return getTrustedUSD(amount0, token0) + getTrustedUSD(amount1, token1);
}

/**
 * One leg of {@link calculateLiquidityUSD}: token T's trusted USD value, capped
 * to its pool-implied value when its hard-anchor counterparty C shows that T's
 * oracle price is more than {@link TVL_CAP_RATIO}× too high (issue #892).
 *
 * Returns the untouched {@link getTrustedUSD} value unless ALL of:
 *  - T is trusted and contributes a positive USD leg (untrusted ⇒ already 0n),
 *  - the pool ratio for T-in-C is positive,
 *  - C is a hard anchor we can value (stablecoin = $1, WETH = oracle price),
 *  - C's reserve is worth ≥ `$1,000` (thin-pool guard),
 *  - and T's oracle price exceeds the pool-implied price by > 10×.
 * When they hold, T is re-valued at the pool-implied price. The cap is
 * downward-only by construction (it fires on oracle ≫ implied), so it can only
 * deflate an inflated leg toward the liquid pool's truth, never inflate a
 * correct one.
 *
 * @param amountT - Raw reserve of the priced leg T (token's decimal base)
 * @param tokenT - The priced leg's token (undefined / untrusted ⇒ 0n)
 * @param amountC - Raw reserve of the counterparty leg C (candidate anchor)
 * @param tokenC - The counterparty token
 * @param ratioTinC - Price of T in C units, 1e18-scaled (`Pool.token0Price` when
 *   T = token0, `Pool.token1Price` when T = token1)
 * @param chainId - Chain the pool lives on (for the hard-anchor lookup)
 * @returns T's USD contribution (1e18-base): trusted, or pool-implied when capped
 */
function cappedLegUSD(
  amountT: bigint,
  tokenT: Token | undefined,
  amountC: bigint,
  tokenC: Token | undefined,
  ratioTinC: bigint,
  chainId: number,
): bigint {
  const trustedUSD = getTrustedUSD(amountT, tokenT);
  // Nothing to cap: untrusted / zero leg, no priced T, or no usable pool ratio.
  if (trustedUSD <= 0n || !tokenT || ratioTinC <= 0n) return trustedUSD;

  // The counterparty must be a hard anchor we can value ($1 pin for stablecoins,
  // oracle price for WETH; 0n ⇒ not an anchor or unpriced WETH).
  const anchorUnitUSD = getHardAnchorUnitUSD(chainId, tokenC);
  if (anchorUnitUSD <= 0n || !tokenC) return trustedUSD;

  // Thin/drained-pool guard: the spot ratio is only a trustworthy witness when
  // the anchor leg holds real liquidity.
  const anchorReserveUSD = calculateTokenAmountUSD(
    amountC,
    Number(tokenC.decimals),
    anchorUnitUSD,
  );
  if (anchorReserveUSD < TVL_CAP_ANCHOR_FLOOR_USD) return trustedUSD;

  // Pool-implied USD price of T: ratio(T in C units) × USD(C).
  const impliedPriceT = multiplyBase1e18(ratioTinC, anchorUnitUSD);
  if (impliedPriceT <= 0n) return trustedUSD;

  // Directional, downward-only: only cap when the oracle is > 10× the implied.
  if (tokenT.pricePerUSDNew > impliedPriceT * TVL_CAP_RATIO) {
    return calculateTokenAmountUSD(
      amountT,
      Number(tokenT.decimals),
      impliedPriceT,
    );
  }
  return trustedUSD;
}

/**
 * Pool TVL valuation with a directional, downward-only sanity cap against a
 * hard-anchor counterparty (issue #892).
 *
 * Identical to {@link calculateTotalUSD} (each leg routed through the
 * {@link getTrustedUSD} trust gate) EXCEPT that a leg whose counterparty is a
 * stablecoin / WETH hard anchor (see `isHardAnchor`) and whose oracle price
 * exceeds the pool-implied price by more than 10× is re-valued at the implied
 * price. This catches a persistently poisoned but whitelisted oracle — e.g.
 * LFI/USDC on Base reading ~$23 against a pool implying ~$0.00006, inflating
 * one pool's TVL to ~$26B — that the global spike / re-anchor guards
 * (#668/#784/#785) cannot heal because the bad value is stable, not a spike.
 *
 * Safety properties:
 *  - **Directional & downward-only** — the cap fires only on `oracle ≫ implied`,
 *    so it can only LOWER a leg toward the liquid pool's truth, never raise it.
 *    A drained-pool ratio that blows up HIGH (oracle ≪ implied — e.g. a $1
 *    stablecoin whose edge pool implies $254K) does not trigger it, so it is
 *    regression-safe.
 *  - **Anchor-gated, liquidity-floored** — only against a stablecoin / WETH
 *    anchor holding ≥ `$1,000`, never an arbitrary trusted counterparty. This
 *    avoids the broad false-positive set a naive "re-anchor on any 10× gap"
 *    produced (#784/#785).
 *  - **TVL-only** — does NOT mutate the token's global `pricePerUSDNew`, so
 *    price snapshots, volume, fees, and reward USD are untouched.
 *
 * @param amount0 - Token0 amount (raw, token0 decimal base) — pool reserve0
 * @param amount1 - Token1 amount (raw, token1 decimal base) — pool reserve1
 * @param token0 - Token0 entity; undefined / untrusted contributes 0n
 * @param token1 - Token1 entity; undefined / untrusted contributes 0n
 * @param token0Price - Pool ratio: price of token0 in token1 units, 1e18-scaled
 *   (`Pool.token0Price`); implies token0's USD when token1 is the anchor
 * @param token1Price - Pool ratio: price of token1 in token0 units, 1e18-scaled
 *   (`Pool.token1Price`); implies token1's USD when token0 is the anchor
 * @param chainId - Chain the pool lives on (for the hard-anchor lookup)
 * @returns Total pool USD (1e18-base), summing each leg's trusted-or-capped value
 */
export function calculateLiquidityUSD(
  amount0: bigint,
  amount1: bigint,
  token0: Token | undefined,
  token1: Token | undefined,
  token0Price: bigint,
  token1Price: bigint,
  chainId: number,
): bigint {
  const usd0 = cappedLegUSD(
    amount0,
    token0,
    amount1,
    token1,
    token0Price,
    chainId,
  );
  const usd1 = cappedLegUSD(
    amount1,
    token1,
    amount0,
    token0,
    token1Price,
    chainId,
  );
  return usd0 + usd1;
}

/**
 * Calculates token0 and token1 amounts from a Uniswap V3 liquidity position.
 *
 * Uses @uniswap/v3-sdk packages (TickMath and SqrtPriceMath).
 * TickMath converts tick indices into sqrt ratios in Q96 format,
 * and SqrtPriceMath.getAmount0Delta/getAmount1Delta calculate the token amounts.
 *
 * @param liquidity   The liquidity of the position as a bigint.
 * @param sqrtPriceX96 Current sqrt(price) for the pool, encoded as Q64.96 (uint160) and passed as bigint.
 * @param tickLower   Lower tick of the position as a bigint.
 * @param tickUpper   Upper tick of the position as a bigint.
 * @returns           An object containing amount0 and amount1 as bigint.
 */
export function calculatePositionAmountsFromLiquidity(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  tickLower: bigint,
  tickUpper: bigint,
): { amount0: bigint; amount1: bigint } {
  // Convert tick boundaries into sqrt ratios in Q96 format
  // TickMath expects number, so convert bigint to number
  const sqrtPriceLower = TickMath.getSqrtRatioAtTick(Number(tickLower)); // returns JSBI
  const sqrtPriceUpper = TickMath.getSqrtRatioAtTick(Number(tickUpper));

  // Convert bigint inputs to JSBI for SDK functions
  const liquidityJSBI = JSBI.BigInt(liquidity.toString());
  const sqrtPriceCurrentJSBI = JSBI.BigInt(sqrtPriceX96.toString());

  // Determine which amounts to calculate based on price position
  let amount0JSBI: JSBI;
  let amount1JSBI: JSBI;

  if (JSBI.lessThan(sqrtPriceCurrentJSBI, sqrtPriceLower)) {
    // Price is below range: all token0
    amount0JSBI = SqrtPriceMath.getAmount0Delta(
      sqrtPriceLower,
      sqrtPriceUpper,
      liquidityJSBI,
      false,
    );
    amount1JSBI = JSBI.BigInt(0);
  } else if (JSBI.greaterThan(sqrtPriceCurrentJSBI, sqrtPriceUpper)) {
    // Price is above range: all token1
    amount0JSBI = JSBI.BigInt(0);
    amount1JSBI = SqrtPriceMath.getAmount1Delta(
      sqrtPriceLower,
      sqrtPriceUpper,
      liquidityJSBI,
      false,
    );
  } else {
    // Price is within range: both tokens
    amount0JSBI = SqrtPriceMath.getAmount0Delta(
      sqrtPriceCurrentJSBI,
      sqrtPriceUpper,
      liquidityJSBI,
      false,
    );
    amount1JSBI = SqrtPriceMath.getAmount1Delta(
      sqrtPriceLower,
      sqrtPriceCurrentJSBI,
      liquidityJSBI,
      false,
    );
  }

  // Convert JSBI results back to bigint for caller
  return {
    amount0: BigInt(amount0JSBI.toString()),
    amount1: BigInt(amount1JSBI.toString()),
  };
}

/**
 * Converts concentrated liquidity (L) in a tick range to USD using exact CL math (TickMath + SqrtPriceMath → amount0/amount1 → USD).
 *
 * @param liquidity - Liquidity amount (L) as bigint
 * @param sqrtPriceX96 - Current pool sqrt(price) Q64.96
 * @param tickLower - Range lower tick
 * @param tickUpper - Range upper tick
 * @param token0Instance - Token0 for USD pricing (optional)
 * @param token1Instance - Token1 for USD pricing (optional)
 * @returns USD value in 1e18 units, or 0n on error / missing tokens
 */
export function concentratedLiquidityToUSD(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  tickLower: bigint,
  tickUpper: bigint,
  token0Instance?: Token,
  token1Instance?: Token,
): bigint {
  try {
    const { amount0, amount1 } = calculatePositionAmountsFromLiquidity(
      liquidity,
      sqrtPriceX96,
      tickLower,
      tickUpper,
    );
    return calculateTotalUSD(amount0, amount1, token0Instance, token1Instance);
  } catch {
    return 0n;
  }
}

/**
 * Computes currentLiquidityStakedUSD for non-CL pools from stake units and pool state.
 * Value is derived from reserves, totalSupply, and token prices.
 *
 * @param stakeAmount - Current staked liquidity in LP token units (pool or user)
 * @param poolEntity - Non-CL pool entity with reserve0, reserve1, totalLPTokenSupply
 * @param poolData - Token instances for USD pricing
 * @param _context - Handler context (unused; for API consistency)
 * @returns USD value in 1e18 units, or 0n if stake ≤ 0 or totalSupply missing/zero
 */
export function computeNonCLStakedUSD(
  stakeAmount: bigint,
  poolEntity: Pool,
  poolData: {
    liquidityPoolAggregator: Pool;
    token0Instance?: Token;
    token1Instance?: Token;
  },
  _context: handlerContext,
): bigint {
  if (stakeAmount <= 0n) {
    return 0n;
  }
  const { token0Instance, token1Instance } = poolData;
  const reserve0 = poolEntity.reserve0;
  const reserve1 = poolEntity.reserve1;
  const totalSupply = poolEntity.totalLPTokenSupply;
  if (!totalSupply || totalSupply === 0n) {
    return 0n;
  }
  const amount0 = (stakeAmount * reserve0) / totalSupply;
  const amount1 = (stakeAmount * reserve1) / totalSupply;
  return calculateTotalUSD(amount0, amount1, token0Instance, token1Instance);
}

/**
 * Computes liquidity delta ΔL from token amounts using Uniswap V3's getLiquidityForAmounts logic.
 * Used for Deposit (wrapper.liquidity += ΔL) and Withdraw (wrapper.liquidity -= ΔL).
 *
 * @param amount0 - Token0 amount (e.g. event actualAmount0)
 * @param amount1 - Token1 amount (e.g. event actualAmount1)
 * @param sqrtPriceX96 - Pool price at execution (Q96)
 * @param tickLower - Position tick lower
 * @param tickUpper - Position tick upper
 * @returns ΔL (integer liquidity)
 */
export function computeLiquidityDeltaFromAmounts(
  amount0: bigint,
  amount1: bigint,
  sqrtPriceX96: bigint,
  tickLower: bigint,
  tickUpper: bigint,
): bigint {
  const sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(Number(tickLower));
  const sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(Number(tickUpper));
  return BigInt(
    maxLiquidityForAmounts(
      JSBI.BigInt(sqrtPriceX96.toString()),
      sqrtRatioAX96,
      sqrtRatioBX96,
      amount0.toString(),
      amount1.toString(),
      true,
    ).toString(),
  );
}
