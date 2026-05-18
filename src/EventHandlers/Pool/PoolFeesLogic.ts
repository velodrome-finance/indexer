import type { Pool_Fees_event, Token } from "generated";
import type { PoolDiff } from "../../Aggregators/Pool";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import {
  calculateTokenAmountUSD,
  calculateWhitelistedFeesUSD,
  pickTrustedSwapVolumeUSD,
} from "../../Helpers";

export interface PoolFeesResult {
  liquidityPoolDiff?: Partial<PoolDiff>;
  userDiff?: Partial<UserStatsPerPoolDiff>;
}

/**
 * Process fees event using already-refreshed token prices from loadPoolData.
 *
 * For regular pools (non-CL), fees are tracked as unstaked fees since regular
 * pools don't have the staked/unstaked distinction that CL pools have.
 *
 * USD fee value uses `pickTrustedSwapVolumeUSD` (smaller of the two priced legs)
 * rather than summing both legs — Velodrome V2 takes the fee from the input
 * side only, so at most one leg is non-zero per event in practice. Summing
 * inherits poisoned/scam-token prices that volume already defends against
 * (issue #733, regression of #670). Picking the trusted leg keeps the fee/volume
 * USD paths symmetric.
 *
 * @param event - V2 Pool Fees event
 * @param token0Instance - Token0 entity with price and decimals
 * @param token1Instance - Token1 entity with price and decimals
 * @returns Pool and user diffs with raw token-unit fees and trusted-leg USD fee
 */
export function processPoolFees(
  event: Pool_Fees_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): PoolFeesResult {
  // Symmetric defense with the volume path: price each leg independently, then
  // pick the trusted (smaller / non-zero fallback) leg. Issue #733.
  const token0FeeUSD = token0Instance
    ? calculateTokenAmountUSD(
        event.params.amount0,
        Number(token0Instance.decimals),
        token0Instance.pricePerUSDNew,
      )
    : 0n;
  const token1FeeUSD = token1Instance
    ? calculateTokenAmountUSD(
        event.params.amount1,
        Number(token1Instance.decimals),
        token1Instance.pricePerUSDNew,
      )
    : 0n;
  const totalFeesUSD = pickTrustedSwapVolumeUSD(token0FeeUSD, token1FeeUSD);

  const totalFeesUSDWhitelisted = calculateWhitelistedFeesUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  // Create liquidity pool diff
  const liquidityPoolDiff = {
    incrementalTotalFeesGenerated0: event.params.amount0,
    incrementalTotalFeesGenerated1: event.params.amount1,
    incrementalTotalFeesGeneratedUSD: totalFeesUSD,
    incrementalTotalFeesUSDWhitelisted: totalFeesUSDWhitelisted,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Prepare user diff data
  const userDiff = {
    incrementalTotalFeesContributedUSD: totalFeesUSD,
    incrementalTotalFeesContributed0: event.params.amount0,
    incrementalTotalFeesContributed1: event.params.amount1,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userDiff,
  };
}
