import type { CLPool_CollectFees_event, Token } from "generated";
import { calculateTotalLiquidityUSD } from "../../Helpers";

export interface CLPoolCollectFeesResult {
  liquidityPoolDiff: {
    incrementalStakedFeesCollected0: bigint;
    incrementalStakedFeesCollected1: bigint;
    incrementalStakedFeesCollectedUSD: bigint;
    incrementalFeesUSDWhitelisted: bigint;
    lastUpdatedTimestamp: Date;
  };
  userDiff: {
    incrementalFeesContributedUSD: bigint;
    incrementalFeesContributed0: bigint;
    incrementalFeesContributed1: bigint;
    lastActivityTimestamp: Date;
  };
}

export function processCLPoolCollectFees(
  event: CLPool_CollectFees_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): CLPoolCollectFeesResult {
  // Calculate the increment values (not new totals)
  // updateLiquidityPoolAggregator expects increments and will add them to current values
  const stakedFeesIncrementUSD = calculateTotalLiquidityUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  // Calculate whitelisted fees increment: add each token's fees individually if whitelisted
  let totalFeesUSDWhitelistedIncrement = 0n;

  if (token0Instance) {
    const token0FeesUSD = calculateTotalLiquidityUSD(
      event.params.amount0,
      0n,
      token0Instance,
      undefined,
    );
    if (token0Instance.isWhitelisted) {
      totalFeesUSDWhitelistedIncrement += token0FeesUSD;
    }
  }

  if (token1Instance) {
    const token1FeesUSD = calculateTotalLiquidityUSD(
      0n,
      event.params.amount1,
      undefined,
      token1Instance,
    );
    if (token1Instance.isWhitelisted) {
      totalFeesUSDWhitelistedIncrement += token1FeesUSD;
    }
  }

  // In CL pools, gauge fees accumulate in gaugeFees.token0/token1 and are NOT part of base reserves.
  // When collected, they're transferred out but were never in the tracked reserves.
  // Therefore, CollectFees events should NOT affect reserves - only track fees collected.
  // Return increments (not new totals) since updateLiquidityPoolAggregator will add them to current values
  const liquidityPoolDiff = {
    incrementalStakedFeesCollected0: event.params.amount0,
    incrementalStakedFeesCollected1: event.params.amount1,
    incrementalStakedFeesCollectedUSD: stakedFeesIncrementUSD,
    incrementalFeesUSDWhitelisted: totalFeesUSDWhitelistedIncrement,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  const userDiff = {
    incrementalFeesContributedUSD: stakedFeesIncrementUSD,
    incrementalFeesContributed0: event.params.amount0,
    incrementalFeesContributed1: event.params.amount1,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userDiff,
  };
}
