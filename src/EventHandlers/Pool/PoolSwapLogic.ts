import type { Pool_Swap_event, Token } from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { calculateTokenAmountUSD } from "../../Helpers";

export interface PoolSwapResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userSwapDiff: Partial<UserStatsPerPoolDiff>;
}

/**
 * Process swap event using already-refreshed token prices from loadPoolData
 * This matches CLPoolSwapLogic pattern
 */
export function processPoolSwap(
  event: Pool_Swap_event,
  token0Instance: Token,
  token1Instance: Token,
): PoolSwapResult {
  // Calculate net amounts (sum of in and out)
  const netAmount0 = event.params.amount0In + event.params.amount0Out;
  const netAmount1 = event.params.amount1In + event.params.amount1Out;

  // Calculate USD values using already-refreshed token prices
  const token0UsdValue = calculateTokenAmountUSD(
    netAmount0,
    Number(token0Instance.decimals),
    token0Instance.pricePerUSDNew,
  );
  const token1UsdValue = calculateTokenAmountUSD(
    netAmount1,
    Number(token1Instance.decimals),
    token1Instance.pricePerUSDNew,
  );

  // Calculate volume in USD (use token0 if available and non-zero, otherwise token1)
  const volumeInUSD =
    token0UsdValue !== undefined && token0UsdValue !== 0n
      ? token0UsdValue
      : (token1UsdValue ?? 0n);

  // Calculate whitelisted volume (both tokens must be whitelisted)
  const volumeInUSDWhitelisted =
    token0Instance.isWhitelisted && token1Instance.isWhitelisted
      ? (token0UsdValue ?? token1UsdValue ?? 0n)
      : 0n;

  // Create liquidity pool diff
  const liquidityPoolDiff = {
    incrementalTotalVolume0: netAmount0,
    incrementalTotalVolume1: netAmount1,
    incrementalTotalVolumeUSD: volumeInUSD,
    incrementalTotalVolumeUSDWhitelisted: volumeInUSDWhitelisted,
    token0Price: token0Instance.pricePerUSDNew,
    token1Price: token1Instance.pricePerUSDNew,
    incrementalNumberOfSwaps: 1n,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Create user swap diff
  const userSwapDiff = {
    incrementalNumberOfSwaps: 1n,
    incrementalTotalSwapVolumeUSD: volumeInUSD,
    incrementalTotalSwapVolumeAmount0: netAmount0,
    incrementalTotalSwapVolumeAmount1: netAmount1,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userSwapDiff,
  };
}
