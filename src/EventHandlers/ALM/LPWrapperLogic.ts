import { TickMath, maxLiquidityForAmounts } from "@uniswap/v3-sdk";
import type { ALM_LP_Wrapper, handlerContext } from "generated";
import JSBI from "jsbi";
import { getSqrtPriceX96, roundBlockToInterval } from "../../Effects/Token";

/**
 * Calculates liquidity from updated amounts (amount0 and amount1) using current price
 * This is used in Deposit/Withdraw events to update the liquidity field when amounts change.
 *
 * @param wrapper - The current ALM_LP_Wrapper entity
 * @param updatedAmount0 - The updated amount0 after deposit/withdraw
 * @param updatedAmount1 - The updated amount1 after deposit/withdraw
 * @param poolAddress - The pool address to fetch price from
 * @param chainId - The chain ID
 * @param blockNumber - The block number to fetch price at
 * @param context - The handler context for effects and logging
 * @param eventType - The event type for logging purposes (e.g., "Deposit", "Withdraw")
 * @returns The calculated liquidity, or the current liquidity if calculation fails
 */
export async function calculateLiquidityFromAmounts(
  wrapper: ALM_LP_Wrapper,
  updatedAmount0: bigint,
  updatedAmount1: bigint,
  poolAddress: string,
  chainId: number,
  blockNumber: number,
  context: handlerContext,
  eventType: string,
): Promise<bigint> {
  // Default to current liquidity if calculation fails
  let updatedLiquidity = wrapper.liquidity;

  // Try with rounded block first, then retry with actual block if it fails
  let sqrtPriceX96: bigint | undefined;
  let usedBlockNumber: number | undefined;

  try {
    const roundedBlockNumber = roundBlockToInterval(blockNumber, chainId);

    try {
      sqrtPriceX96 = await context.effect(getSqrtPriceX96, {
        poolAddress: poolAddress,
        chainId: chainId,
        blockNumber: roundedBlockNumber,
      });
      usedBlockNumber = roundedBlockNumber;
    } catch (error) {
      // If rounded block fails, retry with actual block number
      context.log.warn(
        `[ALMLPWrapper.${eventType}] Failed to get sqrtPriceX96 at rounded block ${roundedBlockNumber}, retrying with actual block ${blockNumber}`,
      );
      sqrtPriceX96 = await context.effect(getSqrtPriceX96, {
        poolAddress: poolAddress,
        chainId: chainId,
        blockNumber: blockNumber,
      });
      usedBlockNumber = blockNumber;
    }

    if (sqrtPriceX96 !== undefined && sqrtPriceX96 !== 0n) {
      // Convert ticks → sqrt ratios
      const sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(
        Number(wrapper.tickLower),
      );
      const sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(
        Number(wrapper.tickUpper),
      );

      // Compute liquidity from amounts
      updatedLiquidity = BigInt(
        maxLiquidityForAmounts(
          JSBI.BigInt(sqrtPriceX96.toString()),
          sqrtRatioAX96,
          sqrtRatioBX96,
          updatedAmount0.toString(),
          updatedAmount1.toString(),
          true,
        ).toString(),
      );
    } else {
      // Do not update liquidity if sqrtPriceX96 is undefined or 0
      context.log.warn(
        `[ALMLPWrapper.${eventType}] sqrtPriceX96 is undefined or 0 for pool ${poolAddress} at block ${usedBlockNumber ?? blockNumber} on chain ${chainId}. Skipping liquidity update.`,
      );
    }
  } catch (error) {
    context.log.error(
      `[ALMLPWrapper.${eventType}] Error calculating liquidity from amounts for wrapper ${wrapper.id}`,
      error instanceof Error ? error : new Error(String(error)),
    );
    // Continue with existing liquidity if calculation fails
  }

  return updatedLiquidity;
}

export function deriveUserAmounts(
  userLp: bigint,
  totalLp: bigint,
  wrapperAmount0: bigint,
  wrapperAmount1: bigint,
): { amount0: bigint; amount1: bigint } {
  if (userLp === 0n || totalLp === 0n) {
    return { amount0: 0n, amount1: 0n };
  }

  return {
    amount0: (wrapperAmount0 * userLp) / totalLp,
    amount1: (wrapperAmount1 * userLp) / totalLp,
  };
}
