import type { CLPool_Initialize_event } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";

export interface CLPoolInitializeResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
}

/**
 * Builds the aggregator diff for a CLPool.Initialize event. Initialize fires
 * once, between PoolCreated and the first Mint/Swap, and is the earliest
 * canonical source of sqrtPriceX96/tick. Indexing it closes the pre-first-swap
 * dead-zone where downstream NFPM handlers silently drop range math on a pool
 * whose price has not yet been observed (see velodrome-finance/indexer#654).
 *
 * @param event - The CLPool.Initialize event
 * @returns Partial aggregator diff with sqrtPriceX96, tick, and lastUpdatedTimestamp
 */
export function processCLPoolInitialize(
  event: CLPool_Initialize_event,
): CLPoolInitializeResult {
  const liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff> = {
    sqrtPriceX96: event.params.sqrtPriceX96,
    tick: event.params.tick,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
  };
}
