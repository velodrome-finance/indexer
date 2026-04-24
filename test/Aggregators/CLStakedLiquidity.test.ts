import type { handlerContext } from "generated";
import {
  applyStakedPositionToEdges,
  computeStakedSwapReserveDelta,
  isPositionInRange,
  processTickCrossingsForStaked,
} from "../../src/Aggregators/CLStakedLiquidity";

describe("CLStakedLiquidity", () => {
  const CHAIN_ID = 8453;
  const POOL_ADDRESS = "0x1234567890123456789012345678901234567890";

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

    it("should return unchanged when oldTick === newTick", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        100n,
        200n,
        mockContext,
        500n,
        true,
        [100n, 200n],
        [300n, -300n],
      );
      expect(result).toBe(500n);
    });

    it("should return unchanged when tickSpacing is zero", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        300n,
        0n,
        mockContext,
        500n,
        true,
        [200n],
        [300n],
      );
      expect(result).toBe(500n);
    });

    it("should add stakedLiquidityNet when crossing up", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        250n,
        200n,
        mockContext,
        0n,
        true,
        [200n],
        [300n],
      );
      expect(result).toBe(300n);
    });

    it("should subtract stakedLiquidityNet when crossing down", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        250n,
        100n,
        200n,
        mockContext,
        300n,
        true,
        [200n],
        [300n],
      );
      expect(result).toBe(0n);
    });

    it("should handle multiple tick crossings going up", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        650n,
        200n,
        mockContext,
        0n,
        true,
        [200n, 400n, 600n],
        [100n, 200n, -50n],
      );
      expect(result).toBe(250n); // 0 + 100 + 200 - 50
    });

    it("should handle multiple tick crossings going down", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        650n,
        100n,
        200n,
        mockContext,
        250n,
        true,
        [200n, 400n, 600n],
        [100n, 200n, -50n],
      );
      // 250 - (-50) - 200 - 100 = 250 + 50 - 200 - 100 = 0
      expect(result).toBe(0n);
    });

    it("should skip edges that fall outside the [oldTick, newTick] window", async () => {
      // Edges exist at 200 and 400, but swap only crosses 200
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        300n,
        200n,
        mockContext,
        50n,
        true,
        [200n, 400n],
        [150n, -150n],
      );
      expect(result).toBe(200n); // 50 + 150 (only 200 crossed, 400 is beyond newTick=300)
    });

    it("should handle negative tick ranges", async () => {
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        -300n,
        -100n,
        200n,
        mockContext,
        0n,
        true,
        [-200n],
        [500n],
      );
      expect(result).toBe(500n);
    });

    it("should not cross the oldTick itself when going up (strict-above semantics)", async () => {
      // oldTick=200, edge at 200 — since we search lowerBound(201), edge is skipped
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        200n,
        350n,
        200n,
        mockContext,
        0n,
        true,
        [200n],
        [100n],
      );
      expect(result).toBe(0n);
    });

    it("should include the oldTick boundary when going down (at-or-below semantics)", async () => {
      // oldTick=200, edge at 200 — going down includes it
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        200n,
        50n,
        200n,
        mockContext,
        100n,
        true,
        [200n],
        [100n],
      );
      expect(result).toBe(0n); // 100 - 100
    });

    it("should handle tickSpacing of 1 without scanning per-tick (only edges drive the walk)", async () => {
      // Edges 101/102/103; spacing=1 means the old impl would sweep per-tick,
      // but the new impl only visits the edges that exist.
      const result = processTickCrossingsForStaked(
        CHAIN_ID,
        POOL_ADDRESS,
        100n,
        103n,
        1n,
        mockContext,
        0n,
        true,
        [101n, 102n, 103n],
        [10n, 20n, -5n],
      );
      expect(result).toBe(25n); // 0 + 10 + 20 - 5
    });

    describe("safety guards", () => {
      it("should short-circuit when hasStakes is false", async () => {
        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          100n,
          250n,
          200n,
          mockContext,
          500n,
          false,
          [200n],
          [999n],
        );
        expect(result).toBe(500n);
      });

      it("should short-circuit when the edge list is empty (no staked positions)", async () => {
        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          100n,
          250n,
          200n,
          mockContext,
          500n,
          true, // latch true but no edges
          [],
          [],
        );
        expect(result).toBe(500n);
      });

      it("should bail and log when oldTick is below TICK_MIN", async () => {
        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          -900000n,
          100n,
          200n,
          mockContext,
          500n,
          true,
          [200n],
          [300n],
        );
        expect(result).toBe(500n);
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
          200n,
          mockContext,
          500n,
          true,
          [200n],
          [300n],
        );
        expect(result).toBe(500n);
        expect(logErrorSpy).toHaveBeenCalledTimes(1);
      });

      it("should accept boundary ticks at exactly TICK_MIN and TICK_MAX", async () => {
        const result = processTickCrossingsForStaked(
          CHAIN_ID,
          POOL_ADDRESS,
          -887272n,
          887272n,
          200n,
          mockContext,
          0n,
          true,
          [],
          [],
        );
        expect(result).toBe(0n);
        expect(logErrorSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("computeStakedSwapReserveDelta", () => {
    it("should compute proportional split correctly", () => {
      const result = computeStakedSwapReserveDelta(
        -100n,
        500n,
        200n, // staked
        1000n, // total
      );

      // -100 * 200/1000 = -20, 500 * 200/1000 = 100
      expect(result.stakedDelta0).toBe(-20n);
      expect(result.stakedDelta1).toBe(100n);
    });

    it("should return zero when totalLiqInRange is zero", () => {
      const result = computeStakedSwapReserveDelta(-100n, 500n, 200n, 0n);

      expect(result.stakedDelta0).toBe(0n);
      expect(result.stakedDelta1).toBe(0n);
    });

    it("should return zero when stakedLiqInRange is zero", () => {
      const result = computeStakedSwapReserveDelta(-100n, 500n, 0n, 1000n);

      expect(result.stakedDelta0).toBe(0n);
      expect(result.stakedDelta1).toBe(0n);
    });

    it("should return full delta when stakedLiq equals totalLiq (100% staked)", () => {
      const result = computeStakedSwapReserveDelta(-100n, 500n, 1000n, 1000n);

      expect(result.stakedDelta0).toBe(-100n);
      expect(result.stakedDelta1).toBe(500n);
    });

    it("should handle rounding via bigint truncation", () => {
      // 100 * 1 / 3 = 33 (truncated from 33.33...)
      const result = computeStakedSwapReserveDelta(100n, -100n, 1n, 3n);

      expect(result.stakedDelta0).toBe(33n);
      expect(result.stakedDelta1).toBe(-33n);
    });

    it("should handle large values", () => {
      const large = 10n ** 30n;
      const result = computeStakedSwapReserveDelta(
        large,
        -large,
        large / 2n,
        large,
      );

      expect(result.stakedDelta0).toBe(large / 2n);
      expect(result.stakedDelta1).toBe(-(large / 2n));
    });
  });
});
