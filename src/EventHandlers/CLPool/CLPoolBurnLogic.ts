import type { CLPool_Burn_event, Token } from "generated";
import { calculateTotalLiquidityUSD } from "../../Helpers";

export interface CLPoolBurnResult {
  liquidityPoolDiff: {
    reserve0: bigint;
    reserve1: bigint;
    totalLiquidityUSD: bigint;
  };
  userLiquidityDiff: {
    currentLiquidityUSD: bigint;
    currentLiquidityToken0: bigint;
    currentLiquidityToken1: bigint;
  };
}

export function processCLPoolBurn(
  event: CLPool_Burn_event,
  token0Instance: Token,
  token1Instance: Token,
): CLPoolBurnResult {
  // Calculate USD values using already-refreshed token prices from loadPoolData
  const totalLiquidityUSD = calculateTotalLiquidityUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    reserve0: -event.params.amount0,
    reserve1: -event.params.amount1,
    totalLiquidityUSD: -totalLiquidityUSD,
  };

  const userLiquidityDiff = {
    currentLiquidityUSD: -totalLiquidityUSD, // Negative for burn (removal)
    currentLiquidityToken0: -event.params.amount0, // Negative amount of token0 removed
    currentLiquidityToken1: -event.params.amount1, // Negative amount of token1 removed
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
