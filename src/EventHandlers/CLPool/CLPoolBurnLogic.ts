import type { CLPool_Burn_event, Token, handlerContext } from "generated";
import { updateReserveTokenData } from "../../Helpers";

export interface CLPoolBurnResult {
  liquidityPoolDiff: {
    reserve0: bigint;
    reserve1: bigint;
    totalLiquidityUSD: bigint;
    lastUpdatedTimestamp: Date;
  };
  userLiquidityDiff: {
    netLiquidityAddedUSD: bigint;
    currentLiquidityToken0: bigint;
    currentLiquidityToken1: bigint;
    timestamp: Date;
  };
}

export async function processCLPoolBurn(
  event: CLPool_Burn_event,
  token0Instance: Token,
  token1Instance: Token,
  context: handlerContext,
): Promise<CLPoolBurnResult> {
  // Update reserve data using the same approach as Pool events
  const reserveData = await updateReserveTokenData(
    token0Instance,
    token1Instance,
    event.params.amount0,
    event.params.amount1,
    event,
    context,
  );

  const liquidityPoolDiff = {
    reserve0: event.params.amount0,
    reserve1: event.params.amount1,
    totalLiquidityUSD: reserveData.totalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  const userLiquidityDiff = {
    netLiquidityAddedUSD: -reserveData.totalLiquidityUSD, // Negative for burn (removal)
    currentLiquidityToken0: -event.params.amount0, // Negative amount of token0 removed
    currentLiquidityToken1: -event.params.amount1, // Negative amount of token1 removed
    timestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
