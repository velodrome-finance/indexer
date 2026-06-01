import type { EvmEvent } from "envio";
import type { Token } from "envio";
import type { PoolDiff } from "../../Aggregators/Pool";
import type { Pool } from "../../EntityTypes";
import { calculateTotalUSD } from "../../Helpers";

export interface CLPoolMintResult {
  liquidityPoolDiff: Partial<PoolDiff>;
}

/**
 * Processes a CLPool Mint event: updates reserves and, when the position is
 * in-range against the pool's current tick, bumps `liquidityInRange` by the
 * minted L so the field tracks the on-chain `liquidity()` getter between swaps.
 *
 * The in-range gate matches Uniswap v3 semantics:
 * `tickLower <= aggregator.tick < tickUpper` (lower inclusive, upper exclusive).
 * Swap remains authoritative on `liquidityInRange` and resets the absolute
 * value (see CLPoolSwapLogic). See velodrome-finance/indexer#703.
 *
 * @param event - The CLPool Mint event
 * @param liquidityPoolAggregator - Current pool aggregator state (provides current tick)
 * @param token0Instance - Token0 entity for USD pricing
 * @param token1Instance - Token1 entity for USD pricing
 * @returns Pool diff with reserve increments and, if in range, incrementalLiquidityInRange
 */
export function processCLPoolMint(
  event: EvmEvent<"CLPool", "Mint">,
  liquidityPoolAggregator: Pool,
  token0Instance: Token,
  token1Instance: Token,
): CLPoolMintResult {
  // TVL definition: reserves track LP-deposited capital only.
  // Mint deposits new capital into the pool — always increases reserves.
  const newReserve0 = liquidityPoolAggregator.reserve0 + event.params.amount0;
  const newReserve1 = liquidityPoolAggregator.reserve1 + event.params.amount1;
  const currentTotalLiquidityUSD = calculateTotalUSD(
    newReserve0,
    newReserve1,
    token0Instance,
    token1Instance,
  );

  const currentTick = liquidityPoolAggregator.tick;
  const isInRange =
    currentTick !== undefined &&
    event.params.tickLower <= currentTick &&
    currentTick < event.params.tickUpper;

  const liquidityPoolDiff: Partial<PoolDiff> = {
    incrementalReserve0: event.params.amount0,
    incrementalReserve1: event.params.amount1,
    currentTotalLiquidityUSD: currentTotalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    ...(isInRange ? { incrementalLiquidityInRange: event.params.amount } : {}),
  };

  return {
    liquidityPoolDiff,
  };
}
