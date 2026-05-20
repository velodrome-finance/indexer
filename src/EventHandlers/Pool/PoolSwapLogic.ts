import type { Pool_Swap_event, Token } from "generated";
import type { PoolDiff } from "../../Aggregators/Pool";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { pickTrustedSwapVolumeUSD } from "../../Helpers";
import { getTrustedUSD } from "../../PriceTrust";

export interface PoolSwapResult {
  liquidityPoolDiff: Partial<PoolDiff>;
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

  // Per-leg USD via PriceTrust gate: untrusted legs contribute 0n. The min
  // pick then guards against scam-token / poisoned-oracle inflation on the
  // remaining trusted leg (issues #699, #737, #755).
  const token0UsdValue = getTrustedUSD(netAmount0, token0Instance);
  const token1UsdValue = getTrustedUSD(netAmount1, token1Instance);

  const volumeInUSD = pickTrustedSwapVolumeUSD(token0UsdValue, token1UsdValue);

  // After #755, the WL/blacklist gate is enforced per leg above, so the
  // *Whitelisted aggregate is equal to volumeInUSD. The schema field is kept
  // for downstream backwards-compat; consumers can migrate to the canonical
  // `incrementalTotalVolumeUSD` field at their own pace.
  const volumeInUSDWhitelisted = volumeInUSD;

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
