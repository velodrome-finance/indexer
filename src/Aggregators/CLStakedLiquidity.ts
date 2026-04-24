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
 * Binary-search an ascending-sorted bigint[] for `target` — O(log n) comparisons.
 *
 * Returns the lowest index `i` such that `arr[i] >= target`, or `arr.length`
 * if every element is strictly less than `target`. Matches `std::lower_bound`.
 *
 * Why binary search, not linear: per-pool edge counts can reach ~22k (#648's
 * worst-case envelope). Linear would scan all of them even when a typical swap
 * crosses 0–few; O(log n) jumps straight to the crossing window.
 *
 * @param arr - Sorted ascending array (monotone; no duplicates in stakedTickEdges)
 * @param target - Tick value to locate
 * @returns Lower-bound index in [0, arr.length]
 */
function lowerBound(arr: readonly bigint[], target: bigint): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Applies a +/-delta to the running net at `tick` on the parallel (edges, nets)
 * arrays. Inserts a new (edge, net) entry if `tick` is not present; when the
 * resulting net becomes 0n the edge is dropped. Returns a NEW pair of arrays —
 * Envio entities are immutable and must be replaced, not patched.
 *
 * Cost: O(log E) for the binary-search locate, O(E) for the immutable array
 * copy (where E = edges.length). The copy dominates. #648's worst-case
 * envelope: ~50µs at E=22k on V8 (pointer memcpy at ~10 GB/s). At 2500
 * stake/unstake writes/batch that's ~125ms extra CPU per batch — the cost
 * we're paying to break the OOM fan-out.
 *
 * The parallel-arrays shape mirrors Uniswap v3's per-tick `liquidityNet`: one
 * running counter per initialized tick, adjusted on every stake/unstake event
 * that crosses that boundary. Multiple staked positions at the same edge sum
 * into the same slot, which is how refcount is expressed implicitly (no
 * separate counter is needed).
 *
 * @param edges - Current sorted-ascending edge list (must be monotone, no dupes)
 * @param nets - Parallel nets array (same length, same index as `edges`)
 * @param tick - Tick value to adjust
 * @param delta - Signed delta to add to the net at `tick`
 * @returns { edges, nets } new parallel arrays with the delta applied
 */
function applyDeltaAtTick(
  edges: readonly bigint[],
  nets: readonly bigint[],
  tick: bigint,
  delta: bigint,
): { edges: bigint[]; nets: bigint[] } {
  const idx = lowerBound(edges, tick);
  const present = idx < edges.length && edges[idx] === tick;

  if (present) {
    const newNet = nets[idx] + delta;
    if (newNet === 0n) {
      // Build via push to keep V8 packed-elements kind (pre-sized `new Array`
      // stays HOLEY_SMI_ELEMENTS even after every slot is filled, which
      // prevents the packed fast path in downstream iterators).
      const outEdges: bigint[] = [];
      const outNets: bigint[] = [];
      for (let i = 0; i < idx; i++) {
        outEdges.push(edges[i]);
        outNets.push(nets[i]);
      }
      for (let i = idx + 1; i < edges.length; i++) {
        outEdges.push(edges[i]);
        outNets.push(nets[i]);
      }
      return { edges: outEdges, nets: outNets };
    }
    const outEdges = edges.slice();
    const outNets = nets.slice();
    outNets[idx] = newNet;
    return { edges: outEdges, nets: outNets };
  }

  // Not present — insert. The caller (applyStakedPositionToEdges) already
  // rejects delta === 0n at its top guard, so reaching this branch with a
  // zero delta is unreachable by construction.
  // Build via push to keep V8 packed-elements kind (see note above).
  const outEdges: bigint[] = [];
  const outNets: bigint[] = [];
  for (let i = 0; i < idx; i++) {
    outEdges.push(edges[i]);
    outNets.push(nets[i]);
  }
  outEdges.push(tick);
  outNets.push(delta);
  for (let i = idx; i < edges.length; i++) {
    outEdges.push(edges[i]);
    outNets.push(nets[i]);
  }
  return { edges: outEdges, nets: outNets };
}

