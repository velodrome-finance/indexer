import type {
  LiquidityPoolAggregator,
  Pool_Sync_event,
  Token,
} from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import { calculateTotalLiquidityUSD } from "../../Helpers";

export interface PoolSyncResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
}

/**
 * Process sync event using already-refreshed token prices from loadPoolData
 * Sync events update reserves to absolute values, so we calculate deltas
 */
export function processPoolSync(
  event: Pool_Sync_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): PoolSyncResult {
  // Handle different scenarios based on token availability and amounts
  let reserve0Change: bigint;
  let reserve1Change: bigint;
  let totalLiquidityUSDChange: bigint;

  if (!token0Instance && !token1Instance) {
    // No tokens available: keep existing values (no change)
    reserve0Change = 0n;
    reserve1Change = 0n;
    totalLiquidityUSDChange = 0n;
  } else if (event.params.reserve0 === 0n && event.params.reserve1 === 0n) {
    // Zero amounts: set reserves to zero (snapshot behavior)
    reserve0Change = -liquidityPoolAggregator.reserve0;
    reserve1Change = -liquidityPoolAggregator.reserve1;
    totalLiquidityUSDChange = -liquidityPoolAggregator.totalLiquidityUSD;
  } else {
    // Normal case: calculate incremental changes
    reserve0Change = event.params.reserve0 - liquidityPoolAggregator.reserve0;
    reserve1Change = event.params.reserve1 - liquidityPoolAggregator.reserve1;

    // Calculate total liquidity USD from the new total reserves using already-refreshed tokens
    const newTotalLiquidityUSD = calculateTotalLiquidityUSD(
      event.params.reserve0,
      event.params.reserve1,
      token0Instance,
      token1Instance,
    );

    totalLiquidityUSDChange =
      newTotalLiquidityUSD - liquidityPoolAggregator.totalLiquidityUSD;
  }

  const liquidityPoolDiff = {
    incrementalReserve0: reserve0Change,
    incrementalReserve1: reserve1Change,
    incrementalCurrentLiquidityUSD: totalLiquidityUSDChange,
    token0Price:
      token0Instance?.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
    token1Price:
      token1Instance?.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
  };
}
