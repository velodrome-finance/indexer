import { TickMath } from "@uniswap/v3-sdk";
import type { handlerContext } from "../EntityTypes";

/**
 * Uniswap v3 absolute tick range. Any tick outside [TICK_MIN, TICK_MAX] is
 * unreachable by a valid swap; seeing one indicates corrupt upstream state
 * (missed Initialize, event ordering bug, RPC inconsistency) and MUST NOT be
 * used to drive the staked-tick sweep — at tickSpacing=1 that is ~1.77M
 * iterations.
 */
export const TICK_MIN = -887272n;
export const TICK_MAX = 887272n;

/** Q96 fixed-point scale used by Uniswap v3 sqrtPriceX96. */
const Q96 = 1n << 96n;

/**
 * Wraps `TickMath.getSqrtRatioAtTick` to return a bigint instead of JSBI.
 * Tick is clamped to the Uniswap v3 valid range upstream by every caller
 * (`processTickCrossingsForStaked` runs the bound check before the loop;
 * edges in `stakedTickEdges` are enforced in-range by `applyStakedPositionToEdges`),
 * so this helper trusts the input and does no validation.
 *
 * @param tick - Tick index (must be within [TICK_MIN, TICK_MAX])
 * @returns sqrt(1.0001^tick) in Q64.96 fixed-point as bigint
 */
function sqrtRatioAtTick(tick: bigint): bigint {
  return BigInt(TickMath.getSqrtRatioAtTick(Number(tick)).toString());
}

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
 * to the parallel (edges, nets) arrays. In-aggregator only — the swap path never
 * needs to load a per-tick entity.
 *
 * Convention (mirrors Uniswap v3 per-tick liquidityNet):
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
 * Derives `stakedLiquidityInRange` from the canonical edge state at a given
 * tick — replaces the running counter that drifted in issue #719.
 *
 *   stakedLiquidityInRange = Σ stakedTickEdgeNets[i]  where stakedTickEdges[i] <= currentTick
 *
 * Equivalent to the Uniswap v3 liquidityNet sum across all ticks the pool has
 * crossed going up. Uses the same upper-exclusive convention as
 * `isPositionInRange` (a position with tickUpper === currentTick is OUT of
 * range, so its net at tickUpper is included and cancels its tickLower entry).
 *
 * Cost: O(log E + K) — binary-search the upper bound, then sum the prefix.
 * For per-pool edge counts up to a few thousand the prefix scan is a handful
 * of microseconds; cheap enough to invoke on every staked-position write so
 * the cached counter cannot drift from the edge truth.
 *
 * @param currentTick - The pool's current tick
 * @param edges - Sorted-ascending stakedTickEdges from the aggregator
 * @param nets - Parallel stakedTickEdgeNets (same length, same index)
 * @returns Σ nets[i] for edges[i] <= currentTick; 0n on empty edge list
 */
export function deriveStakedLiquidityInRange(
  currentTick: bigint,
  edges: readonly bigint[],
  nets: readonly bigint[],
): bigint {
  // First index strictly above currentTick — everything before it is in range.
  const upper = lowerBound(edges, currentTick + 1n);
  let sum = 0n;
  for (let i = 0; i < upper; i++) {
    sum += nets[i];
  }
  return sum;
}

/**
 * Per-segment Uniswap v3 swap math at constant L. The pool's sqrt price moves
 * from `segStart` to `segEnd` while staked liquidity in range is `stakedLiq`.
 *
 *   stakedDelta0 = stakedLiq * (segStart - segEnd) * Q96 / (segStart * segEnd)
 *   stakedDelta1 = stakedLiq * (segEnd - segStart) / Q96
 *
 * Both expressions are signed and direction-agnostic: when sqrt moves UP
 * (segEnd > segStart), token0 leaves the pool (delta0 negative) and token1
 * enters (delta1 positive); the signs flip on a DOWN move. These match the
 * sign convention of `event.params.amount0/amount1` on `CLPool.Swap` (positive
 * = into pool).
 *
 * The L_total of the pool cancels out of the staked-share formula, so callers
 * only need staked-edge state — not a parallel total-liquidity edge map.
 *
 * No-op short-circuits (segStart === segEnd, stakedLiq === 0n) are handled by
 * the caller before invocation to avoid wasted bigint multiplies on the hot
 * path.
 *
 * @param stakedLiq - Staked liquidity active across this segment
 * @param segStart - sqrtPriceX96 at the start of the segment
 * @param segEnd - sqrtPriceX96 at the end of the segment
 * @returns Signed reserve deltas attributable to the staked share over this segment
 */
function segmentStakedReserveDelta(
  stakedLiq: bigint,
  segStart: bigint,
  segEnd: bigint,
): { stakedDelta0: bigint; stakedDelta1: bigint } {
  return {
    stakedDelta0: (stakedLiq * (segStart - segEnd) * Q96) / (segStart * segEnd),
    stakedDelta1: (stakedLiq * (segEnd - segStart)) / Q96,
  };
}

