import type {
  CLPool_CollectFees_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { calculateTotalLiquidityUSD } from "../../Helpers";

interface StakedFeesTotalsBase {
  totalStakedFeesCollected0: bigint;
  totalStakedFeesCollected1: bigint;
  totalStakedFeesCollectedUSD: bigint;
  totalFeesUSDWhitelisted: bigint;
}

interface StakedFeesTotals extends StakedFeesTotalsBase {
  lastUpdatedTimestamp: Date;
}

export interface CLPoolCollectFeesResult {
  liquidityPoolDiff: StakedFeesTotals;
  userDiff: {
    totalFeesContributedUSD: bigint;
    totalFeesContributed0: bigint;
    totalFeesContributed1: bigint;
    lastActivityTimestamp: Date;
  };
}

/**
 * Calculates the staked fees collected from the gauge system.
 *
 * This function calculates the fees collected in both tokens and USD value for staked LPs.
 * The USD values are computed by:
 * 1. Normalizing token amounts to 18 decimals
 * 2. Multiplying by the token's USD price
 *
 * @param liquidityPoolAggregator - The current state of the liquidity pool
 * @param event - The event containing fee collection data (amount0, amount1)
 * @param token0Instance - Token instance for token0, containing decimals and price data
 * @param token1Instance - Token instance for token1, containing decimals and price data
 *
 * @returns Staked fee totals across token0, token1, USD, and whitelisted USD
 */
function calculateStakedFees(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  event: CLPool_CollectFees_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): StakedFeesTotalsBase {
  // Calculate staked fees (from CollectFees events - LPs that staked in gauge)
  const totalStakedFeesCollected0 =
    liquidityPoolAggregator.totalStakedFeesCollected0 + event.params.amount0;
  const totalStakedFeesCollected1 =
    liquidityPoolAggregator.totalStakedFeesCollected1 + event.params.amount1;

  // Calculate total staked fees in USD
  const totalStakedFeesCollectedUSD =
    liquidityPoolAggregator.totalStakedFeesCollectedUSD +
    calculateTotalLiquidityUSD(
      event.params.amount0,
      event.params.amount1,
      token0Instance,
      token1Instance,
    );

  // Calculate whitelisted fees: add each token's fees individually if whitelisted
  // Note: totalFeesUSDWhitelisted includes both staked and unstaked fees
  let totalFeesUSDWhitelisted = liquidityPoolAggregator.totalFeesUSDWhitelisted;

  if (token0Instance) {
    const token0FeesUSD = calculateTotalLiquidityUSD(
      event.params.amount0,
      0n,
      token0Instance,
      undefined,
    );
    if (token0Instance.isWhitelisted) {
      totalFeesUSDWhitelisted += token0FeesUSD;
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
      totalFeesUSDWhitelisted += token1FeesUSD;
    }
  }

  return {
    totalStakedFeesCollected0,
    totalStakedFeesCollected1,
    totalStakedFeesCollectedUSD,
    totalFeesUSDWhitelisted,
  };
}

export function processCLPoolCollectFees(
  event: CLPool_CollectFees_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): CLPoolCollectFeesResult {
  const stakedFeesData = calculateStakedFees(
    liquidityPoolAggregator,
    event,
    token0Instance,
    token1Instance,
  );

  // In CL pools, gauge fees accumulate in gaugeFees.token0/token1 and are NOT part of base reserves.
  // When collected, they're transferred out but were never in the tracked reserves.
  // Therefore, CollectFees events should NOT affect reserves - only track fees collected.
  const liquidityPoolDiff = {
    totalStakedFeesCollected0: stakedFeesData.totalStakedFeesCollected0,
    totalStakedFeesCollected1: stakedFeesData.totalStakedFeesCollected1,
    totalStakedFeesCollectedUSD: stakedFeesData.totalStakedFeesCollectedUSD,
    totalFeesUSDWhitelisted: stakedFeesData.totalFeesUSDWhitelisted,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  const userDiff = {
    totalFeesContributedUSD: stakedFeesData.totalStakedFeesCollectedUSD,
    totalFeesContributed0: event.params.amount0,
    totalFeesContributed1: event.params.amount1,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userDiff,
  };
}
