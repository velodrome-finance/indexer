import type {
  CLPool_Burn_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import { calculateTotalUSD } from "../../Helpers";

export interface CLPoolBurnResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
}

export function processCLPoolBurn(
  event: CLPool_Burn_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token,
  token1Instance: Token,
): CLPoolBurnResult {
  // TVL definition: reserves track LP-deposited capital only.
  // Burn removes capital from a position (tokens stay in contract as tokensOwed
  // until collect(), but are no longer part of any LP position's liquidity).
  const newReserve0 = liquidityPoolAggregator.reserve0 - event.params.amount0;
  const newReserve1 = liquidityPoolAggregator.reserve1 - event.params.amount1;
  const currentTotalLiquidityUSD = calculateTotalUSD(
    newReserve0,
    newReserve1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    incrementalReserve0: -event.params.amount0,
    incrementalReserve1: -event.params.amount1,
    currentTotalLiquidityUSD: currentTotalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
  };
}