/**
 * Processes tick crossings between oldTick and newTick, returning both the
 * updated `stakedLiquidityInRange` AND the per-segment staked-reserve deltas
 * (`stakedDelta0`, `stakedDelta1`) attributable to the staked share of the
 * swap.
 *
 * Per-segment correctness (the fix for #666):
 *   The pool's sqrt price moves through a sequence of segments separated by
 *   crossed staked-tick edges. Within each segment, staked liquidity is constant
 *   and the staked share's reserve change follows exact Uniswap v3 swap math:
 *     Δ0 = L_staked * (S_start - S_end) * Q96 / (S_start * S_end)
 *     Δ1 = L_staked * (S_end - S_start) / Q96
 *   (signed; UP swap → Δ0 negative, Δ1 positive). The L_total of the pool
 *   cancels in the staked-share formula, which is why no per-pool total-edge
 *   map is needed.
 *
 *   The previous implementation applied the *post-crossing* staked/total ratio
 *   to the entire swap's net deltas. That over- or under-credits positions
 *   that exit (or enter) range mid-swap; over many swaps, those errors
 *   accumulated into the negative `stakedReserve0/1` drift observed on 166 CL
 *   pools (issue #666).
 *
 * Tick-crossing semantics:
 *   - UP   (newTick > oldTick): cross ticks STRICTLY above oldTick, up to and
 *     including newTick. stakedLiq += stakedTickEdgeNets[T] at each crossing.
 *   - DOWN (newTick < oldTick): cross ticks AT OR BELOW oldTick, strictly above
 *     newTick. stakedLiq -= stakedTickEdgeNets[T] at each crossing.
 *   - Single segment (no edges crossed, including oldTick === newTick within a
 *     single tick): one segment from oldSqrt to newSqrt with current stakedLiq.
 *
 * Structural fix for the 20GB OOM (preserved from #650/#653):
 *   - Zero `.get()` or `.getWhere()` calls. Per-edge nets are read from the
 *     in-memory `stakedTickEdgeNets` array carried on the aggregator.
 *   - Total cost per swap: O(log E + K) where E = per-pool edge count and
 *     K = edges actually crossed (typically 0–few).
 *
 * Safety guards:
 *   - `tickSpacing === 0n` (uninitialized pool) → return current stakedLiq,
 *     zero deltas. No sqrt prices to compute against.
 *   - `oldSqrtPriceX96 === 0n` || `newSqrtPriceX96 === 0n` → same. The first
 *     swap that hits a pool whose `sqrtPriceX96` was never set cannot be
 *     attributed; we accept zero deltas rather than divide by zero.
 *   - Out-of-range ticks ([TICK_MIN, TICK_MAX]) are rejected and logged with
 *     a `STAKED_TICK_DRIFT` tag. The bound check runs BEFORE the hasStakes
 *     short-circuit so unstaked-pool corruption is still surfaced.
 *
 * Pure in-memory computation. Uses the Envio `context` ONLY for
 * `context.log.error` — any entity access here would reintroduce the #648 OOM
 * fan-out this function was written to replace.
 *
 * @param chainId - Chain ID (used only for error logging)
 * @param poolAddress - CL pool address (used only for error logging)
 * @param oldTick - Tick before the swap
 * @param newTick - Tick after the swap
 * @param oldSqrtPriceX96 - Pool sqrt price (Q64.96) before the swap
 * @param newSqrtPriceX96 - Pool sqrt price (Q64.96) after the swap (from event.params.sqrtPriceX96)
 * @param tickSpacing - Pool's tick spacing (used only to short-circuit when 0)
 * @param context - Envio handler context — used ONLY for context.log.error;
 *                  must not touch entity APIs (see note above)
 * @param currentStakedLiqInRange - Staked in-range liquidity before the swap.
 *   Kept for signature stability and consulted ONLY on early-exit paths
 *   (out-of-range ticks, uninitialized pool, zero sqrt prices); the normal
 *   walking path seeds itself from `deriveStakedLiquidityInRange(oldTick, ...)`
 *   so the swap heals any prior counter drift (issue #719).
 * @param hasStakes - Whether this pool has ever had a staked position
 * @param stakedTickEdges - Sorted, dedup'd tick edges from the aggregator
 * @param stakedTickEdgeNets - Parallel nets (same index as stakedTickEdges)
 * @returns Updated `stakedLiquidityInRange` and signed per-segment
 *          `stakedDelta0`/`stakedDelta1` (in pool-reserve sign convention:
 *          positive = added to pool, negative = removed)
 */
