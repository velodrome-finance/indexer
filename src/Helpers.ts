import { SqrtPriceMath, TickMath } from "@uniswap/v3-sdk";
import type { Token, handlerContext } from "generated";
import JSBI from "jsbi";
import { TEN_TO_THE_18_BI } from "./Constants";
import { multiplyBase1e18 } from "./Maths";
import { refreshTokenPrice } from "./PriceOracle";

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

// Token utility interfaces
export interface TokenSwapData {
  token0: Token;
  token1: Token;
  token0NormalizedAmount: bigint;
  token1NormalizedAmount: bigint;
  token0UsdValue: bigint;
  token1UsdValue: bigint;
  token0NetAmount: bigint;
  token1NetAmount: bigint;
  volumeInUSD: bigint;
  volumeInUSDWhitelisted: bigint;
}

/**
 * Updates a single token with price refresh and calculations
 */
export async function updateTokenData(
  token: Token,
  amount: bigint,
  event: {
    block: { number: number; timestamp: number };
    chainId: number;
  },
  context: handlerContext,
): Promise<{
  token: Token;
  normalizedAmount: bigint;
  usdValue: bigint;
  netAmount: bigint;
}> {
  let updatedToken = token;

  try {
    updatedToken = await refreshTokenPrice(
      token,
      event.block.number,
      event.block.timestamp,
      event.chainId,
      context,
      1000000n,
    );
  } catch (error) {
    context.log.error(
      `Error refreshing token price for ${token?.address} on chain ${event.chainId}: ${error}`,
    );
  }

  const normalizedAmount = normalizeTokenAmountTo1e18(
    amount,
    Number(updatedToken.decimals),
  );

  const usdValue = multiplyBase1e18(
    normalizedAmount,
    updatedToken.pricePerUSDNew,
  );

  return {
    token: updatedToken,
    normalizedAmount,
    usdValue,
    netAmount: amount,
  };
}

/**
 * Updates both tokens for swap operations
 */
export async function updateSwapTokenData(
  token0: Token,
  token1: Token,
  amount0: bigint,
  amount1: bigint,
  event: {
    block: { number: number; timestamp: number };
    chainId: number;
  },
  context: handlerContext,
): Promise<TokenSwapData> {
  const [token0Data, token1Data] = await Promise.all([
    updateTokenData(token0, amount0, event, context),
    updateTokenData(token1, amount1, event, context),
  ]);

  // Calculate volume in USD (use the higher of the two)
  const volumeInUSD =
    token0Data.usdValue !== 0n ? token0Data.usdValue : token1Data.usdValue;

  // Calculate whitelisted volume (both tokens must be whitelisted)
  const volumeInUSDWhitelisted =
    token0Data.token.isWhitelisted && token1Data.token.isWhitelisted
      ? token0Data.usdValue
      : 0n;

  return {
    token0: token0Data.token,
    token1: token1Data.token,
    token0NormalizedAmount: token0Data.normalizedAmount,
    token1NormalizedAmount: token1Data.normalizedAmount,
    token0UsdValue: token0Data.usdValue,
    token1UsdValue: token1Data.usdValue,
    token0NetAmount: token0Data.netAmount,
    token1NetAmount: token1Data.netAmount,
    volumeInUSD,
    volumeInUSDWhitelisted,
  };
}

/**
 * Updates tokens for fee collection operations
 */
export async function updateFeeTokenData(
  token0: Token | undefined,
  token1: Token | undefined,
  amount0: bigint,
  amount1: bigint,
  event: {
    block: { number: number; timestamp: number };
    chainId: number;
  },
  context: handlerContext,
): Promise<{
  token0?: Token;
  token1?: Token;
  token0UsdValue?: bigint;
  token1UsdValue?: bigint;
  totalFeesUSD: bigint;
  totalFeesUSDWhitelisted: bigint;
}> {
  const results = await Promise.allSettled([
    token0 ? updateTokenData(token0, amount0, event, context) : null,
    token1 ? updateTokenData(token1, amount1, event, context) : null,
  ]);

  const token0Data =
    results[0].status === "fulfilled" && results[0].value
      ? results[0].value
      : undefined;
  const token1Data =
    results[1].status === "fulfilled" && results[1].value
      ? results[1].value
      : undefined;

  let totalFeesUSD = 0n;
  let totalFeesUSDWhitelisted = 0n;

  if (token0Data) {
    totalFeesUSD += token0Data.usdValue;
    totalFeesUSDWhitelisted += token0Data.token.isWhitelisted
      ? token0Data.usdValue
      : 0n;
  }

  if (token1Data) {
    totalFeesUSD += token1Data.usdValue;
    totalFeesUSDWhitelisted += token1Data.token.isWhitelisted
      ? token1Data.usdValue
      : 0n;
  }

  return {
    token0: token0Data?.token,
    token1: token1Data?.token,
    token0UsdValue: token0Data?.usdValue,
    token1UsdValue: token1Data?.usdValue,
    totalFeesUSD,
    totalFeesUSDWhitelisted,
  };
}

/**
 * Calculates total liquidity USD from current reserves and token prices
 */
export function calculateTotalLiquidityUSD(
  reserve0: bigint,
  reserve1: bigint,
  token0: Token | undefined,
  token1: Token | undefined,
): bigint {
  let totalLiquidityUSD = 0n;

  if (token0) {
    const normalizedReserve0 = normalizeTokenAmountTo1e18(
      reserve0,
      Number(token0.decimals),
    );
    totalLiquidityUSD += multiplyBase1e18(
      normalizedReserve0,
      token0.pricePerUSDNew,
    );
  }

  if (token1) {
    const normalizedReserve1 = normalizeTokenAmountTo1e18(
      reserve1,
      Number(token1.decimals),
    );
    totalLiquidityUSD += multiplyBase1e18(
      normalizedReserve1,
      token1.pricePerUSDNew,
    );
  }

  return totalLiquidityUSD;
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
 * Updates tokens for reserve/liquidity operations (like Sync events)
 */
export async function updateReserveTokenData(
  token0: Token | undefined,
  token1: Token | undefined,
  amount0: bigint,
  amount1: bigint,
  event: {
    block: { number: number; timestamp: number };
    chainId: number;
  },
  context: handlerContext,
): Promise<{
  token0?: Token;
  token1?: Token;
  token0UsdValue?: bigint;
  token1UsdValue?: bigint;
  totalLiquidityUSD: bigint;
}> {
  const results = await Promise.allSettled([
    token0 ? updateTokenData(token0, amount0, event, context) : null,
    token1 ? updateTokenData(token1, amount1, event, context) : null,
  ]);

  const token0Data =
    results[0].status === "fulfilled" && results[0].value
      ? results[0].value
      : undefined;
  const token1Data =
    results[1].status === "fulfilled" && results[1].value
      ? results[1].value
      : undefined;

  let totalLiquidityUSD = 0n;

  if (token0Data) {
    totalLiquidityUSD += token0Data.usdValue;
  }

  if (token1Data) {
    totalLiquidityUSD += token1Data.usdValue;
  }

  return {
    token0: token0Data?.token,
    token1: token1Data?.token,
    token0UsdValue: token0Data?.usdValue,
    token1UsdValue: token1Data?.usdValue,
    totalLiquidityUSD,
  };
}
