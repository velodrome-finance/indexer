import type { CLPool_Mint_event, Token } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import { calculateTotalUSD } from "../../Helpers";

export interface CLPoolMintResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
}

export function processCLPoolMint(
  event: CLPool_Mint_event,
  token0Instance: Token,
  token1Instance: Token,
): CLPoolMintResult {
  // Calculate USD values using already-refreshed token prices from loadPoolData
  const totalLiquidityUSD = calculateTotalUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    incrementalReserve0: event.params.amount0,
    incrementalReserve1: event.params.amount1,
    incrementalCurrentLiquidityUSD: totalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
  };
}
