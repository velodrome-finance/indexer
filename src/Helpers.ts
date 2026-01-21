import { SqrtPriceMath, TickMath } from "@uniswap/v3-sdk";
import type { LiquidityPoolAggregator, Token, handlerContext } from "generated";
import JSBI from "jsbi";
import { TEN_TO_THE_18_BI } from "./Constants";
import {
  getSqrtPriceX96,
  getTotalSupply,
  roundBlockToInterval,
} from "./Effects/Token";
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
 * Calculates total liquidity USD from amounts and token prices
 */
export function calculateTotalLiquidityUSD(
  amount0: bigint,
  amount1: bigint,
  token0: Token | undefined,
  token1: Token | undefined,
): bigint {
  let totalLiquidityUSD = 0n;

  if (token0) {
    totalLiquidityUSD += calculateTokenAmountUSD(
      amount0,
      Number(token0.decimals),
      token0.pricePerUSDNew,
    );
  }

  if (token1) {
    totalLiquidityUSD += calculateTokenAmountUSD(
      amount1,
      Number(token1.decimals),
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
 * Executes an effect with retry logic for rounded block numbers.
 * Tries with rounded block first (for caching), then retries with original block
 * if the call fails or returns a zero value (for numeric effects).
 *
 * @param effect - The effect function to call
 * @param inputWithRoundedBlock - Input parameters with rounded block number
 * @param inputWithOriginalBlock - Input parameters with original block number
 * @param context - Handler context for effect calls and logging
 * @param logPrefix - Prefix for log messages (e.g., "[calculateStakedLiquidityUSD]")
 * @param options - Optional configuration
 * @returns The result from the effect call
 */
export async function executeEffectWithRoundedBlockRetry<
  T,
  I extends { blockNumber: number },
>(
  effect: (input: I) => Promise<T>,
  inputWithRoundedBlock: I,
  inputWithOriginalBlock: I,
  context: handlerContext,
  logPrefix: string,
  options?: {
    retryOnZero?: boolean; // For numeric effects that might return 0 at rounded block
    zeroValue?: T; // What constitutes "zero" for this effect type
  },
): Promise<T> {
  const { retryOnZero = false, zeroValue } = options || {};
  const roundedBlock = inputWithRoundedBlock.blockNumber;
  const originalBlock = inputWithOriginalBlock.blockNumber;

  // If blocks are the same, no need for retry logic
  if (roundedBlock === originalBlock) {
    return await effect(inputWithRoundedBlock);
  }

  try {
    let result = await effect(inputWithRoundedBlock);

    // Check if we should retry on zero value
    if (retryOnZero && result === zeroValue) {
      context.log.info(
        `${logPrefix} Effect returned zero value at rounded block ${roundedBlock} (original: ${originalBlock}). Retrying with actual block number. This is expected when the contract was created after the rounded block interval.`,
      );
      result = await effect(inputWithOriginalBlock);
    }

    return result;
  } catch (error) {
    // Retry with original block on exception
    context.log.info(
      `${logPrefix} Effect failed at rounded block ${roundedBlock} (original: ${originalBlock}). Retrying with actual block number. This is expected when the contract was created after the rounded block interval.`,
    );
    return await effect(inputWithOriginalBlock);
  }
}

/**
 * Calculate USD value of staked liquidity/LP tokens
 * For CL pools: Uses tokenId to get position tick ranges, then calculates from liquidity
 * For V2 pools: Converts LP tokens to amount0/amount1 using pool reserves and totalSupply
 */
export async function calculateStakedLiquidityUSD(
  amount: bigint,
  poolAddress: string,
  chainId: number,
  blockNumber: number,
  tokenId: bigint | undefined,
  poolData: {
    liquidityPoolAggregator: LiquidityPoolAggregator;
    token0Instance?: Token;
    token1Instance?: Token;
  },
  context: handlerContext,
): Promise<bigint> {
  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  const roundedBlockNumber = roundBlockToInterval(blockNumber, chainId);

  // CL Pool: Use tokenId to get position and calculate from liquidity
  if (tokenId !== undefined && liquidityPoolAggregator.isCL) {
    try {
      // Load position to get tick ranges
      const position =
        await context.NonFungiblePosition.getWhere.tokenId.eq(tokenId);
      const matchingPosition = position.find((p) => p.chainId === chainId);

      if (!matchingPosition) {
        context.log.warn(
          `[calculateStakedLiquidityUSD] Position not found for tokenId ${tokenId} on chain ${chainId}, using 0 USD`,
        );
        return 0n;
      }

      // Get sqrtPriceX96 with retry logic for rounded block numbers
      const sqrtPriceX96 = await executeEffectWithRoundedBlockRetry(
        (input) => context.effect(getSqrtPriceX96, input),
        {
          poolAddress,
          chainId,
          blockNumber: roundedBlockNumber,
        },
        {
          poolAddress,
          chainId,
          blockNumber: blockNumber,
        },
        context,
        "[calculateStakedLiquidityUSD]",
        {
          retryOnZero: true,
          zeroValue: undefined,
        },
      );

      // Check if sqrtPriceX96 is undefined (error case) - return 0 USD
      if (sqrtPriceX96 === undefined) {
        context.log.warn(
          `[calculateStakedLiquidityUSD] sqrtPriceX96 is null for pool ${poolAddress} on chain ${chainId}, using 0 USD`,
        );
        return 0n;
      }

      // Calculate amount0 and amount1 from liquidity
      const { amount0, amount1 } = calculatePositionAmountsFromLiquidity(
        amount,
        sqrtPriceX96,
        matchingPosition.tickLower,
        matchingPosition.tickUpper,
      );

      // Calculate USD value
      return calculateTotalLiquidityUSD(
        amount0,
        amount1,
        token0Instance,
        token1Instance,
      );
    } catch (error) {
      context.log.warn(
        `[calculateStakedLiquidityUSD] Error calculating CL pool USD value for tokenId ${tokenId}: ${error instanceof Error ? error.message : String(error)}, using 0 USD`,
      );
      return 0n;
    }
  }

  // V2 Pool: Convert LP tokens to amount0/amount1 using reserves and totalSupply
  if (!liquidityPoolAggregator.isCL) {
    try {
      const reserve0 = liquidityPoolAggregator.reserve0;
      const reserve1 = liquidityPoolAggregator.reserve1;

      const totalSupply = await executeEffectWithRoundedBlockRetry(
        (input) => context.effect(getTotalSupply, input),
        {
          tokenAddress: poolAddress,
          chainId,
          blockNumber: roundedBlockNumber,
        },
        {
          tokenAddress: poolAddress,
          chainId,
          blockNumber: blockNumber,
        },
        context,
        "[calculateStakedLiquidityUSD]",
        {
          retryOnZero: true,
          zeroValue: 0n,
        },
      );

      if (totalSupply === 0n) {
        context.log.warn(
          `[calculateStakedLiquidityUSD] TotalSupply is 0 for pool ${poolAddress} on chain ${chainId}, using 0 USD`,
        );
        return 0n;
      }

      // Calculate proportional amounts
      const amount0 = (amount * reserve0) / totalSupply;
      const amount1 = (amount * reserve1) / totalSupply;

      // Calculate USD value
      return calculateTotalLiquidityUSD(
        amount0,
        amount1,
        token0Instance,
        token1Instance,
      );
    } catch (error) {
      context.log.warn(
        `[calculateStakedLiquidityUSD] Error calculating V2 pool USD value: ${error instanceof Error ? error.message : String(error)}, using 0 USD`,
      );
      return 0n;
    }
  }

  // Fallback
  context.log.warn(
    `[calculateStakedLiquidityUSD] Unsupported pool type: ${poolAddress} on chain ${chainId}. Fallback to 0 USD`,
  );
  return 0n;
}

/**
 * Updates tokens for reserve/liquidity operations (like Sync events)
 * NOTE: This function refreshes token prices. If prices are already refreshed
 * in loadPoolData, use calculateTotalLiquidityUSD instead.
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
