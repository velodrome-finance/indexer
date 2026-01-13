import type { Pool_Claim_event, Token } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import { calculateTotalLiquidityUSD } from "../../Helpers";

/**
 * Process claim event for fees collected from the pool
 * This matches CLPoolCollectFeesLogic and CLPoolCollectLogic pattern
 * Distinguishes between staked fees (claimed by gauge) and unstaked fees (claimed by regular users directly)
 */
export function processPoolClaim(
  event: Pool_Claim_event,
  sender: string,
  gaugeAddress: string,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): Partial<LiquidityPoolAggregatorDiff> {
  // Calculate total fees USD using already-refreshed token prices
  const totalFeesUSD = calculateTotalLiquidityUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  let liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;

  // If the sender is the gauge address, then fees claimed are staked fees
  if (sender === gaugeAddress) {
    liquidityPoolDiff = {
      incrementalTotalStakedFeesCollected0: event.params.amount0,
      incrementalTotalStakedFeesCollected1: event.params.amount1,
      incrementalTotalStakedFeesCollectedUSD: totalFeesUSD,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };
  } else {
    liquidityPoolDiff = {
      incrementalTotalUnstakedFeesCollected0: event.params.amount0,
      incrementalTotalUnstakedFeesCollected1: event.params.amount1,
      incrementalTotalUnstakedFeesCollectedUSD: totalFeesUSD,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };
  }

  return liquidityPoolDiff;
}
