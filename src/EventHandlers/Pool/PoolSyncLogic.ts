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
 * to set reserves to the exact values from the event.
 *
 * IMPORTANT: Sync events set reserves to absolute values. If Mint/Burn events
 * also update reserves in the same block, this can cause double-counting.
 * The delta calculation ensures reserves are set to the absolute value from
 * the Sync event, regardless of any intermediate Mint/Burn updates.
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
    // Normal case: Sync events set reserves to absolute values
    // Calculate the delta needed to set reserves to the exact values from the event
    // This ensures reserves match the Sync event, even if Mint/Burn events
    // have already modified reserves in the same block
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