/**
 * Reason tag emitted by `applyStakedPositionToEdges` when it refuses to apply a
 * position. Callers use this to log the anomaly while still receiving valid
 * (unchanged) arrays to assign into the aggregator diff.
 *   - "ticks_out_of_range": at least one tick is outside [TICK_MIN, TICK_MAX].
 *     Indicates upstream state corruption (bad NFPM event, ordering bug, etc.).
 *   - "degenerate_range": tickLower >= tickUpper. Should never happen for a
 *     valid Uniswap v3 position; indicates bad upstream data.
 * `liquidityDelta === 0n` is a legitimate no-op (e.g., the Mint-0 case from
 * NFPM) and does NOT produce a rejection tag.
 */
export type StakedEdgesRejection = "ticks_out_of_range" | "degenerate_range";

/**
 * Applies a staked-position liquidity change ([tickLower, tickUpper] × liquidityDelta)
 * to the parallel (edges, nets) arrays. Mirrors the updateTicksForStakedPosition
 * CLTickStaked write, but in-aggregator so the swap path never needs to load it.
 *
 * Convention (same as CLTickStaked):
 *   - At tickLower: net += liquidityDelta  (positions ENTER range on upward cross)
 *   - At tickUpper: net -= liquidityDelta  (positions EXIT range on upward cross)
 *
 * On stake:   liquidityDelta = +position.liquidity
 * On unstake: liquidityDelta = -position.liquidity
 *
 * When the inputs would violate an invariant (ticks outside Uniswap v3 range,
 * or tickLower >= tickUpper), the arrays are returned unchanged and `rejected`
 * carries a tag so the caller can log the anomaly. Zero-delta is a silent
 * no-op (no tag) because it is a legitimate NFPM Mint-0 / liq-unchanged flow.
 *
 * @param edges - Current sorted edge list
 * @param nets - Parallel nets
 * @param tickLower - Position's lower tick boundary
 * @param tickUpper - Position's upper tick boundary
 * @param liquidityDelta - Signed liquidity change
 * @returns New parallel (edges, nets) arrays; `rejected` set when an invariant
 *          violation prevented the update
 */
