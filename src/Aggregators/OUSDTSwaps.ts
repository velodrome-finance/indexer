import type { Token, handlerContext } from "generated";

/**
 * Creates an oUSDTSwaps entity for swap events.
 * Accepts In/Out amounts for both tokens and determines swap direction.
 */
export function createOUSDTSwapEntity(
  transactionHash: string,
  chainId: number,
  token0Instance: Token,
  token1Instance: Token,
  amount0In: bigint,
  amount0Out: bigint,
  amount1In: bigint,
  amount1Out: bigint,
  context: handlerContext,
): void {
  if (!token0Instance || !token1Instance) {
    return;
  }

  // Determine which token is going in and which is going out
  if (amount0In > 0n) {
    // Token0 is going in, token1 is going out
    context.oUSDTSwaps.set({
      id: `${transactionHash}_${chainId}_${token0Instance.address}_${amount0In}_${token1Instance.address}_${amount1Out}`,
      transactionHash,
      tokenInPool: token0Instance.address,
      tokenOutPool: token1Instance.address,
      amountIn: amount0In,
      amountOut: amount1Out,
    });
  } else if (amount1In > 0n) {
    // Token1 is going in, token0 is going out
    context.oUSDTSwaps.set({
      id: `${transactionHash}_${chainId}_${token1Instance.address}_${amount1In}_${token0Instance.address}_${amount0Out}`,
      transactionHash,
      tokenInPool: token1Instance.address,
      tokenOutPool: token0Instance.address,
      amountIn: amount1In,
      amountOut: amount0Out,
    });
  }
  // If both are 0, no swap occurred, so we don't create an entity
}
