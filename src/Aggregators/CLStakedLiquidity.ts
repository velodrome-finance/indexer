import type { handlerContext } from "generated";
import { CLTickStakedId } from "../Constants";

/**
 * Uniswap v3 absolute tick range. Any tick outside [TICK_MIN, TICK_MAX] is
 * unreachable by a valid swap; seeing one indicates corrupt upstream state
 * (missed Initialize, event ordering bug, RPC inconsistency) and MUST NOT be
 * used to drive the CLTickStaked sweep — at tickSpacing=1 that is ~1.77M
 * iterations, each triggering an entity fetch.
 */
export const TICK_MIN = -887272n;
export const TICK_MAX = 887272n;

/**
 * Returns true if a position's tick range includes the current tick.
 * Follows Uniswap v3 convention: tickLower <= currentTick < tickUpper.
 *
 * @param tickLower - Position's lower tick boundary
 * @param tickUpper - Position's upper tick boundary
 * @param currentTick - Pool's current tick
 * @returns true if position is in range
 */
export function isPositionInRange(
  tickLower: bigint,
  tickUpper: bigint,
  currentTick: bigint,
): boolean {
  return tickLower <= currentTick && currentTick < tickUpper;
}

/**
 * Updates the two CLTickStaked entities that bookend a position's tick range.
 * Mirrors Uniswap v3's ticks[i].liquidityNet but for the staked subset only.
 *
 * The +/- convention follows Uniswap v3: when a swap crosses a tick going UP
 * (price increasing), the pool applies `liquidity += ticks[t].liquidityNet`.
 *   - At tickLower: position ENTERS range on upward cross → +liquidityDelta
 *   - At tickUpper: position EXITS range on upward cross  → -liquidityDelta
 * When crossing DOWN, the pool subtracts liquidityNet, which naturally reverses
 * both signs, correctly handling the opposite direction.
 *
 * On stake:   liquidityDelta = +position.liquidity
 * On unstake: liquidityDelta = -position.liquidity
 *
 * @param chainId - Chain ID
 * @param poolAddress - CL pool address
 * @param tickLower - Position's lower tick boundary
 * @param tickUpper - Position's upper tick boundary
 * @param liquidityDelta - Liquidity to add (positive) or remove (negative)
 * @param context - Handler context for entity access
 */
export async function updateTicksForStakedPosition(
  chainId: number,
  poolAddress: string,
  tickLower: bigint,
  tickUpper: bigint,
  liquidityDelta: bigint,
  context: handlerContext,
): Promise<void> {
  const lowerTickId = CLTickStakedId(chainId, poolAddress, tickLower);
  const upperTickId = CLTickStakedId(chainId, poolAddress, tickUpper);

  const [lowerTick, upperTick] = await Promise.all([
    context.CLTickStaked.get(lowerTickId),
    context.CLTickStaked.get(upperTickId),
  ]);

  context.CLTickStaked.set({
    id: lowerTickId,
    chainId,
    poolAddress,
    tickIndex: tickLower,
    stakedLiquidityNet: (lowerTick?.stakedLiquidityNet ?? 0n) + liquidityDelta,
  });

  context.CLTickStaked.set({
    id: upperTickId,
    chainId,
    poolAddress,
    tickIndex: tickUpper,
    stakedLiquidityNet: (upperTick?.stakedLiquidityNet ?? 0n) - liquidityDelta,
  });
}

/**
 * Aligns a tick value UP to the next tick-spacing boundary STRICTLY ABOVE tick.
 * Used to find the first initialized tick boundary to cross when price moves up.
 *
 * Examples with spacing=200:
 *   alignTickUp(100, 200)  → 200   (next multiple of 200 above 100)
 *   alignTickUp(200, 200)  → 400   (strictly above, so skip 200 itself)
 *   alignTickUp(0, 200)    → 200
 *   alignTickUp(-50, 200)  → 0
 *   alignTickUp(-200, 200) → 0     (strictly above -200)
 *
 * @param tick - Current tick value
 * @param spacing - Tick spacing
 * @returns Next tick-spacing-aligned tick strictly above tick
 */
function alignTickUp(tick: bigint, spacing: bigint): bigint {
  if (spacing === 0n) return tick;
  const t = tick + 1n;
  if (t >= 0n) {
    return ((t + spacing - 1n) / spacing) * spacing;
  }
  return -(-t / spacing) * spacing;
}

/**
 * Aligns a tick value DOWN to the tick-spacing boundary AT OR BELOW tick.
 * Used to find the first initialized tick boundary to cross when price moves down.
 *
 * Examples with spacing=200:
 *   alignTickDown(100, 200)  → 0    (floor to multiple of 200)
 *   alignTickDown(200, 200)  → 200  (already aligned, keep it)
 *   alignTickDown(399, 200)  → 200
 *   alignTickDown(-50, 200)  → -200
 *
 * @param tick - Current tick value
 * @param spacing - Tick spacing
 * @returns Tick-spacing-aligned tick at or below tick
 */
function alignTickDown(tick: bigint, spacing: bigint): bigint {
  if (spacing === 0n) return tick;
  if (tick >= 0n) {
    return (tick / spacing) * spacing;
  }
  return -((-tick + spacing - 1n) / spacing) * spacing;
}