export function applyStakedPositionToEdges(
  edges: readonly bigint[],
  nets: readonly bigint[],
  tickLower: bigint,
  tickUpper: bigint,
  liquidityDelta: bigint,
): { edges: bigint[]; nets: bigint[]; rejected?: StakedEdgesRejection } {
  if (liquidityDelta === 0n) {
    return { edges: edges.slice(), nets: nets.slice() };
  }
  if (
    tickLower < TICK_MIN ||
    tickLower > TICK_MAX ||
    tickUpper < TICK_MIN ||
    tickUpper > TICK_MAX
  ) {
    return {
      edges: edges.slice(),
      nets: nets.slice(),
      rejected: "ticks_out_of_range",
    };
  }
  if (tickLower >= tickUpper) {
    return {
      edges: edges.slice(),
      nets: nets.slice(),
      rejected: "degenerate_range",
    };
  }

  const afterLower = applyDeltaAtTick(edges, nets, tickLower, liquidityDelta);
  return applyDeltaAtTick(
    afterLower.edges,
    afterLower.nets,
    tickUpper,
    -liquidityDelta,
  );
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
 * DEPRECATED in-place alongside #649: the swap path no longer reads
 * CLTickStaked, and no other internal consumer remains. The writes are kept
 * on purpose for one release so the GraphQL entity (which is auto-exposed
 * to external consumers) doesn't disappear without notice. Scheduled for
 * removal in velodrome-finance/indexer#652. New callers MUST use
 * applyStakedPositionToEdges on the aggregator.
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
 * Processes tick crossings between oldTick and newTick, adjusting
 * stakedLiquidityInRange by walking the in-aggregator (stakedTickEdges,
 * stakedTickEdgeNets) parallel arrays.
 *
 * Replicates the Uniswap v3 pool contract's tick-crossing logic for the staked
 * subset: when a swap crosses tick T going up, stakedLiq += net[T]; when going
 * down, stakedLiq -= net[T].
 *
 * Structural fix for the 20GB OOM (see #648, #649):
 *   - Zero `.get()` or `.getWhere()` calls on the swap path. The per-edge net is
 *     read from the in-memory `stakedTickEdgeNets` array carried on the
 *     aggregator, not from a CLTickStaked entity load.
 *   - Total cost per swap: O(log E + K) where E = per-pool edge count (worst
 *     case ~22k per #648) and K = edges actually crossed (typically 0–few).
 *     Linear scanning all E edges is what this replaces, and what drove the
 *     OOM in the old implementation — every candidate tick-spacing step
 *     issued a CLTickStaked.get.
 *   - Breaks the chain-of-amplification from #648: no LoadManager grouping, no
 *     postgres-js text[] serialization, no InMemTable CLTickStaked accumulation,
 *     no 5000-handler preload fan-out.
 *
 * Safety guards retained from PR 1 (#650):
 *   - `hasStakes=false` short-circuits the walk entirely. Redundant with an
 *     empty edge list, but kept explicit for parity with other call sites.
 *   - Out-of-range ticks (outside [TICK_MIN, TICK_MAX]) are rejected and logged
 *     with a `STAKED_TICK_DRIFT` tag so ops can alert on it. After a bail the
 *     aggregator still writes the new tick, so downstream reads of
 *     `stakedLiquidityInRange` on this pool will be stale by the un-applied
 *     nets until the next rebuild — worth alerting on.
 *
 * Pure in-memory computation. Uses the Envio `context` ONLY for
 * `context.log.error` — any entity access here (e.g. `context.CLTickStaked.get`)
 * would reintroduce the #648 OOM fan-out this function was written to replace.
 * Enforced by the throwing spy in test/Aggregators/CLStakedLiquidityEdgeSanity.test.ts
 * and CLStakedLiquidity.test.ts.
 *
 * @param chainId - Chain ID (used only for error logging)
 * @param poolAddress - CL pool address (used only for error logging)
 * @param oldTick - Tick before the swap
 * @param newTick - Tick after the swap
 * @param tickSpacing - Pool's tick spacing (used only to short-circuit when 0)
 * @param context - Envio handler context — used ONLY for context.log.error;
 *                  must not touch entity APIs (see note above)
 * @param currentStakedLiqInRange - Staked in-range liquidity before the swap
 * @param hasStakes - Whether this pool has ever had a staked position
 * @param stakedTickEdges - Sorted, dedup'd tick edges from the aggregator
 * @param stakedTickEdgeNets - Parallel nets (same index as stakedTickEdges)
 * @returns Updated stakedLiquidityInRange after processing tick crossings
 */
export function processTickCrossingsForStaked(
  chainId: number,
  poolAddress: string,
  oldTick: bigint,
  newTick: bigint,
  tickSpacing: bigint,
  context: handlerContext,
  currentStakedLiqInRange: bigint,
  hasStakes: boolean,
  stakedTickEdges: readonly bigint[],
  stakedTickEdgeNets: readonly bigint[],
): bigint {
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
      `[STAKED_TICK_DRIFT][processTickCrossingsForStaked] Tick out of Uniswap v3 range for pool ${poolAddress} on chain ${chainId}: oldTick=${oldTick}, newTick=${newTick}. Skipping crossing sweep to avoid runaway loop; stakedLiquidityInRange will be stale on this pool until a subsequent stake/unstake rebuilds it.`,
    );
    return currentStakedLiqInRange;
  }

  // Pools without any staked positions cannot contribute to stakedLiq — skip
  // the binary search entirely. This is the hot path: it eliminates the
  // O(log E + k) per-swap cost for every unstaked pool.
  if (!hasStakes || stakedTickEdges.length === 0) {
    return currentStakedLiqInRange;
  }

  let stakedLiq = currentStakedLiqInRange;

  if (newTick > oldTick) {
    // Price moving up — cross ticks STRICTLY above oldTick, up to and including newTick.
    // Mirror the pre-PR alignTickUp semantics (strictly above oldTick) by starting the
    // binary search at `oldTick + 1`.
    const startIdx = lowerBound(stakedTickEdges, oldTick + 1n);
    for (let i = startIdx; i < stakedTickEdges.length; i++) {
      if (stakedTickEdges[i] > newTick) break;
      stakedLiq += stakedTickEdgeNets[i];
    }
  } else {
    // Price moving down — cross ticks AT OR BELOW oldTick, strictly above newTick.
    // Walk backwards from the last edge <= oldTick.
    const endIdx = lowerBound(stakedTickEdges, oldTick + 1n) - 1;
    for (let i = endIdx; i >= 0; i--) {
      if (stakedTickEdges[i] <= newTick) break;
      stakedLiq -= stakedTickEdgeNets[i];
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
