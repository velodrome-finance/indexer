import type {
  CLPool_Burn_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import { CLPositionPendingPrincipalId } from "../../Constants";
import { calculateTotalUSD } from "../../Helpers";

export interface CLPoolBurnResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
}

/**
 * Processes a CLPool Burn event: updates reserves and tracks burned principal
 * so the Collect handler can isolate actual swap fees.
 *
 * @param event - The CLPool Burn event
 * @param liquidityPoolAggregator - Current pool aggregator state
 * @param token0Instance - Token0 entity for USD pricing
 * @param token1Instance - Token1 entity for USD pricing
 * @param context - Handler context for entity reads/writes
 * @returns Pool diff with reserve decrements and updated TVL
 */
export async function processCLPoolBurn(
  event: CLPool_Burn_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token,
  token1Instance: Token,
  context: handlerContext,
): Promise<CLPoolBurnResult> {
  // TVL definition: reserves track LP-deposited capital only.
  // Burn removes capital from a position (tokens stay in contract as tokensOwed
  // until collect(), but are no longer part of any LP position's liquidity).
  const newReserve0 = liquidityPoolAggregator.reserve0 - event.params.amount0;
  const newReserve1 = liquidityPoolAggregator.reserve1 - event.params.amount1;
  const currentTotalLiquidityUSD = calculateTotalUSD(
    newReserve0,
    newReserve1,
    token0Instance,
    token1Instance,
  );

  // Track burned principal so Collect can isolate fees.
  // Burn event amount0/amount1 = principal removed from position (not fees).
  // These accumulate until the position owner calls collect().
  await trackBurnedPrincipal(event, context);

  const liquidityPoolDiff = {
    incrementalReserve0: -event.params.amount0,
    incrementalReserve1: -event.params.amount1,
    currentTotalLiquidityUSD: currentTotalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
  };
}

/**
 * Accumulates burned principal on CLPositionPendingPrincipal so that
 * the Collect handler can subtract it to isolate actual swap fees.
 *
 * @param event - The CLPool Burn event containing position identity and principal amounts
 * @param context - Handler context for entity reads/writes
 */
async function trackBurnedPrincipal(
  event: CLPool_Burn_event,
  context: handlerContext,
): Promise<void> {
  const trackerId = CLPositionPendingPrincipalId(
    event.chainId,
    event.srcAddress,
    event.params.owner,
    event.params.tickLower,
    event.params.tickUpper,
  );
  const existing = await context.CLPositionPendingPrincipal.get(trackerId);
  context.CLPositionPendingPrincipal.set({
    id: trackerId,
    pendingPrincipal0:
      (existing?.pendingPrincipal0 ?? 0n) + event.params.amount0,
    pendingPrincipal1:
      (existing?.pendingPrincipal1 ?? 0n) + event.params.amount1,
  });
}
