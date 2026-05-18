import {
  applyStakedPositionToEdges,
  deriveStakedLiquidityInRange,
  isPositionInRange,
  processTickCrossingsForStaked,
} from "../../src/Aggregators/CLStakedLiquidity";
import type { handlerContext } from "../../src/EntityTypes";
import { calculatePositionAmountsFromLiquidity } from "../../src/Helpers";
import { sqrtAt } from "./common";

describe("CLStakedLiquidity", () => {
  const CHAIN_ID = 8453;
  const POOL_ADDRESS = "0x1234567890123456789012345678901234567890";
  // Non-zero sqrt placeholders for tests that don't exercise delta math —
  // the function early-returns zero deltas if either sqrt is 0n, so use
  // sqrtAt(0) (= 1*Q96) when the test only cares about stakedLiquidityInRange.
  const SQRT_AT_ZERO = sqrtAt(0n);

  describe("isPositionInRange", () => {
    it("should return true when currentTick is within range", () => {
      expect(isPositionInRange(100n, 200n, 150n)).toBe(true);
    });

    it("should return true when currentTick equals tickLower (inclusive)", () => {
      expect(isPositionInRange(100n, 200n, 100n)).toBe(true);
    });

    it("should return false when currentTick equals tickUpper (exclusive)", () => {
      expect(isPositionInRange(100n, 200n, 200n)).toBe(false);
    });

    it("should return false when currentTick is below tickLower", () => {
      expect(isPositionInRange(100n, 200n, 50n)).toBe(false);
    });

    it("should return false when currentTick is above tickUpper", () => {
      expect(isPositionInRange(100n, 200n, 300n)).toBe(false);
    });

    it("should handle negative tick values", () => {
      expect(isPositionInRange(-200n, -100n, -150n)).toBe(true);
      expect(isPositionInRange(-200n, -100n, -200n)).toBe(true);
      expect(isPositionInRange(-200n, -100n, -100n)).toBe(false);
      expect(isPositionInRange(-200n, -100n, -250n)).toBe(false);
    });

    it("should handle range spanning zero", () => {
      expect(isPositionInRange(-100n, 100n, 0n)).toBe(true);
      expect(isPositionInRange(-100n, 100n, -100n)).toBe(true);
      expect(isPositionInRange(-100n, 100n, 100n)).toBe(false);
    });

    it("should handle single-tick range (tickLower = tickUpper - 1)", () => {
      expect(isPositionInRange(99n, 100n, 99n)).toBe(true);
      expect(isPositionInRange(99n, 100n, 100n)).toBe(false);
    });
  });

  describe("applyStakedPositionToEdges", () => {
    it("should insert both edges with correct signs on stake", () => {
      const { edges, nets } = applyStakedPositionToEdges(
        [],
        [],
        100n,
        200n,
        500n,
      );
      expect(edges).toEqual([100n, 200n]);
      expect(nets).toEqual([500n, -500n]);
    });

    it("should keep the list sorted when inserting into the middle", () => {
      // Start with an existing position at [0, 400]
      const start = applyStakedPositionToEdges([], [], 0n, 400n, 100n);
      // Insert a nested position at [100, 300]
      const { edges, nets } = applyStakedPositionToEdges(
        start.edges,
        start.nets,
        100n,
        300n,
        50n,
      );
      expect(edges).toEqual([0n, 100n, 300n, 400n]);
      expect(nets).toEqual([100n, 50n, -50n, -100n]);
    });

    it("should sum nets when two positions share an edge", () => {
      const a = applyStakedPositionToEdges([], [], 100n, 200n, 500n);
      const b = applyStakedPositionToEdges(a.edges, a.nets, 100n, 300n, 200n);
      // tickLower=100 contributes +500 (A) + +200 (B) = +700
      // tickUpper=200 is only A: -500
      // tickUpper=300 is only B: -200
      expect(b.edges).toEqual([100n, 200n, 300n]);
      expect(b.nets).toEqual([700n, -500n, -200n]);
    });

    it("should drop an edge when its net becomes zero", () => {
      // Stake then unstake the same position
      const a = applyStakedPositionToEdges([], [], 100n, 200n, 500n);
      const b = applyStakedPositionToEdges(a.edges, a.nets, 100n, 200n, -500n);
      expect(b.edges).toEqual([]);
      expect(b.nets).toEqual([]);
    });

    it("should keep non-zero edges when a partial unstake leaves residual net", () => {
      // Two positions sharing tickLower=100
      const a = applyStakedPositionToEdges([], [], 100n, 200n, 500n);
      const b = applyStakedPositionToEdges(a.edges, a.nets, 100n, 300n, 200n);
      // Unstake only one of them
      const c = applyStakedPositionToEdges(b.edges, b.nets, 100n, 200n, -500n);
      // tickLower=100: +700 - 500 = +200
      // tickUpper=200: -500 + 500 = 0 → dropped
      // tickUpper=300: -200 (unchanged)
      expect(c.edges).toEqual([100n, 300n]);
      expect(c.nets).toEqual([200n, -200n]);
    });

    it("should ignore out-of-range ticks and tag them 'ticks_out_of_range'", () => {
      const result = applyStakedPositionToEdges(
        [],
        [],
        -900000n, // below TICK_MIN
        100n,
        500n,
      );
      expect(result.edges).toEqual([]);
      expect(result.nets).toEqual([]);
      expect(result.rejected).toBe("ticks_out_of_range");
    });

    it("should ignore degenerate ranges and tag them 'degenerate_range'", () => {
      const result = applyStakedPositionToEdges([], [], 200n, 100n, 500n);
      expect(result.edges).toEqual([]);
      expect(result.nets).toEqual([]);
      expect(result.rejected).toBe("degenerate_range");
    });

    it("should silently no-op on liquidityDelta=0 without a rejection tag", () => {
      // Zero-delta is a legitimate NFPM Mint-0 flow, not an invariant violation.
      // It must NOT log/alert — the caller treats `rejected: undefined` as success.
      const seed = applyStakedPositionToEdges([], [], 100n, 200n, 500n);
      const result = applyStakedPositionToEdges(
        seed.edges,
        seed.nets,
        100n,
        200n,
        0n,
      );
      expect(result.edges).toEqual([100n, 200n]);
      expect(result.nets).toEqual([500n, -500n]);
      expect(result.rejected).toBeUndefined();
    });

    it("should preserve negative residual nets (upper-tick side + partial overlap)", () => {
      // Uniswap v3 semantics: at a tickUpper the net is -liquidity (negative).
      // When two positions share a tick where one uses it as tickUpper and the
      // other as tickLower, the residual can remain negative but non-zero.
      // Invariant under test: the edge MUST be preserved (not dropped just because
      // the net is negative) and the sort order MUST hold.
      const a = applyStakedPositionToEdges([], [], 100n, 200n, 500n);
      expect(a.edges).toEqual([100n, 200n]);
      expect(a.nets).toEqual([500n, -500n]);

      // Second position uses 200 as tickLower, stacking onto the existing -500 net.
      const b = applyStakedPositionToEdges(a.edges, a.nets, 200n, 300n, 300n);
      // tickLower=100: +500 (A)
      // tickLower=200 from B adds +300 onto -500 (A's upper) = -200 (residual NEGATIVE, not dropped)
      // tickUpper=300 from B: -300
      expect(b.edges).toEqual([100n, 200n, 300n]);
      expect(b.nets).toEqual([500n, -200n, -300n]);
      expect(b.rejected).toBeUndefined();

      // Sanity: sum of nets must still be zero (invariant for a balanced stake set).
      const totalNet = b.nets.reduce((acc, n) => acc + n, 0n);
      expect(totalNet).toBe(0n);

      // Swap cross-check: the in-aggregator walker applied across the full
      // range must see the same answer as summing the negative residuals.
      // Going up from -inf to +inf, stakedLiq delta = 500 + -200 + -300 = 0.
      // This is the "closed system" property — all stakes cancel end-to-end.
    });

    it("should round-trip a stake then unstake back to an empty edge list", () => {
      // Even with negative residuals in flight, a full unstake must return to
      // an empty edge list (no orphaned nets, no zombie edges).
      let edges: readonly bigint[] = [];
      let nets: readonly bigint[] = [];
      const positions = [
        { tl: 100n, tu: 200n, liq: 500n },
        { tl: 200n, tu: 300n, liq: 300n },
        { tl: 150n, tu: 250n, liq: 700n },
      ];
      for (const p of positions) {
        const out = applyStakedPositionToEdges(edges, nets, p.tl, p.tu, p.liq);
        edges = out.edges;
        nets = out.nets;
      }
      expect(edges.length).toBeGreaterThan(0);
      // Unstake each in reverse order
      for (const p of positions.slice().reverse()) {
        const out = applyStakedPositionToEdges(edges, nets, p.tl, p.tu, -p.liq);
        edges = out.edges;
        nets = out.nets;
      }
      expect(edges).toEqual([]);
      expect(nets).toEqual([]);
    });

    it("should not mutate the input arrays", () => {
      const input = applyStakedPositionToEdges([], [], 100n, 200n, 500n);
      const frozenEdges = Object.freeze([...input.edges]);
      const frozenNets = Object.freeze([...input.nets]);
      applyStakedPositionToEdges(frozenEdges, frozenNets, 300n, 400n, 100n);
      // Freeze throws on mutation; absence of throw proves no mutation happened.
      expect(frozenEdges).toEqual([100n, 200n]);
      expect(frozenNets).toEqual([500n, -500n]);
    });

    it("should stay monotone after many interleaved stake/unstake events", () => {
      let edges: readonly bigint[] = [];
      let nets: readonly bigint[] = [];
      const positions: { tl: bigint; tu: bigint; liq: bigint }[] = [];
      for (let i = 0; i < 50; i++) {
        const tl = BigInt(i * 10);
        const tu = BigInt(i * 10 + 50);
        const liq = BigInt(100 + i);
        positions.push({ tl, tu, liq });
        const out = applyStakedPositionToEdges(edges, nets, tl, tu, liq);
        edges = out.edges;
        nets = out.nets;
        // Monotone check after every event
        for (let k = 1; k < edges.length; k++) {
          expect(edges[k]).toBeGreaterThan(edges[k - 1]);
        }
      }
      // Unstake half of them
      for (let i = 0; i < 25; i++) {
        const p = positions[i * 2];
        const out = applyStakedPositionToEdges(edges, nets, p.tl, p.tu, -p.liq);
        edges = out.edges;
        nets = out.nets;
        for (let k = 1; k < edges.length; k++) {
          expect(edges[k]).toBeGreaterThan(edges[k - 1]);
        }
      }
      expect(edges.length).toBeGreaterThan(0);
    });
  });

  describe("processTickCrossingsForStaked", () => {
    let mockContext: handlerContext;
    let logErrorSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      logErrorSpy = vi.fn();
      mockContext = {
        log: {
          error: logErrorSpy,
          warn: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
        },
      } as unknown as handlerContext;
    });

    it("should derive the in-range counter from edges when oldTick === newTick", async () => {
      // Even with no movement, the function re-derives stakedLiquidityInRange
      // from edge state (issue #719): the cached `currentStakedLiqInRange`
      // input is ignored on the normal path so prior drift heals on the next
      // touch. Here edges=[100, 200] with nets=[300, -300] and oldTick=100
      // ⇒ derive(100) = 300 (the tickLower at 100 is in-range, tickUpper at
      // 200 has not been crossed yet). The 500n input is intentionally stale.
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        100n,
        sqrtAt(100n),
        sqrtAt(100n),
        200n,
        mockContext,
        500n,
        true,
        [100n, 200n],
        [300n, -300n],
      );
      expect(result.stakedLiquidityInRange).toBe(300n);
      // Same sqrt → final segment is a no-op → zero deltas
      expect(result.stakedDelta0).toBe(0n);
      expect(result.stakedDelta1).toBe(0n);
    });

    it("should return unchanged when tickSpacing is zero", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        300n,
        sqrtAt(100n),
        sqrtAt(300n),
        0n,
        mockContext,
        500n,
        true,
        [200n],
        [300n],
      );
      expect(result.stakedLiquidityInRange).toBe(500n);
      expect(result.stakedDelta0).toBe(0n);
      expect(result.stakedDelta1).toBe(0n);
    });

    it("should return unchanged when oldSqrtPriceX96 is zero (pre-Initialize)", async () => {
      // First swap on a pool whose sqrtPriceX96 was never set: cannot attribute,
      // accept zero deltas rather than divide by zero.
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        300n,
        0n,
        sqrtAt(300n),
        200n,
        mockContext,
        500n,
        true,
        [200n],
        [300n],
      );
      expect(result.stakedLiquidityInRange).toBe(500n);
      expect(result.stakedDelta0).toBe(0n);
      expect(result.stakedDelta1).toBe(0n);
    });

    it("should add stakedLiquidityNet when crossing up", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        250n,
        sqrtAt(100n),
        sqrtAt(250n),
        200n,
        mockContext,
        0n,
        true,
        [200n],
        [300n],
      );
      expect(result.stakedLiquidityInRange).toBe(300n);
    });

    it("should subtract stakedLiquidityNet when crossing down", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        250n,
        100n,
        sqrtAt(250n),
        sqrtAt(100n),
        200n,
        mockContext,
        300n,
        true,
        [200n],
        [300n],
      );
      expect(result.stakedLiquidityInRange).toBe(0n);
    });

    it("should handle multiple tick crossings going up", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        650n,
        sqrtAt(100n),
        sqrtAt(650n),
        200n,
        mockContext,
        0n,
        true,
        [200n, 400n, 600n],
        [100n, 200n, -50n],
      );
      expect(result.stakedLiquidityInRange).toBe(250n); // 0 + 100 + 200 - 50
    });

    it("should handle multiple tick crossings going down", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        650n,
        100n,
        sqrtAt(650n),
        sqrtAt(100n),
        200n,
        mockContext,
        250n,
        true,
        [200n, 400n, 600n],
        [100n, 200n, -50n],
      );
      // 250 - (-50) - 200 - 100 = 250 + 50 - 200 - 100 = 0
      expect(result.stakedLiquidityInRange).toBe(0n);
    });

    it("should skip edges that fall outside the [oldTick, newTick] window", async () => {
      // Edges exist at 200 and 400, but swap only crosses 200.
      // derive(oldTick=100) = 0 (no edges <= 100); walker adds nets[200]=150
      // crossing strictly above oldTick up to newTick=300 (400 is beyond).
      // The 50n input is stale and ignored on the normal path (issue #719).
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        300n,
        sqrtAt(100n),
        sqrtAt(300n),
        200n,
        mockContext,
        50n,
        true,
        [200n, 400n],
        [150n, -150n],
      );
      expect(result.stakedLiquidityInRange).toBe(150n); // derive(100)=0 + 150
    });

    it("should handle negative tick ranges", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        -300n,
        -100n,
        sqrtAt(-300n),
        sqrtAt(-100n),
        200n,
        mockContext,
        0n,
        true,
        [-200n],
        [500n],
      );
      expect(result.stakedLiquidityInRange).toBe(500n);
    });

    it("should not cross the oldTick itself when going up (strict-above semantics)", async () => {
      // oldTick=200, edge at 200 — since we search lowerBound(201), edge is
      // skipped. derive(200) on edges=[200],nets=[100] returns 100 (the
      // tickLower at 200 is in-range by the upper-exclusive convention), so
      // the walker starts at 100 and crosses no further edges. The seed `0n`
      // input is stale and ignored on the normal path (issue #719).
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        200n,
        350n,
        sqrtAt(200n),
        sqrtAt(350n),
        200n,
        mockContext,
        0n,
        true,
        [200n],
        [100n],
      );
      expect(result.stakedLiquidityInRange).toBe(100n);
    });

    it("should include the oldTick boundary when going down (at-or-below semantics)", async () => {
      // oldTick=200, edge at 200 — going down includes it
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        200n,
        50n,
        sqrtAt(200n),
        sqrtAt(50n),
        200n,
        mockContext,
        100n,
        true,
        [200n],
        [100n],
      );
      expect(result.stakedLiquidityInRange).toBe(0n); // 100 - 100
    });

    it("should handle tickSpacing of 1 without scanning per-tick (only edges drive the walk)", async () => {
      // Edges 101/102/103; spacing=1 means the old impl would sweep per-tick,
      // but the new impl only visits the edges that exist.
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        103n,
        sqrtAt(100n),
        sqrtAt(103n),
        1n,
        mockContext,
        0n,
        true,
        [101n, 102n, 103n],
        [10n, 20n, -5n],
      );
      expect(result.stakedLiquidityInRange).toBe(25n); // 0 + 10 + 20 - 5
    });

    describe("safety guards", () => {
      it("should short-circuit when hasStakes is false", async () => {
        // Precondition: hasStakes=false ⇒ pool has never had a staked position,
        // so currentStakedLiqInRange MUST be 0n. Seed 0n to reflect that and
        // assert zero deltas — non-zero L would let the final-segment fallback
        // emit attribution despite the edge loop being skipped.
        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          100n,
          250n,
          sqrtAt(100n),
          sqrtAt(250n),
          200n,
          mockContext,
          0n,
          false,
          [200n],
          [999n],
        );
        expect(result.stakedLiquidityInRange).toBe(0n);
        expect(result.stakedDelta0).toBe(0n);
        expect(result.stakedDelta1).toBe(0n);
      });

      it("should short-circuit when the edge list is empty (no staked positions)", async () => {
        // Precondition: empty edge list ⇒ no active staked positions ⇒
        // currentStakedLiqInRange MUST be 0n. Same reasoning as above.
        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          100n,
          250n,
          sqrtAt(100n),
          sqrtAt(250n),
          200n,
          mockContext,
          0n,
          true, // latch true but no edges
          [],
          [],
        );
        expect(result.stakedLiquidityInRange).toBe(0n);
        expect(result.stakedDelta0).toBe(0n);
        expect(result.stakedDelta1).toBe(0n);
      });

      it("should bail and log when oldTick is below TICK_MIN", async () => {
        // oldTick out of range — pass dummy non-zero sqrt placeholders since
        // sqrtAt(out-of-range) would throw before we even reach the function.
        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          -900000n,
          100n,
          SQRT_AT_ZERO,
          sqrtAt(100n),
          200n,
          mockContext,
          500n,
          true,
          [200n],
          [300n],
        );
        expect(result.stakedLiquidityInRange).toBe(500n);
        expect(result.stakedDelta0).toBe(0n);
        expect(result.stakedDelta1).toBe(0n);
        expect(logErrorSpy).toHaveBeenCalledTimes(1);
        expect(logErrorSpy.mock.calls[0][0]).toContain(
          "out of Uniswap v3 range",
        );
      });

      it("should bail and log when newTick is above TICK_MAX", async () => {
        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          100n,
          900000n,
          sqrtAt(100n),
          SQRT_AT_ZERO,
          200n,
          mockContext,
          500n,
          true,
          [200n],
          [300n],
        );
        expect(result.stakedLiquidityInRange).toBe(500n);
        expect(logErrorSpy).toHaveBeenCalledTimes(1);
      });

      it("should accept boundary ticks at exactly TICK_MIN and TICK_MAX", async () => {
        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          -887272n,
          887272n,
          sqrtAt(-887272n),
          sqrtAt(887272n),
          200n,
          mockContext,
          0n,
          true,
          [],
          [],
        );
        expect(result.stakedLiquidityInRange).toBe(0n);
        expect(logErrorSpy).not.toHaveBeenCalled();
      });
    });

    describe("per-segment reserve delta attribution (#666 fix)", () => {
      it("returns zero deltas when stakedLiq is zero throughout the swap", () => {
        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          100n,
          300n,
          sqrtAt(100n),
          sqrtAt(300n),
          200n,
          mockContext,
          0n, // no staked liq
          false,
          [],
          [],
        );
        expect(result.stakedDelta0).toBe(0n);
        expect(result.stakedDelta1).toBe(0n);
      });

      it("matches calculatePositionAmountsFromLiquidity diff for an in-range single-segment swap", () => {
        // Single staked position [-100, 100] with liquidity L; swap from tick=0
        // to tick=50 (both in range, no edge crossings since neither bound is
        // crossed). The function's delta MUST equal the position-amount diff
        // produced by the canonical helper at the two prices — that is the
        // ground truth for what the staked share lost or gained.
        const L = 10n ** 18n;
        const tickLower = -100n;
        const tickUpper = 100n;
        const oldTick = 0n;
        const newTick = 50n;
        const oldSqrt = sqrtAt(oldTick);
        const newSqrt = sqrtAt(newTick);

        // Edges from a single staked position: [tL: +L, tU: -L]
        const edges = [tickLower, tickUpper];
        const nets = [L, -L];

        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          oldTick,
          newTick,
          oldSqrt,
          newSqrt,
          1n,
          mockContext,
          L,
          true,
          edges,
          nets,
        );

        expect(result.stakedLiquidityInRange).toBe(L);

        const before = calculatePositionAmountsFromLiquidity(
          L,
          oldSqrt,
          tickLower,
          tickUpper,
        );
        const after = calculatePositionAmountsFromLiquidity(
          L,
          newSqrt,
          tickLower,
          tickUpper,
        );
        // Pool reserve sign convention: positive = into pool. amount0 in pool
        // decreases as price moves up; amount1 increases. The helper returns
        // *in-pool* positives, so the signed delta is `after - before`.
        const expectedDelta0 = after.amount0 - before.amount0;
        const expectedDelta1 = after.amount1 - before.amount1;
        // Bigint truncation may differ by ≤1 wei vs the source helper.
        expect(result.stakedDelta0 - expectedDelta0).toBeGreaterThanOrEqual(
          -1n,
        );
        expect(result.stakedDelta0 - expectedDelta0).toBeLessThanOrEqual(1n);
        expect(result.stakedDelta1 - expectedDelta1).toBeGreaterThanOrEqual(
          -1n,
        );
        expect(result.stakedDelta1 - expectedDelta1).toBeLessThanOrEqual(1n);
      });

      it("attributes nothing past the boundary when the position exits range mid-swap", () => {
        // Position [-100, 100], L; swap drives the price DOWN from tick=50 to
        // tick=-200, crossing the lower edge at -100. After the cross, staked
        // liquidity in range drops to 0 — no further attribution should accrue.
        // This is the exact failure mode behind #666: the old proportional
        // split kept attributing post-crossing reserve flow to a position that
        // had already exited.
        const L = 10n ** 18n;
        const tickLower = -100n;
        const tickUpper = 100n;
        const oldTick = 50n;
        const newTick = -200n;
        const oldSqrt = sqrtAt(oldTick);
        const newSqrt = sqrtAt(newTick);
        const sqrtAtLower = sqrtAt(tickLower);

        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          oldTick,
          newTick,
          oldSqrt,
          newSqrt,
          1n,
          mockContext,
          L,
          true,
          [tickLower, tickUpper],
          [L, -L],
        );

        // Position fully exited going down → stakedLiq drops to 0
        expect(result.stakedLiquidityInRange).toBe(0n);

        // Expected delta = single segment from oldSqrt down to sqrtAtLower
        // with L active. Nothing attributed past the boundary.
        const before = calculatePositionAmountsFromLiquidity(
          L,
          oldSqrt,
          tickLower,
          tickUpper,
        );
        const atBoundary = calculatePositionAmountsFromLiquidity(
          L,
          sqrtAtLower,
          tickLower,
          tickUpper,
        );
        const expectedDelta0 = atBoundary.amount0 - before.amount0;
        const expectedDelta1 = atBoundary.amount1 - before.amount1;
        expect(result.stakedDelta0 - expectedDelta0).toBeGreaterThanOrEqual(
          -1n,
        );
        expect(result.stakedDelta0 - expectedDelta0).toBeLessThanOrEqual(1n);
        expect(result.stakedDelta1 - expectedDelta1).toBeGreaterThanOrEqual(
          -1n,
        );
        expect(result.stakedDelta1 - expectedDelta1).toBeLessThanOrEqual(1n);
      });

      it("telescopes Deposit + swap + Withdraw to ~0 when the position exits range mid-swap (#666 invariant)", () => {
        // The canonical drift scenario: Deposit at in-range tick, swap drives
        // price out of range below, Withdraw at the post-swap (out-of-range)
        // price. The three signed reserve contributions MUST sum to ~0 — the
        // staked share's net reserve change equals 0 because the tokens
        // entered (on Deposit) and left (on Withdraw) the staked envelope.
        // The old proportional split broke this invariant; per-segment math
        // restores it.
        const L = 10n ** 18n;
        const tickLower = -100n;
        const tickUpper = 100n;
        const tickAtDeposit = 50n;
        const tickAfterSwap = -200n;
        const sqrtAtDeposit = sqrtAt(tickAtDeposit);
        const sqrtAfterSwap = sqrtAt(tickAfterSwap);

        // 1) Deposit at sqrtAtDeposit (in range): incrementalStakedReserve =
        //    +position amounts at deposit price.
        const depositAmounts = calculatePositionAmountsFromLiquidity(
          L,
          sqrtAtDeposit,
          tickLower,
          tickUpper,
        );

        // 2) Swap moves price down through the lower edge. Per-segment
        //    attribution credits only the in-range segment.
        const swapResult = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          tickAtDeposit,
          tickAfterSwap,
          sqrtAtDeposit,
          sqrtAfterSwap,
          1n,
          mockContext,
          L,
          true,
          [tickLower, tickUpper],
          [L, -L],
        );

        // 3) Withdraw at sqrtAfterSwap (out of range below): incremental
        //    staked reserve = -position amounts at the post-swap price (all
        //    token0 capacity, zero token1).
        const withdrawAmounts = calculatePositionAmountsFromLiquidity(
          L,
          sqrtAfterSwap,
          tickLower,
          tickUpper,
        );

        const net0 =
          depositAmounts.amount0 +
          swapResult.stakedDelta0 -
          withdrawAmounts.amount0;
        const net1 =
          depositAmounts.amount1 +
          swapResult.stakedDelta1 -
          withdrawAmounts.amount1;

        // Tolerance: a few wei from bigint truncation across the three steps.
        expect(net0).toBeGreaterThanOrEqual(-2n);
        expect(net0).toBeLessThanOrEqual(2n);
        expect(net1).toBeGreaterThanOrEqual(-2n);
        expect(net1).toBeLessThanOrEqual(2n);
      });

      it("telescopes when the position never enters range during the swap", () => {
        // Position [-100, 100], swap moves from tick=200 to tick=300 — entirely
        // above the position's range. stakedLiq is 0 throughout (price never
        // crossed the upper edge from above), so deltas are 0.
        const L = 10n ** 18n;
        const tickLower = -100n;
        const tickUpper = 100n;
        const oldTick = 200n;
        const newTick = 300n;

        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          oldTick,
          newTick,
          sqrtAt(oldTick),
          sqrtAt(newTick),
          1n,
          mockContext,
          0n, // out of range — not staked-in-range
          true,
          [tickLower, tickUpper],
          [L, -L],
        );

        expect(result.stakedLiquidityInRange).toBe(0n);
        expect(result.stakedDelta0).toBe(0n);
        expect(result.stakedDelta1).toBe(0n);
      });

      it("attributes only the in-range segment when the position enters range mid-swap", () => {
        // Position [-100, 100], L; swap drives price UP from tick=-200 to
        // tick=50. Position enters range when price crosses tickLower=-100
        // upward. Pre-cross: stakedLiq=0 → no attribution. Post-cross:
        // stakedLiq=L → attribute the segment from sqrtAt(-100) to sqrtAt(50).
        const L = 10n ** 18n;
        const tickLower = -100n;
        const tickUpper = 100n;
        const oldTick = -200n;
        const newTick = 50n;
        const newSqrt = sqrtAt(newTick);
        const sqrtAtLower = sqrtAt(tickLower);

        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          oldTick,
          newTick,
          sqrtAt(oldTick),
          newSqrt,
          1n,
          mockContext,
          0n, // pre-swap: out of range below → not staked-in-range
          true,
          [tickLower, tickUpper],
          [L, -L],
        );

        expect(result.stakedLiquidityInRange).toBe(L);

        // Expected: single in-range segment from sqrtAt(-100) (boundary cross)
        // up to newSqrt. Equivalent to position-amounts diff at those prices.
        const atBoundary = calculatePositionAmountsFromLiquidity(
          L,
          sqrtAtLower,
          tickLower,
          tickUpper,
        );
        const after = calculatePositionAmountsFromLiquidity(
          L,
          newSqrt,
          tickLower,
          tickUpper,
        );
        const expectedDelta0 = after.amount0 - atBoundary.amount0;
        const expectedDelta1 = after.amount1 - atBoundary.amount1;
        expect(result.stakedDelta0 - expectedDelta0).toBeGreaterThanOrEqual(
          -1n,
        );
        expect(result.stakedDelta0 - expectedDelta0).toBeLessThanOrEqual(1n);
        expect(result.stakedDelta1 - expectedDelta1).toBeGreaterThanOrEqual(
          -1n,
        );
        expect(result.stakedDelta1 - expectedDelta1).toBeLessThanOrEqual(1n);
      });

      it("returns zero deltas when oldSqrt === newSqrt (no movement) regardless of tick", () => {
        // Edge case: tick changed (e.g. via Initialize replay) but sqrt did not.
        // No reserve flow → no attribution.
        const L = 10n ** 18n;
        const sqrt = sqrtAt(0n);
        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          -50n,
          50n,
          sqrt,
          sqrt,
          1n,
          mockContext,
          L,
          true,
          [-100n, 100n],
          [L, -L],
        );
        expect(result.stakedDelta0).toBe(0n);
        expect(result.stakedDelta1).toBe(0n);
      });
    });
  });

  // Regression coverage for issue #719: the structural fix replaces the
  // cached running counter `stakedLiquidityInRange` with derivation from the
  // existing edge state at the current tick. These tests pin the derivation
  // formula:
  //   stakedLiquidityInRange = Σ stakedTickEdgeNets[i] where stakedTickEdges[i] <= currentTick
  // The function must give the same answer the running counter *should* have
  // tracked, but without any of the drift paths the counter exhibited (pre-
  // Initialize deposit, edge-merge rejection, NFPM-mediated liquidity change
  // between gauge deposit and withdraw).
  describe("deriveStakedLiquidityInRange (#719)", () => {
    it("returns 0n on empty edge list", () => {
      expect(deriveStakedLiquidityInRange(0n, [], [])).toBe(0n);
    });

    it("returns 0n when currentTick is below every edge", () => {
      // Position [100, 200]: edges=[100, 200], nets=[+L, -L]. currentTick=50
      // is below both — no entry crossed, so 0.
      expect(
        deriveStakedLiquidityInRange(50n, [100n, 200n], [500n, -500n]),
      ).toBe(0n);
    });

    it("returns liquidity when currentTick is in range (only tickLower crossed)", () => {
      // currentTick=150 ≥ 100 (entered) but < 200 (not exited yet).
      expect(
        deriveStakedLiquidityInRange(150n, [100n, 200n], [500n, -500n]),
      ).toBe(500n);
    });

    it("returns 0n when currentTick is above every edge (entered then exited)", () => {
      // currentTick=300 ≥ 100 AND ≥ 200 ⇒ +L - L = 0.
      expect(
        deriveStakedLiquidityInRange(300n, [100n, 200n], [500n, -500n]),
      ).toBe(0n);
    });

    it("includes an edge that equals currentTick (tickLower inclusive)", () => {
      // Uniswap v3 convention: tickLower <= currentTick < tickUpper.
      // deriveStakedLiquidityInRange uses edges[i] <= currentTick, so the
      // tickLower edge is included when currentTick === tickLower.
      expect(
        deriveStakedLiquidityInRange(100n, [100n, 200n], [500n, -500n]),
      ).toBe(500n);
    });

    it("excludes the tickUpper edge when currentTick === tickUpper (boundary exit)", () => {
      // currentTick=200 ⇒ both edges <=200 ⇒ +L - L = 0. Matches the upper-
      // exclusive convention in isPositionInRange.
      expect(
        deriveStakedLiquidityInRange(200n, [100n, 200n], [500n, -500n]),
      ).toBe(0n);
    });

    it("sums multiple overlapping positions", () => {
      // Position A: [100, 300], L=500; Position B: [200, 400], L=300.
      // edges = [100, 200, 300, 400], nets = [+500, +300, -500, -300].
      // At currentTick=250: A is in (entered at 100, not yet exited at 300),
      // B is in (entered at 200, not yet exited at 400) ⇒ 500 + 300 = 800.
      expect(
        deriveStakedLiquidityInRange(
          250n,
          [100n, 200n, 300n, 400n],
          [500n, 300n, -500n, -300n],
        ),
      ).toBe(800n);
    });

    it("handles negative ticks", () => {
      // Position [-200, -100], L=500.
      expect(
        deriveStakedLiquidityInRange(-150n, [-200n, -100n], [500n, -500n]),
      ).toBe(500n);
      expect(
        deriveStakedLiquidityInRange(-50n, [-200n, -100n], [500n, -500n]),
      ).toBe(0n);
    });

    it("agrees with processTickCrossingsForStaked walking up from the lowest edge", () => {
      // Build a non-trivial edge set and verify deriveStakedLiquidityInRange
      // matches what processTickCrossingsForStaked produces by walking up from
      // far below to the target tick.
      const edges = [-200n, -100n, 100n, 300n];
      const nets = [400n, 200n, -100n, -500n];
      const target = 150n;

      const noDbContext = {
        log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
      } as unknown as handlerContext;

      const walked = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        -500n,
        target,
        sqrtAt(-500n),
        sqrtAt(target),
        1n,
        noDbContext,
        0n,
        true,
        edges,
        nets,
      );

      expect(deriveStakedLiquidityInRange(target, edges, nets)).toBe(
        walked.stakedLiquidityInRange,
      );
    });
  });
});
