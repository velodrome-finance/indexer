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
 * BigInt division rounded half-away-from-zero (#771).
 *
 * JavaScript BigInt `/` truncates toward zero, which is asymmetric on signed
 * values: 5n/2n is 2n, -5n/2n is -2n, both losing 0.5 of magnitude. Over many
 * tick-crossing segments per swap the per-segment truncation accumulates as a
 * random walk in `stakedReserve0/1`, eventually pushing the field wei-scale
 * negative. Rounding half-away-from-zero removes the per-segment systematic
 * bias so the residual error has mean 0 (CLT bound, not linear-in-N).
 *
 * Denominator must be strictly positive — the only callers pass `Q96` or
 * `segStart * segEnd`, both unconditionally positive by Uniswap v3
 * construction.
 *
 * @param numerator - Signed BigInt numerator
 * @param denominator - Strictly positive BigInt denominator
 * @returns numerator/denominator rounded half-away-from-zero
 */
export function divRoundNearest(
  numerator: bigint,
  denominator: bigint,
): bigint {
  const halfDenom = denominator / 2n;
  if (numerator >= 0n) {
    return (numerator + halfDenom) / denominator;
  }
  return (numerator - halfDenom) / denominator;
}

/**
 * Wraps `TickMath.getSqrtRatioAtTick` to return a bigint instead of JSBI.
 * Tick is clamped to the Uniswap v3 valid range upstream by every caller
 * (`processTickCrossings` runs the bound check before the loop;
 * edges in `stakedTickEdges` are enforced in-range by `applyPositionToEdges`),
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

  // Not present — insert. The caller (applyPositionToEdges) already
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
 * Reason tag emitted by `applyPositionToEdges` when it refuses to apply a
 * position. Callers use this to log the anomaly while still receiving valid
 * (unchanged) arrays to assign into the aggregator diff.
 *   - "ticks_out_of_range": at least one tick is outside [TICK_MIN, TICK_MAX].
 *     Indicates upstream state corruption (bad NFPM event, ordering bug, etc.).
 *   - "degenerate_range": tickLower >= tickUpper. Should never happen for a
 *     valid Uniswap v3 position; indicates bad upstream data.
 * `liquidityDelta === 0n` is a legitimate no-op (e.g., the Mint-0 case from
 * NFPM) and does NOT produce a rejection tag.
 */
export type EdgesRejection = "ticks_out_of_range" | "degenerate_range";

/**
 * Applies a position's liquidity change ([tickLower, tickUpper] × liquidityDelta)
 * to a parallel (edges, nets) tick map. Used for both the staked-only map
 * (stake/unstake, #666/#719) and the pool's total map (CLPool Mint/Burn, #803).
 * In-aggregator only — the swap path never needs to load a per-tick entity.
 *
 * Convention (mirrors Uniswap v3 per-tick liquidityNet):
 *   - At tickLower: net += liquidityDelta  (positions ENTER range on upward cross)
 *   - At tickUpper: net -= liquidityDelta  (positions EXIT range on upward cross)
 *
 * liquidityDelta is positive when liquidity is added (stake, Mint) and negative
 * when removed (unstake, Burn).
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
export function applyPositionToEdges(
  edges: readonly bigint[],
  nets: readonly bigint[],
  tickLower: bigint,
  tickUpper: bigint,
  liquidityDelta: bigint,
): { edges: bigint[]; nets: bigint[]; rejected?: EdgesRejection } {
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
 * Derives in-range liquidity from the canonical edge state at a given tick —
 * replaces the running counter that drifted in issue #719. Used for both the
 * staked map (deriving `stakedLiquidityInRange`) and the pool's total map
 * (seeding the #803 swap-geometry walk).
 *
 *   liquidityInRange = Σ nets[i]  where edges[i] <= currentTick
 *
 * Equivalent to the Uniswap v3 liquidityNet sum across all ticks the pool has
 * crossed going up. Uses the same upper-exclusive convention as
 * `isPositionInRange` (a position with tickUpper === currentTick is OUT of
 * range, so its net at tickUpper is included and cancels its tickLower entry).
 *
 * Cost: O(log E + K) — binary-search the upper bound, then sum the prefix.
 * For per-pool edge counts up to a few thousand the prefix scan is a handful
 * of microseconds; cheap enough to invoke on every edge-map write so the
 * cached counter cannot drift from the edge truth.
 *
 * @param currentTick - The pool's current tick
 * @param edges - Sorted-ascending tick edges from the aggregator
 * @param nets - Parallel tick-edge nets (same length, same index)
 * @returns Σ nets[i] for edges[i] <= currentTick; 0n on empty edge list
 */
export function deriveLiquidityInRange(
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
 * from `segStart` to `segEnd` while in-range liquidity is `liq`.
 *
 *   delta0 = liq * (segStart - segEnd) * Q96 / (segStart * segEnd)
 *   delta1 = liq * (segEnd - segStart) / Q96
 *
 * Both expressions are signed and direction-agnostic: when sqrt moves UP
 * (segEnd > segStart), token0 leaves the pool (delta0 negative) and token1
 * enters (delta1 positive); the signs flip on a DOWN move. These match the
 * sign convention of `event.params.amount0/amount1` on `CLPool.Swap` (positive
 * = into pool).
 *
 * For the staked share the pool's L_total cancels out of the formula, so the
 * staked caller passes only its staked in-range liquidity (no total-edge map);
 * the total caller (#803) passes the pool's full in-range liquidity directly.
 *
 * No-op short-circuits (segStart === segEnd, liq === 0n) are handled by the
 * caller before invocation to avoid wasted bigint multiplies on the hot path.
 *
 * Per-segment rounding uses `divRoundNearest` (half-away-from-zero) rather
 * than BigInt's default truncation-toward-zero. Truncation is asymmetric on
 * signed numerators — within a single swap every segment's numerator has the
 * same sign, so per-segment errors all bias the accumulated reserve in one
 * direction and the random walk grows wei-scale across many swaps.
 * Half-away-from-zero rounding zeroes the per-segment systematic bias (#771).
 *
 * @param liq - In-range liquidity active across this segment
 * @param segStart - sqrtPriceX96 at the start of the segment
 * @param segEnd - sqrtPriceX96 at the end of the segment
 * @returns Signed per-segment reserve deltas (delta0, delta1)
 */
export function segmentReserveDelta(
  liq: bigint,
  segStart: bigint,
  segEnd: bigint,
): { delta0: bigint; delta1: bigint } {
  return {
    delta0: divRoundNearest(liq * (segStart - segEnd) * Q96, segStart * segEnd),
    delta1: divRoundNearest(liq * (segEnd - segStart), Q96),
  };
}

/**
 * Walks the pool's tick crossings between oldTick and newTick over a supplied
 * per-tick liquidity map, returning the updated in-range liquidity AND the
 * signed per-segment reserve deltas (`delta0`, `delta1`).
 *
 * The same walk serves two reserve computations over different edge maps: the
 * staked share (#666/#719), over the staked-only edge map; and the total
 * reserve (#803), over the pool's full edge map. The math is identical — only
 * the (edges, nets) map, the seed, and the `callerLabel` differ.
 *
 * Per-segment correctness (the fix for #666):
 *   The pool's sqrt price moves through a sequence of segments separated by
 *   crossed tick edges. Within each segment, in-range liquidity is constant and
 *   the reserve change follows exact Uniswap v3 swap math:
 *     Δ0 = L * (S_start - S_end) * Q96 / (S_start * S_end)
 *     Δ1 = L * (S_end - S_start) / Q96
 *   (signed; UP swap → Δ0 negative, Δ1 positive). For the staked share L_total
 *   cancels in the formula, which is why the staked caller needs no total-edge
 *   map; the total caller passes the full map directly.
 *
 *   The previous staked implementation applied the *post-crossing* staked/total
 *   ratio to the entire swap's net deltas. That over- or under-credits positions
 *   that exit (or enter) range mid-swap; over many swaps, those errors
 *   accumulated into the negative `stakedReserve0/1` drift observed on 166 CL
 *   pools (issue #666).
 *
 * Tick-crossing semantics:
 *   - UP   (newTick > oldTick): cross ticks STRICTLY above oldTick, up to and
 *     including newTick. liq += tickEdgeNets[T] at each crossing.
 *   - DOWN (newTick < oldTick): cross ticks AT OR BELOW oldTick, strictly above
 *     newTick. liq -= tickEdgeNets[T] at each crossing.
 *   - Single segment (no edges crossed, including oldTick === newTick within a
 *     single tick): one segment from oldSqrt to newSqrt with current liq.
 *
 * Structural fix for the 20GB OOM (preserved from #650/#653):
 *   - Zero `.get()` or `.getWhere()` calls. Per-edge nets are read from the
 *     in-memory `tickEdgeNets` array carried on the aggregator.
 *   - Total cost per swap: O(log E + K) where E = per-pool edge count and
 *     K = edges actually crossed (typically 0–few).
 *
 * Safety guards:
 *   - `tickSpacing === 0n` (uninitialized pool) → return current liquidity,
 *     zero deltas. No sqrt prices to compute against.
 *   - `oldSqrtPriceX96 === 0n` || `newSqrtPriceX96 === 0n` → same. The first
 *     swap that hits a pool whose `sqrtPriceX96` was never set cannot be
 *     attributed; we accept zero deltas rather than divide by zero.
 *   - Out-of-range ticks ([TICK_MIN, TICK_MAX]) are rejected and logged with
 *     a `STAKED_TICK_DRIFT` tag. The bound check runs BEFORE the walkEdges
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
 * @param currentLiquidityInRange - In-range liquidity before the swap. Kept for
 *   signature stability and consulted ONLY on early-exit paths (out-of-range
 *   ticks, uninitialized pool, zero sqrt prices); the normal walking path seeds
 *   itself from `deriveLiquidityInRange(oldTick, ...)` so the swap heals
 *   any prior counter drift (issue #719).
 * @param walkEdges - Whether to cross intermediate edges. Pass `hasStakes` for
 *   the staked map, `tickEdges.length > 0` for the total map. When false, only
 *   the single final segment runs.
 * @param tickEdges - Sorted, dedup'd tick edges from the aggregator
 * @param tickEdgeNets - Parallel nets (same index as tickEdges)
 * @param callerLabel - Diagnostic tag for the out-of-range log so the staked
 *   (#666/#719) and total-reserve (#803) reuses of this walk are
 *   distinguishable. Defaults to "staked" to keep the staked callsite and the
 *   log string stable.
 * @returns Updated in-range liquidity and signed per-segment `delta0`/`delta1`
 *          (pool-reserve sign convention: positive = added, negative = removed)
 */
export function processTickCrossings(
  chainId: number,
  poolAddress: string,
  oldTick: bigint,
  newTick: bigint,
  oldSqrtPriceX96: bigint,
  newSqrtPriceX96: bigint,
  tickSpacing: bigint,
  context: handlerContext,
  currentLiquidityInRange: bigint,
  walkEdges: boolean,
  tickEdges: readonly bigint[],
  tickEdgeNets: readonly bigint[],
  callerLabel = "staked",
): {
  liquidityInRange: bigint;
  delta0: bigint;
  delta1: bigint;
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
      `[STAKED_TICK_DRIFT][processTickCrossings:${callerLabel}] Tick out of Uniswap v3 range for pool ${poolAddress} on chain ${chainId}: oldTick=${oldTick}, newTick=${newTick}. Skipping crossing sweep to avoid runaway loop; in-range liquidity will be stale on this pool until a subsequent stake/unstake rebuilds it.`,
    );
    return {
      liquidityInRange: currentLiquidityInRange,
      delta0: 0n,
      delta1: 0n,
    };
  }

  if (tickSpacing === 0n || oldSqrtPriceX96 === 0n || newSqrtPriceX96 === 0n) {
    return {
      liquidityInRange: currentLiquidityInRange,
      delta0: 0n,
      delta1: 0n,
    };
  }

  // Seed the walker from canonical edge state (issue #719). The cached
  // counter `currentLiquidityInRange` can drift away from the truth in
  // edge-merge rejection / pre-Initialize / NFPM-between-stake scenarios;
  // re-deriving from edges at oldTick ensures the per-segment attribution
  // and the returned counter both reflect what the in-range liquidity actually is.
  let liq = deriveLiquidityInRange(oldTick, tickEdges, tickEdgeNets);
  let segStart = oldSqrtPriceX96;
  let delta0 = 0n;
  let delta1 = 0n;

  // Walk tick edges only when requested (staked map: pool has stakes; total
  // map: edge list non-empty). Otherwise skip the binary search and the
  // per-edge loop entirely — the hot path remains O(1).
  if (walkEdges && tickEdges.length > 0) {
    if (newTick > oldTick) {
      // UP: cross strictly above oldTick, up to and including newTick.
      const startIdx = lowerBound(tickEdges, oldTick + 1n);
      for (let i = startIdx; i < tickEdges.length; i++) {
        const edgeTick = tickEdges[i];
        if (edgeTick > newTick) break;
        const segEnd = sqrtRatioAtTick(edgeTick);
        if (liq > 0n && segStart !== segEnd) {
          const seg = segmentReserveDelta(liq, segStart, segEnd);
          delta0 += seg.delta0;
          delta1 += seg.delta1;
        }
        liq += tickEdgeNets[i];
        segStart = segEnd;
      }
    } else if (newTick < oldTick) {
      // DOWN: cross at or below oldTick, strictly above newTick.
      const endIdx = lowerBound(tickEdges, oldTick + 1n) - 1;
      for (let i = endIdx; i >= 0; i--) {
        const edgeTick = tickEdges[i];
        if (edgeTick <= newTick) break;
        const segEnd = sqrtRatioAtTick(edgeTick);
        if (liq > 0n && segStart !== segEnd) {
          const seg = segmentReserveDelta(liq, segStart, segEnd);
          delta0 += seg.delta0;
          delta1 += seg.delta1;
        }
        liq -= tickEdgeNets[i];
        segStart = segEnd;
      }
    }
  }

  // Final segment: from the last crossed edge (or oldSqrt if none) to newSqrt.
  // Also covers the within-a-tick case (oldTick === newTick) where no edges
  // are walked and the entire swap is a single segment.
  if (liq > 0n && segStart !== newSqrtPriceX96) {
    const seg = segmentReserveDelta(liq, segStart, newSqrtPriceX96);
    delta0 += seg.delta0;
    delta1 += seg.delta1;
  }

  return {
    liquidityInRange: liq,
    delta0,
    delta1,
  };
}
