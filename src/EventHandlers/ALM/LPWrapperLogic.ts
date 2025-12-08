import type { ALM_LP_Wrapper, handlerContext } from "generated";
import { getSqrtPriceX96, roundBlockToInterval } from "../../Effects/Token";
import { calculatePositionAmountsFromLiquidity } from "../../Helpers";

/**
 * Recalculates amount0 and amount1 from current liquidity and current price
 * This ensures amounts reflect the current pool price, not stale values from events.
 *
 * @param wrapper - The current ALM_LP_Wrapper entity
 * @param poolAddress - The pool address to fetch price from
 * @param chainId - The chain ID
 * @param blockNumber - The block number to fetch price at
 * @param context - The handler context for effects and logging
 * @param eventType - The event type for logging purposes (e.g., "Deposit", "Withdraw")
 * @returns An object with recalculated amount0 and amount1, or the current values if recalculation fails
 */
export async function recalculateLPWrapperAmountsFromLiquidity(
  wrapper: ALM_LP_Wrapper,
  poolAddress: string,
  chainId: number,
  blockNumber: number,
  context: handlerContext,
  eventType: string,
): Promise<{ amount0: bigint; amount1: bigint }> {
  // Default to current amounts if recalculation fails
  let recalculatedAmount0 = wrapper.amount0;
  let recalculatedAmount1 = wrapper.amount1;

  try {
    // Round block number to nearest hour interval for better cache hits
    const roundedBlockNumber = roundBlockToInterval(blockNumber, chainId);

    // Fetch current sqrtPriceX96
    let sqrtPriceX96: bigint | undefined;
    try {
      sqrtPriceX96 = await context.effect(getSqrtPriceX96, {
        poolAddress: poolAddress,
        chainId: chainId,
        blockNumber: roundedBlockNumber,
      });
    } catch (error) {
      // Pool might not exist at rounded block, retry with actual block
      context.log.warn(
        `[ALMLPWrapper.${eventType}] Pool ${poolAddress} does not exist at rounded block ${roundedBlockNumber} (original: ${blockNumber}) on chain ${chainId}. Retrying with actual block number.`,
      );
      try {
        sqrtPriceX96 = await context.effect(getSqrtPriceX96, {
          poolAddress: poolAddress,
          chainId: chainId,
          blockNumber: blockNumber,
        });
      } catch (retryError) {
        context.log.error(
          `[ALMLPWrapper.${eventType}] Failed to fetch sqrtPriceX96 for pool ${poolAddress} on chain ${chainId} at both rounded block ${roundedBlockNumber} and actual block ${blockNumber}. Using existing amounts.`,
        );
        sqrtPriceX96 = undefined;
      }
    }

    // Recalculate amounts from liquidity and current price if we have sqrtPriceX96
    if (sqrtPriceX96 && wrapper.liquidity > 0n) {
      const recalculatedAmounts = calculatePositionAmountsFromLiquidity(
        wrapper.liquidity,
        sqrtPriceX96,
        wrapper.tickLower,
        wrapper.tickUpper,
      );
      recalculatedAmount0 = recalculatedAmounts.amount0;
      recalculatedAmount1 = recalculatedAmounts.amount1;
    }
  } catch (error) {
    context.log.error(
      `[ALMLPWrapper.${eventType}] Error recalculating amounts from liquidity for wrapper ${wrapper.id}`,
      error instanceof Error ? error : new Error(String(error)),
    );
    // Continue with existing amounts if recalculation fails
  }

  return {
    amount0: recalculatedAmount0,
    amount1: recalculatedAmount1,
  };
}