export function processTickCrossingsForStaked(
  chainId: number,
  poolAddress: string,
  oldTick: bigint,
  newTick: bigint,
  oldSqrtPriceX96: bigint,
  newSqrtPriceX96: bigint,
  tickSpacing: bigint,
  context: handlerContext,
  currentStakedLiqInRange: bigint,
  hasStakes: boolean,
  stakedTickEdges: readonly bigint[],
  stakedTickEdgeNets: readonly bigint[],
): {
  stakedLiquidityInRange: bigint;
  stakedDelta0: bigint;
  stakedDelta1: bigint;
} {
  // Bounds check runs BEFORE the zero-sqrt/tickSpacing bailout so that
  // out-of-range ticks — which indicate upstream correctness bugs (missed
  // Initialize, event ordering, RPC inconsistency) — get surfaced even on
  // uninitialized pools where sqrtPriceX96/tickSpacing are still 0n. Unstaked
  // CL pools are the majority, and silencing the diagnostic on them would
  // mask the signal.
  if (
    oldTick < TICK_MIN ||
    oldTick > TICK_MAX ||
    newTick < TICK_MIN ||
    newTick > TICK_MAX
  ) {
    context.log.error(
      `[STAKED_TICK_DRIFT][processTickCrossingsForStaked] Tick out of Uniswap v3 range for pool ${poolAddress} on chain ${chainId}: oldTick=${oldTick}, newTick=${newTick}. Skipping crossing sweep to avoid runaway loop; stakedLiquidityInRange will be stale on this pool until a subsequent stake/unstake rebuilds it.`,
    );
    return {
      stakedLiquidityInRange: currentStakedLiqInRange,
      stakedDelta0: 0n,
      stakedDelta1: 0n,
    };
  }

  if (tickSpacing === 0n || oldSqrtPriceX96 === 0n || newSqrtPriceX96 === 0n) {
    return {
      stakedLiquidityInRange: currentStakedLiqInRange,
      stakedDelta0: 0n,
      stakedDelta1: 0n,
    };
  }

  // Seed the walker from canonical edge state (issue #719). The cached
  // counter `currentStakedLiqInRange` can drift away from the truth in
  // edge-merge rejection / pre-Initialize / NFPM-between-stake scenarios;
  // re-deriving from edges at oldTick ensures the per-segment attribution
  // and the returned counter both reflect what the staked share actually is.
  let stakedLiq = deriveStakedLiquidityInRange(
    oldTick,
    stakedTickEdges,
    stakedTickEdgeNets,
  );
  let segStart = oldSqrtPriceX96;
  let stakedDelta0 = 0n;
  let stakedDelta1 = 0n;

  // Walk staked-tick edges only when the pool actually has stakes. Unstaked
  // pools (and pools whose stakes have all cancelled) skip the binary search
  // and the per-edge loop entirely — the hot path remains O(1).
  if (hasStakes && stakedTickEdges.length > 0) {
    if (newTick > oldTick) {
      // UP: cross strictly above oldTick, up to and including newTick.
      const startIdx = lowerBound(stakedTickEdges, oldTick + 1n);
      for (let i = startIdx; i < stakedTickEdges.length; i++) {
        const edgeTick = stakedTickEdges[i];
        if (edgeTick > newTick) break;
        const segEnd = sqrtRatioAtTick(edgeTick);
        if (stakedLiq > 0n && segStart !== segEnd) {
          const seg = segmentStakedReserveDelta(stakedLiq, segStart, segEnd);
          stakedDelta0 += seg.stakedDelta0;
          stakedDelta1 += seg.stakedDelta1;
        }
        stakedLiq += stakedTickEdgeNets[i];
        segStart = segEnd;
      }
    } else if (newTick < oldTick) {
      // DOWN: cross at or below oldTick, strictly above newTick.
      const endIdx = lowerBound(stakedTickEdges, oldTick + 1n) - 1;
      for (let i = endIdx; i >= 0; i--) {
        const edgeTick = stakedTickEdges[i];
        if (edgeTick <= newTick) break;
        const segEnd = sqrtRatioAtTick(edgeTick);
        if (stakedLiq > 0n && segStart !== segEnd) {
          const seg = segmentStakedReserveDelta(stakedLiq, segStart, segEnd);
          stakedDelta0 += seg.stakedDelta0;
          stakedDelta1 += seg.stakedDelta1;
        }
        stakedLiq -= stakedTickEdgeNets[i];
        segStart = segEnd;
      }
    }
  }

  // Final segment: from the last crossed edge (or oldSqrt if none) to newSqrt.
  // Also covers the within-a-tick case (oldTick === newTick) where no edges
  // are walked and the entire swap is a single segment.
  if (stakedLiq > 0n && segStart !== newSqrtPriceX96) {
    const seg = segmentStakedReserveDelta(stakedLiq, segStart, newSqrtPriceX96);
    stakedDelta0 += seg.stakedDelta0;
    stakedDelta1 += seg.stakedDelta1;
  }

  return {
    stakedLiquidityInRange: stakedLiq,
    stakedDelta0,
    stakedDelta1,
  };
}
