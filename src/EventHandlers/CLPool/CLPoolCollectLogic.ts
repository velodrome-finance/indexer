import type { CLPool_Collect_event, Token, handlerContext } from "generated";
import { calculateTotalLiquidityUSD } from "../../Helpers";

export interface CLPoolCollectResult {
  liquidityPoolDiff: {
    totalUnstakedFeesCollected0: bigint;
    totalUnstakedFeesCollected1: bigint;
    totalUnstakedFeesCollectedUSD: bigint;
  };
  userLiquidityDiff: {
    totalFeesContributed0: bigint;
    totalFeesContributed1: bigint;
    totalFeesContributedUSD: bigint;
  };
}

export function processCLPoolCollect(
  event: CLPool_Collect_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): CLPoolCollectResult {
  // Calculate USD values using already-refreshed token prices from loadPoolData
  // In CL pools, fees accumulate in positions (tokensOwed0/tokensOwed1) and are NOT part of base reserves.
  // When collected, they're transferred out but were never in the tracked reserves.
  // Therefore, Collect events should NOT affect reserves - only track fees collected.
  const totalFeesContributedUSD = calculateTotalLiquidityUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    // Track unstaked fees (from Collect events - LPs that didn't stake)
    totalUnstakedFeesCollected0: event.params.amount0,
    totalUnstakedFeesCollected1: event.params.amount1,
    totalUnstakedFeesCollectedUSD: totalFeesContributedUSD,
  };
  const userLiquidityDiff = {
    totalFeesContributed0: event.params.amount0, // The collected fees in token0
    totalFeesContributed1: event.params.amount1, // The collected fees in token1
    totalFeesContributedUSD, // The collected fees in USD
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
