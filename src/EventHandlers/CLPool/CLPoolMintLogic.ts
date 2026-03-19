import type {
  CLPool_Mint_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import { calculateTotalUSD } from "../../Helpers";

export interface CLPoolMintResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
}

export function processCLPoolMint(
  event: CLPool_Mint_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token,
  token1Instance: Token,
): CLPoolMintResult {
  // TVL definition: reserves track LP-deposited capital only.
  // Mint deposits new capital into the pool — always increases reserves.
  const newReserve0 = liquidityPoolAggregator.reserve0 + event.params.amount0;
  const newReserve1 = liquidityPoolAggregator.reserve1 + event.params.amount1;
  const currentTotalLiquidityUSD = calculateTotalUSD(
    newReserve0,
    newReserve1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    incrementalReserve0: event.params.amount0,
    incrementalReserve1: event.params.amount1,
    currentTotalLiquidityUSD: currentTotalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
  };
}
