import type {
  CLPool_Collect_event,
  CLPositionPendingPrincipal,
  Token,
  handlerContext,
} from "generated";
import type { LiquidityPoolAggregatorDiff } from "../../Aggregators/LiquidityPoolAggregator";
import type { UserStatsPerPoolDiff } from "../../Aggregators/UserStatsPerPool";
import { CLPositionPendingPrincipalId } from "../../Constants";
import { calculateTotalUSD, calculateWhitelistedFeesUSD } from "../../Helpers";

export interface CLPoolCollectResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregatorDiff>;
  userLiquidityDiff: Partial<UserStatsPerPoolDiff>;
}

/**
 * Isolates the fee-only portion from a Collect event by subtracting
 * pending burned principal tracked by the Burn handler.
 *
 * Collect transfers tokensOwed which includes both burned principal and
 * accumulated swap fees. The Burn handler accumulates principal in
 * CLPositionPendingPrincipal. We subtract it here to get fees only.
 *
 * @param collectAmount - Total amount from the Collect event
 * @param pendingPrincipal - Accumulated burn principal for this position
 * @returns Object with the fee-only amount and the updated pending principal
 */
function isolateFees(
  collectAmount: bigint,
  pendingPrincipal: bigint,
): { fees: bigint; remainingPrincipal: bigint } {
  if (collectAmount >= pendingPrincipal) {
    // Entire pending principal is drained; remainder is fees
    return {
      fees: collectAmount - pendingPrincipal,
      remainingPrincipal: 0n,
    };
  }
  // Partial collect — only principal was drained, no fees in this collect
  return {
    fees: 0n,
    remainingPrincipal: pendingPrincipal - collectAmount,
  };
}

/**
 * Processes a CLPool Collect event: isolates actual swap fees from burned
 * principal, then returns diffs for pool and user fee tracking.
 *
 * Collect events should NOT affect reserves — the burned liquidity portion
 * was already subtracted by the Burn handler, and the fee portion was never
 * added to reserves (fees are excluded at swap time).
 *
 * @param event - The CLPool Collect event
 * @param token0Instance - Token0 entity for USD pricing
 * @param token1Instance - Token1 entity for USD pricing
 * @param context - Handler context for entity reads/writes
 * @returns Pool and user diffs with fee-only amounts
 */
export async function processCLPoolCollect(
  event: CLPool_Collect_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  context: handlerContext,
): Promise<CLPoolCollectResult> {
  // Load pending principal tracked by the Burn handler
  const trackerId = CLPositionPendingPrincipalId(
    event.chainId,
    event.srcAddress,
    event.params.owner,
    event.params.tickLower,
    event.params.tickUpper,
  );
  const tracker = await context.CLPositionPendingPrincipal.get(trackerId);

  // Isolate fees by subtracting burned principal from collect amounts
  const { fees: fees0, remainingPrincipal: remaining0 } = isolateFees(
    event.params.amount0,
    tracker?.pendingPrincipal0 ?? 0n,
  );
  const { fees: fees1, remainingPrincipal: remaining1 } = isolateFees(
    event.params.amount1,
    tracker?.pendingPrincipal1 ?? 0n,
  );

  // Update tracker with remaining principal (or clean up if fully drained)
  if (tracker) {
    context.CLPositionPendingPrincipal.set({
      ...tracker,
      pendingPrincipal0: remaining0,
      pendingPrincipal1: remaining1,
    });
  }

  // Calculate USD values from fee-only amounts
  const unstakedFeesUSD = calculateTotalUSD(
    fees0,
    fees1,
    token0Instance,
    token1Instance,
  );

  const totalFeesUSDWhitelistedIncrement = calculateWhitelistedFeesUSD(
    fees0,
    fees1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    incrementalTotalUnstakedFeesCollected0: fees0,
    incrementalTotalUnstakedFeesCollected1: fees1,
    incrementalTotalUnstakedFeesCollectedUSD: unstakedFeesUSD,
    incrementalTotalFeesUSDWhitelisted: totalFeesUSDWhitelistedIncrement,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };
  const userLiquidityDiff = {
    incrementalTotalUnstakedFeesCollected0: fees0,
    incrementalTotalUnstakedFeesCollected1: fees1,
    incrementalTotalUnstakedFeesCollectedUSD: unstakedFeesUSD,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
