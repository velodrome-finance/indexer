import {
  SqrtPriceMath,
  TickMath,
  maxLiquidityForAmounts,
} from "@uniswap/v3-sdk";
import type {
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import JSBI from "jsbi";
import { TEN_TO_THE_18_BI } from "./Constants";
import { multiplyBase1e18 } from "./Maths";

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
 * Calculates total USD from amounts and token prices
 * @param amount0 - Token0 amount
 * @param amount1 - Token1 amount
 * @param token0 - Token0 instance
 * @param token1 - Token1 instance
 * @returns Total USD
 */
export function calculateTotalUSD(
  amount0: bigint,
  amount1: bigint,
  token0: Token | undefined,
  token1: Token | undefined,
): bigint {
  let totalUSD = 0n;

  if (token0) {
    totalUSD += calculateTokenAmountUSD(
      amount0,
      Number(token0.decimals),
      token0.pricePerUSDNew,
    );
  }

  if (token1) {
    totalUSD += calculateTokenAmountUSD(
      amount1,
      Number(token1.decimals),
      token1.pricePerUSDNew,
    );
  }

  return totalUSD;
}

/**
 * Calculates total fees USD counting only whitelisted tokens.
 * Used for pool-level totalFeesUSDWhitelisted.
 * @param amount0 - Token0 amount
 * @param amount1 - Token1 amount
 * @param token0 - Token0 instance
 * @param token1 - Token1 instance
 * @returns Total fees USD whitelisted
 */
export function calculateWhitelistedFeesUSD(
  amount0: bigint,
  amount1: bigint,
  token0: Token | undefined,
  token1: Token | undefined,
): bigint {
  let total = 0n;
  if (token0?.isWhitelisted) {
    total += calculateTokenAmountUSD(
      amount0,
      Number(token0.decimals),
      token0.pricePerUSDNew,
    );
  }
  if (token1?.isWhitelisted) {
    total += calculateTokenAmountUSD(
      amount1,
      Number(token1.decimals),
      token1.pricePerUSDNew,
    );
  }
  return total;
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
 * Used by computeCLStakedUSDFromPositions (per-position valuation).
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
  poolEntity: LiquidityPoolAggregator,
  poolData: {
    liquidityPoolAggregator: LiquidityPoolAggregator;
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
