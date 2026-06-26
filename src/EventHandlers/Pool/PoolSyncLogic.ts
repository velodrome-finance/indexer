import type { EvmEvent, Token } from "envio";
import type { PoolDiff } from "../../Aggregators/Pool";
import type { Pool } from "../../EntityTypes";
import { calculateLiquidityUSD } from "../../Helpers";
import { deriveV2PriceRatios, pickPriceRatios } from "../../PoolPriceRatio";

export interface PoolSyncResult {
  liquidityPoolDiff: Partial<PoolDiff>;
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
  event: EvmEvent<"Pool", "Sync">,
  liquidityPoolAggregator: Pool,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): PoolSyncResult {
  // token0Price/token1Price are the pool-internal exchange rate, derived from
  // the synced reserves — NOT from token oracle prices. This keeps the ratio
  // oracle-independent so a mispriced token (e.g. a non-WL scam token) can no
  // longer inflate it without bound (#783). pickPriceRatios falls back to the
  // last-known ratio per leg when decimals are unavailable or reserves are zero.
  // Computed before the reserve branches so the #892 TVL cap below can use it.
  const priceRatios = pickPriceRatios(
    token0Instance && token1Instance
      ? deriveV2PriceRatios(
          event.params.reserve0,
          event.params.reserve1,
          token0Instance.decimals,
          token1Instance.decimals,
        )
      : { token0Price: 0n, token1Price: 0n },
    liquidityPoolAggregator,
  );

  // Handle different scenarios based on token availability and amounts
  let reserve0Change: bigint;
  let reserve1Change: bigint;
  let currentTotalLiquidityUSD: bigint | undefined;

  if (!token0Instance && !token1Instance) {
    // No tokens available: keep existing values (no change)
    reserve0Change = 0n;
    reserve1Change = 0n;
  } else if (event.params.reserve0 === 0n && event.params.reserve1 === 0n) {
    // Zero amounts: set reserves to zero (snapshot behavior)
    reserve0Change = -liquidityPoolAggregator.reserve0;
    reserve1Change = -liquidityPoolAggregator.reserve1;
    currentTotalLiquidityUSD = 0n;
  } else {
    // Normal case: Sync events set reserves to absolute values
    // Calculate the delta needed to set reserves to the exact values from the event
    // This ensures reserves match the Sync event, even if Mint/Burn events
    // have already modified reserves in the same block
    reserve0Change = event.params.reserve0 - liquidityPoolAggregator.reserve0;
    reserve1Change = event.params.reserve1 - liquidityPoolAggregator.reserve1;

    // totalLiquidityUSD is non-cumulative: overwrite it using the absolute
    // post-sync reserves rather than applying a delta from the previous value.
    // Issue #892: directional TVL cap against a hard-anchor counterparty, using
    // the freshly-derived pool ratio as the implied-price witness.
    currentTotalLiquidityUSD = calculateLiquidityUSD(
      event.params.reserve0,
      event.params.reserve1,
      token0Instance,
      token1Instance,
      priceRatios.token0Price,
      priceRatios.token1Price,
      liquidityPoolAggregator.chainId,
    );
  }

  const liquidityPoolDiff = {
    incrementalReserve0: reserve0Change,
    incrementalReserve1: reserve1Change,
    currentTotalLiquidityUSD,
    token0Price: priceRatios.token0Price,
    token1Price: priceRatios.token1Price,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
  };
}
