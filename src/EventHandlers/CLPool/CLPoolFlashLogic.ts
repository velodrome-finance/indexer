import type { CLPool_Flash_event, Token } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { calculateTotalLiquidityUSD } from "../../Helpers";

export interface CLPoolFlashResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userFlashLoanDiff: Partial<UserStatsPerPoolDiff>;
}

export function processCLPoolFlash(
  event: CLPool_Flash_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): CLPoolFlashResult {
  // Calculate flash loan fees in USD using already-refreshed token prices from loadPoolData
  const flashLoanFeesUSD = calculateTotalLiquidityUSD(
    event.params.paid0,
    event.params.paid1,
    token0Instance,
    token1Instance,
  );

  // Calculate flash loan volume in USD (amount borrowed, not fees) using already-refreshed token prices
  const flashLoanVolumeUSD = calculateTotalLiquidityUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    incrementalTotalFlashLoanFees0: event.params.paid0,
    incrementalTotalFlashLoanFees1: event.params.paid1,
    incrementalTotalFlashLoanFeesUSD: flashLoanFeesUSD,
    incrementalTotalFlashLoanVolumeUSD: flashLoanVolumeUSD,
    incrementalNumberOfFlashLoans: 1n,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  const userFlashLoanDiff = {
    incrementalNumberOfFlashLoans: 1n, // Each flash event represents 1 flash loan
    incrementalTotalFlashLoanVolumeUSD: flashLoanVolumeUSD,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userFlashLoanDiff,
  };
}
