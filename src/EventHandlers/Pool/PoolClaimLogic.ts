import type { EvmEvent, Token } from "envio";
import type { PoolDiff } from "../../Aggregators/Pool";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { calculateTotalUSD } from "../../Helpers";

export interface PoolClaimResult {
  poolDiff: Partial<PoolDiff>;
  userDiff: Partial<UserStatsPerPoolDiff>;
}

/**
 * Process claim event for fees collected from the pool
 * This matches CLPoolCollectFeesLogic and CLPoolCollectLogic pattern
 * Distinguishes between staked fees (claimed by gauge) and unstaked fees (claimed by regular users directly)
 *
 * @param event - Legacy `Claim(sender, recipient, …)` or Aero
 *   `ClaimWithAccount(caller, account, recipient, …)`; only the amounts and
 *   the block timestamp are read
 * @param sender - Whose fees were claimed: the legacy `sender`, the Aero `account`
 * @param gaugeAddress - The pool's gauge ("" when it has none)
 * @param token0Instance - Token0 for USD valuation
 * @param token1Instance - Token1 for USD valuation
 * @returns Pool and user diffs (staked fields when `sender` is the gauge)
 */
export function processPoolClaim(
  event: EvmEvent<"Pool", "Claim"> | EvmEvent<"Pool", "ClaimWithAccount">,
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
    event.chainId,
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