/**
 * Processes tick crossings between oldTick and newTick, adjusting stakedLiquidityInRange
 * by reading CLTickStaked entities at each crossed tick boundary.
 *
 * Replicates the Uniswap v3 pool contract's tick-crossing logic for the staked subset:
 * when a swap crosses tick T going up, stakedLiq += tick[T].stakedLiquidityNet
 * when a swap crosses tick T going down, stakedLiq -= tick[T].stakedLiquidityNet
 *
 * Safety guards (added for the Lisk OOM hotfix):
 *   - `hasStakes=false` short-circuits the sweep for pools that have never been
 *     staked — the per-tick CLTickStaked reads are provably zero, so the loop
 *     cannot change `currentStakedLiqInRange`.
 *   - Out-of-range ticks (outside [TICK_MIN, TICK_MAX]) are rejected and logged
 *     instead of driving the loop with millions of iterations.
 *
 * @param chainId - Chain ID
 * @param poolAddress - CL pool address
 * @param oldTick - Tick before the swap
 * @param newTick - Tick after the swap
 * @param tickSpacing - Pool's tick spacing
 * @param context - Handler context for entity access
 * @param currentStakedLiqInRange - Staked in-range liquidity before the swap
 * @param hasStakes - Whether this pool has ever had a staked position (from the aggregator latch)
 * @returns Updated stakedLiquidityInRange after processing tick crossings
 */
export async function processTickCrossingsForStaked(
  chainId: number,
  poolAddress: string,
  oldTick: bigint,
  newTick: bigint,
  tickSpacing: bigint,
  context: handlerContext,
  currentStakedLiqInRange: bigint,
  hasStakes: boolean,
): Promise<bigint> {
  if (oldTick === newTick || tickSpacing === 0n) {
    return currentStakedLiqInRange;
  }

  // Bounds check runs BEFORE the hasStakes short-circuit so that out-of-range
  // ticks — which indicate upstream correctness bugs (missed Initialize, event
  // ordering, RPC inconsistency) — get surfaced regardless of whether the pool
  // has ever been staked. Unstaked CL pools are the majority, and silencing the
  // diagnostic on them would mask the signal.
  if (
    oldTick < TICK_MIN ||
    oldTick > TICK_MAX ||
    newTick < TICK_MIN ||
    newTick > TICK_MAX
  ) {
    context.log.error(
      `[processTickCrossingsForStaked] Tick out of Uniswap v3 range for pool ${poolAddress} on chain ${chainId}: oldTick=${oldTick}, newTick=${newTick}. Skipping crossing sweep to avoid runaway loop.`,
    );
    return currentStakedLiqInRange;
  }

  // Pools without any CLTickStaked entries cannot contribute to stakedLiq — skip
  // the sweep entirely. This is the hot path: it eliminates the O((Δtick)/spacing)
  // per-swap scan for every unstaked pool.
  if (!hasStakes) {
    return currentStakedLiqInRange;
  }

  let stakedLiq = currentStakedLiqInRange;

  if (newTick > oldTick) {
    // Price moving up — cross ticks from oldTick toward newTick
    const startTick = alignTickUp(oldTick, tickSpacing);
    const tickIds: string[] = [];
    for (let t = startTick; t <= newTick; t += tickSpacing) {
      tickIds.push(CLTickStakedId(chainId, poolAddress, t));
    }
    const tickEntities = await Promise.all(
      tickIds.map((id) => context.CLTickStaked.get(id)),
    );
    for (const tick of tickEntities) {
      if (tick) {
        stakedLiq += tick.stakedLiquidityNet;
      }
    }
  } else {
    // Price moving down — cross ticks from oldTick toward newTick
    const startTick = alignTickDown(oldTick, tickSpacing);
    const tickIds: string[] = [];
    for (let t = startTick; t > newTick; t -= tickSpacing) {
      tickIds.push(CLTickStakedId(chainId, poolAddress, t));
    }
    const tickEntities = await Promise.all(
      tickIds.map((id) => context.CLTickStaked.get(id)),
    );
    for (const tick of tickEntities) {
      if (tick) {
        stakedLiq -= tick.stakedLiquidityNet;
      }
    }
  }

  return stakedLiq;
}

/**
 * Computes the staked portion of a swap's reserve deltas using the proportional split.
 * All in-range liquidity participates equally in swaps, so staked share =
 * stakedLiqInRange / totalLiqInRange.
 *
 * @param reserveDelta0 - Total pool reserve change for token0
 * @param reserveDelta1 - Total pool reserve change for token1
 * @param stakedLiqInRange - Staked in-range liquidity
 * @param totalLiqInRange - Total in-range liquidity (from Swap event)
 * @returns Object with stakedDelta0 and stakedDelta1
 */
export function computeStakedSwapReserveDelta(
  reserveDelta0: bigint,
  reserveDelta1: bigint,
  stakedLiqInRange: bigint,
  totalLiqInRange: bigint,
): { stakedDelta0: bigint; stakedDelta1: bigint } {
  if (totalLiqInRange === 0n || stakedLiqInRange === 0n) {
    return { stakedDelta0: 0n, stakedDelta1: 0n };
  }
  return {
    stakedDelta0: (reserveDelta0 * stakedLiqInRange) / totalLiqInRange,
    stakedDelta1: (reserveDelta1 * stakedLiqInRange) / totalLiqInRange,
  };
}
