import type { Pool_Claim_event, Token } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { calculateTotalUSD } from "../../Helpers";

export interface PoolClaimResult {
  poolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userDiff: Partial<UserStatsPerPoolDiff>;
}

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
): PoolClaimResult {
  const totalFeesUSD = calculateTotalUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const timestamp = new Date(event.block.timestamp * 1000);

  const isGaugeClaim = sender === gaugeAddress;

  // Select staked or unstaked field keys based on claim type
  const poolDiff = isGaugeClaim
    ? {
        incrementalTotalStakedFeesCollected0: event.params.amount0,
        incrementalTotalStakedFeesCollected1: event.params.amount1,
        incrementalTotalStakedFeesCollectedUSD: totalFeesUSD,
        lastUpdatedTimestamp: timestamp,
      }
    : {
        incrementalTotalUnstakedFeesCollected0: event.params.amount0,
        incrementalTotalUnstakedFeesCollected1: event.params.amount1,
        incrementalTotalUnstakedFeesCollectedUSD: totalFeesUSD,
        lastUpdatedTimestamp: timestamp,
      };

  const userDiff = isGaugeClaim
    ? {
        incrementalTotalStakedFeesCollected0: event.params.amount0,
        incrementalTotalStakedFeesCollected1: event.params.amount1,
        incrementalTotalStakedFeesCollectedUSD: totalFeesUSD,
        lastActivityTimestamp: timestamp,
      }
    : {
        incrementalTotalUnstakedFeesCollected0: event.params.amount0,
        incrementalTotalUnstakedFeesCollected1: event.params.amount1,
        incrementalTotalUnstakedFeesCollectedUSD: totalFeesUSD,
        lastActivityTimestamp: timestamp,
      };

  return {
    poolDiff,
    userDiff,
  };
}
