import type { Token, handlerContext } from "generated";
import { CLGauge, MockDb, NFPM } from "../../generated/src/TestHelpers.gen";
import {
  applyStakedPositionToEdges,
  deriveStakedLiquidityInRange,
  processTickCrossings,
} from "../../src/Aggregators/CLStakedLiquidity";
import {
  NonFungiblePositionId,
  PoolId,
  toChecksumAddress,
} from "../../src/Constants";
import { updateStakedPositionLiquidity } from "../../src/EventHandlers/NFPM/NFPMCommonLogic";
import { setupCommon } from "../EventHandlers/Pool/common";
import { sqrtAt } from "./common";

/**
 * Co-located sanity test for #649: replacing `processTickCrossings`
 * fan-out with the sparse stakedTickEdges / stakedTickEdgeNets list on
 * Pool.
 *
 * Two assertions:
 *   (a) The edge list stays sorted + monotone under arbitrary gauge
 *       deposit/withdraw ordering across ≥200 synthetic events.
 *   (b) `processTickCrossings` returns the same staked-liq-in-range
 *       delta as a pure in-test baseline map for a swap window that crosses
 *       multiple edges.
 */
describe("CLStakedLiquidity edge-list sanity (#649)", () => {
  const {
    mockToken0Data,
    mockToken1Data,
    createMockPool,
    createMockNonFungiblePosition,
    defaultNfpmAddress,
  } = setupCommon();
  const chainId = 10;
  const gaugeAddress = toChecksumAddress(
    "0x5555555555555555555555555555555555555555",
  );
  const userAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );

  it("(a) stakedTickEdges stays sorted + monotone across 150 interleaved gauge Deposit/Withdraw events", async () => {
    let mockDb = MockDb.createMockDb();

    const liquidityPool = createMockPool({
      isCL: true,
      gaugeAddress,
      hasStakes: false,
    });

    mockDb = mockDb.entities.Pool.set(liquidityPool);
    mockDb = mockDb.entities.Token.set(mockToken0Data as Token);
    mockDb = mockDb.entities.Token.set(mockToken1Data as Token);

    // 100 synthetic positions with varied tick ranges — enough for sorted-insert
    // collisions and removals to exercise the invariants.
    const POSITIONS = 100;
    for (let i = 0; i < POSITIONS; i++) {
      const tokenId = BigInt(i + 1);
      const tickLower = BigInt(-500 + (i % 20) * 50);
      const tickUpper = tickLower + BigInt(100 + (i % 7) * 50);
      const liquidity = BigInt(1000 + i);
      const position = createMockNonFungiblePosition({
        tokenId,
        nfpmAddress: defaultNfpmAddress,
        pool: liquidityPool.poolAddress,
        owner: userAddress,
        tickLower,
        tickUpper,
        liquidity,
      });
      mockDb = mockDb.entities.NonFungiblePosition.set(position);
    }

    // Interleave Deposit and Withdraw events: deposit all, then withdraw half
    // in a non-sorted order. 150 total events (100 deposits + 50 withdraws).
    const depositEvents = [];
    for (let i = 0; i < POSITIONS; i++) {
      const tokenId = BigInt(i + 1);
      depositEvents.push(
        CLGauge.Deposit.createMockEvent({
          user: userAddress,
          tokenId,
          liquidityToStake: BigInt(1000 + i),
          mockEventData: {
            srcAddress: gaugeAddress,
            chainId,
            block: {
              number: 1_000_000 + i,
              timestamp: 1_700_000_000 + i,
              hash: `0x${"a".repeat(64)}`,
            },
          },
        }),
      );
    }

    // Withdraw a pseudo-random half of them (deterministic order via i*7 mod).
    const withdrawEvents = [];
    for (let i = 0; i < POSITIONS; i++) {
      if (i % 2 !== 0) continue;
      const pick = ((i * 7) % POSITIONS) + 1;
      const tokenId = BigInt(pick);
      withdrawEvents.push(
        CLGauge.Withdraw.createMockEvent({
          user: userAddress,
          tokenId,
          liquidityToStake: BigInt(1000 + pick - 1),
          mockEventData: {
            srcAddress: gaugeAddress,
            chainId,
            block: {
              number: 2_000_000 + i,
              timestamp: 1_700_100_000 + i,
              hash: `0x${"b".repeat(64)}`,
            },
          },
        }),
      );
    }

    const events = [...depositEvents, ...withdrawEvents];
    expect(events.length).toBeGreaterThanOrEqual(150);

    const resultDb = await mockDb.processEvents(events);
    const updated = resultDb.entities.Pool.get(
      PoolId(chainId, liquidityPool.poolAddress),
    );

    expect(updated).toBeDefined();
    if (!updated) return;

    const edges = updated.stakedTickEdges;
    const nets = updated.stakedTickEdgeNets;

    // Invariant 1: parallel arrays have the same length
    expect(edges.length).toBe(nets.length);

    // Invariant 2: sorted strictly ascending (monotone, dedup'd)
    for (let i = 1; i < edges.length; i++) {
      expect(edges[i]).toBeGreaterThan(edges[i - 1]);
    }

    // Invariant 3: no zero-net entries (zero-net means the edge should have been dropped)
    for (let i = 0; i < nets.length; i++) {
      expect(nets[i]).not.toBe(0n);
    }

    // Invariant 4: edge list matches a pure-function in-test baseline that
    // replays the same deposit/withdraw stream onto a Map<tick, net>. This
    // pins the aggregator's sparse encoding to the underlying Uniswap v3
    // per-tick liquidityNet semantics without depending on any entity.
    const withdrawnTokenIds = new Set<bigint>();
    for (let i = 0; i < POSITIONS; i++) {
      if (i % 2 !== 0) continue;
      const pick = ((i * 7) % POSITIONS) + 1;
      withdrawnTokenIds.add(BigInt(pick));
    }

    const baseline = new Map<bigint, bigint>();
    for (let i = 0; i < POSITIONS; i++) {
      const tokenId = BigInt(i + 1);
      if (withdrawnTokenIds.has(tokenId)) continue;
      const tickLower = BigInt(-500 + (i % 20) * 50);
      const tickUpper = tickLower + BigInt(100 + (i % 7) * 50);
      const liquidity = BigInt(1000 + i);
      baseline.set(tickLower, (baseline.get(tickLower) ?? 0n) + liquidity);
      baseline.set(tickUpper, (baseline.get(tickUpper) ?? 0n) - liquidity);
    }

    const baselineSorted = [...baseline.entries()]
      .filter(([, net]) => net !== 0n)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    expect(edges.length).toBe(baselineSorted.length);
    for (let i = 0; i < edges.length; i++) {
      expect(edges[i]).toBe(baselineSorted[i][0]);
      expect(nets[i]).toBe(baselineSorted[i][1]);
    }
  });

  it("(b) processTickCrossings returns the same in-range delta as a pure-map baseline across a swap window crossing multiple edges", async () => {
    const mockPoolAddress = toChecksumAddress(`0x${"1".repeat(40)}`);
    // Build a realistic edge set by simulating 50 stake events and walking
    // the exact same events through a pure-map baseline.
    const baselineNet = new Map<bigint, bigint>();
    let edges: readonly bigint[] = [];
    let nets: readonly bigint[] = [];

    for (let i = 0; i < 50; i++) {
      const tickLower = BigInt(-500 + i * 20);
      const tickUpper = tickLower + 100n;
      const liquidity = BigInt(500 + i * 10);

      // Baseline: maintain a map keyed by tick (Uniswap v3 per-tick liquidityNet).
      baselineNet.set(
        tickLower,
        (baselineNet.get(tickLower) ?? 0n) + liquidity,
      );
      baselineNet.set(
        tickUpper,
        (baselineNet.get(tickUpper) ?? 0n) - liquidity,
      );

      // Under test: apply to the sparse edge list.
      const out = applyStakedPositionToEdges(
        edges,
        nets,
        tickLower,
        tickUpper,
        liquidity,
      );
      edges = out.edges;
      nets = out.nets;
    }

    // Pick a swap window that crosses ~20 edges.
    const oldTick = -400n;
    const newTick = 400n;

    // Baseline: walk the map directly and sum liquidityNet for ticks ≤ newTick.
    // Post-#719, processTickCrossings returns derive(newTick) rather
    // than (seed + delta-across-window) — the function self-heals from edge
    // state regardless of the cached seed.
    let baselineResult = 0n;
    for (const [tick, net] of baselineNet.entries()) {
      if (tick <= newTick) {
        baselineResult += net;
      }
    }

    // Under test: use the new function with in-aggregator arrays.
    const noDbContext = {
      log: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      },
      // biome-ignore lint/suspicious/noExplicitAny: test-only shape
    } as any;

    const newResult = processTickCrossings(
      chainId,
      mockPoolAddress,
      oldTick,
      newTick,
      sqrtAt(oldTick),
      sqrtAt(newTick),
      10n,
      noDbContext,
      0n,
      true,
      edges,
      nets,
    );

    expect(newResult.liquidityInRange).toBe(baselineResult);

    // Sanity: the window actually crosses multiple edges.
    const crossingCount = edges.filter(
      (e) => e > oldTick && e <= newTick,
    ).length;
    expect(crossingCount).toBeGreaterThan(5);

    // Also verify the OPPOSITE direction (price moving DOWN). Post-#719 the
    // walker is seeded from derive(oldTick), so the down-swap return value is
    // derive(newTickDown) regardless of any seed input. Baseline computes
    // derive(newTickDown) directly: sum of nets for ticks ≤ newTickDown.
    const oldTickDown = newTick;
    const newTickDown = oldTick;
    let baselineDownResult = 0n;
    for (const [tick, net] of baselineNet.entries()) {
      if (tick <= newTickDown) {
        baselineDownResult += net;
      }
    }

    const downResult = processTickCrossings(
      chainId,
      mockPoolAddress,
      oldTickDown,
      newTickDown,
      sqrtAt(oldTickDown),
      sqrtAt(newTickDown),
      10n,
      noDbContext,
      baselineResult,
      true,
      edges,
      nets,
    );

    expect(downResult.liquidityInRange).toBe(baselineDownResult);
    // Sanity: the round trip exits at derive(newTickDown), which on this
    // edge set is non-zero because several positions have tickLower ≤ -400
    // (tickLowers start at -500 and step up). The walker's seed input is
    // no longer load-bearing (issue #719) — the return is purely a function
    // of (newTickDown, edges, nets).
    expect(downResult.liquidityInRange).toBeGreaterThan(0n);
  });

  // Regression coverage for issue #719: cover the three concrete drift paths
  // from the bug report plus the closed-system invariant. Each test pins the
  // structural property that the fix introduces:
  //   stakedLiquidityInRange === deriveStakedLiquidityInRange(currentTick,
  //                                                            stakedTickEdges,
  //                                                            stakedTickEdgeNets)
  // ALWAYS. The cached running counter is replaced by derivation, so the field
  // never drifts away from the edge truth regardless of event ordering, gate
  // outcomes, or NFPM-mediated liquidity changes during a stake.
  describe("#719 drift paths", () => {
    it("(c) gauge Deposit before pool Initialize derives counter from edge state", async () => {
      // Pool has never seen Initialize: sqrtPriceX96=0n, tick=0n. The legacy
      // gate `sqrtPriceX96 !== 0n` suppressed the counter update on deposit
      // while still applying the position to the sparse edge nets — the first
      // Swap on the pool then walked from a wrong baseline. The structural
      // fix removes the counter/edges asymmetry by deriving the counter from
      // edges at every write.
      let mockDb = MockDb.createMockDb();
      const liquidityPool = createMockPool({
        isCL: true,
        gaugeAddress,
        sqrtPriceX96: 0n,
        tick: 0n,
        hasStakes: false,
      });
      mockDb = mockDb.entities.Pool.set(liquidityPool);
      mockDb = mockDb.entities.Token.set(mockToken0Data as Token);
      mockDb = mockDb.entities.Token.set(mockToken1Data as Token);

      // Position spans tick 0 — it is in-range at the default tick=0n.
      const tickLower = -100n;
      const tickUpper = 100n;
      const liquidity = 500n;
      const tokenId = 1n;
      mockDb = mockDb.entities.NonFungiblePosition.set(
        createMockNonFungiblePosition({
          tokenId,
          nfpmAddress: defaultNfpmAddress,
          pool: liquidityPool.poolAddress,
          owner: userAddress,
          tickLower,
          tickUpper,
          liquidity,
        }),
      );

      const event = CLGauge.Deposit.createMockEvent({
        user: userAddress,
        tokenId,
        liquidityToStake: liquidity,
        mockEventData: {
          srcAddress: gaugeAddress,
          chainId,
          block: {
            number: 1,
            timestamp: 1_700_000_000,
            hash: `0x${"a".repeat(64)}`,
          },
        },
      });

      const resultDb = await mockDb.processEvents([event]);
      const updated = resultDb.entities.Pool.get(
        PoolId(chainId, liquidityPool.poolAddress),
      );
      expect(updated).toBeDefined();
      if (!updated) return;

      // Edges populated by applyStakedPositionToEdges.
      expect(updated.stakedTickEdges).toEqual([tickLower, tickUpper]);
      expect(updated.stakedTickEdgeNets).toEqual([liquidity, -liquidity]);
      // Counter MUST equal derive(currentTick=0n, edges, nets):
      //   edge -100 ≤ 0 → contributes +500
      //   edge  100 > 0 → excluded
      // ⇒ stakedLiquidityInRange = 500. Legacy gated path would leave 0n.
      expect(updated.stakedLiquidityInRange).toBe(
        deriveStakedLiquidityInRange(
          updated.tick ?? 0n,
          updated.stakedTickEdges,
          updated.stakedTickEdgeNets,
        ),
      );
      expect(updated.stakedLiquidityInRange).toBe(500n);
    });

    it("(d) edge-merge rejection heals a previously poisoned counter via derivation", async () => {
      // Simulates the "edge map disagrees with counter" mode: the aggregator's
      // stakedLiquidityInRange is poisoned (non-zero with empty edges) from
      // prior drift, and an incoming Deposit gets rejected by
      // applyStakedPositionToEdges (degenerate range: tickLower >= tickUpper).
      // With derivation, the rejection still triggers a heal — the counter is
      // overwritten with derive(currentTick, edges, nets), which on empty
      // edges is 0. The legacy gated path skipped the counter on rejection,
      // so the poison would persist.
      let mockDb = MockDb.createMockDb();
      const liquidityPool = createMockPool({
        isCL: true,
        gaugeAddress,
        sqrtPriceX96: sqrtAt(0n),
        tick: 0n,
        hasStakes: false,
        // Poisoned cached counter — edges are empty, so the truth is 0n.
        stakedLiquidityInRange: 999_999n,
        stakedTickEdges: [],
        stakedTickEdgeNets: [],
      });
      mockDb = mockDb.entities.Pool.set(liquidityPool);
      mockDb = mockDb.entities.Token.set(mockToken0Data as Token);
      mockDb = mockDb.entities.Token.set(mockToken1Data as Token);

      // Degenerate position (tickLower >= tickUpper). Real chains wouldn't
      // mint this, but the rejection path is the structural concern — any
      // future rejection cause (out-of-range ticks from an upstream bug,
      // corrupt RPC data, etc.) must converge the counter to the edge truth.
      const tokenId = 1n;
      mockDb = mockDb.entities.NonFungiblePosition.set(
        createMockNonFungiblePosition({
          tokenId,
          nfpmAddress: defaultNfpmAddress,
          pool: liquidityPool.poolAddress,
          owner: userAddress,
          tickLower: 200n,
          tickUpper: 100n,
          liquidity: 500n,
        }),
      );

      const event = CLGauge.Deposit.createMockEvent({
        user: userAddress,
        tokenId,
        liquidityToStake: 500n,
        mockEventData: {
          srcAddress: gaugeAddress,
          chainId,
          block: {
            number: 1,
            timestamp: 1_700_000_000,
            hash: `0x${"a".repeat(64)}`,
          },
        },
      });

      const resultDb = await mockDb.processEvents([event]);
      const updated = resultDb.entities.Pool.get(
        PoolId(chainId, liquidityPool.poolAddress),
      );
      expect(updated).toBeDefined();
      if (!updated) return;

      // Rejection means edges are unchanged (still empty).
      expect(updated.stakedTickEdges).toEqual([]);
      expect(updated.stakedTickEdgeNets).toEqual([]);
      // The healing invariant: counter must equal derive at the current tick.
      expect(updated.stakedLiquidityInRange).toBe(
        deriveStakedLiquidityInRange(
          updated.tick ?? 0n,
          updated.stakedTickEdges,
          updated.stakedTickEdgeNets,
        ),
      );
      expect(updated.stakedLiquidityInRange).toBe(0n);
    });

    it("(e) NFPM IncreaseLiquidity while price is out of range heals the counter", async () => {
      // The exact #719 path 3 asymmetry: gauge Deposit adds +L while price is
      // in range (counter += L). Price moves out of range. NFPM
      // IncreaseLiquidity bumps position liquidity, but the legacy gate
      // `isPositionInRange(...)` skips the counter update while the edge
      // nets still update via applyStakedPositionToEdges. With derivation,
      // the counter is recomputed from the updated edges at the (out-of-range)
      // tick — both edges land ≤ currentTick, so the nets sum to zero and the
      // counter heals from "stale L" to "0".
      const tickLower = -100n;
      const tickUpper = 100n;
      const positionLiquidity = 100n;
      const tokenId = 7n;

      const liquidityPool = createMockPool({
        isCL: true,
        gaugeAddress,
        // Price is now ABOVE the position's range (tick=500 > tickUpper=100).
        sqrtPriceX96: sqrtAt(500n),
        tick: 500n,
        hasStakes: true,
        // Pre-deposit state: counter=positionLiquidity (correct WHILE in range
        // — set as if the deposit fired earlier at a price in range).
        stakedLiquidityInRange: positionLiquidity,
        stakedTickEdges: [tickLower, tickUpper],
        stakedTickEdgeNets: [positionLiquidity, -positionLiquidity],
      });

      // Position is already staked in gauge (so updateStakedPositionLiquidity
      // is the function NFPM.IncreaseLiquidity would invoke for it).
      const position = createMockNonFungiblePosition({
        tokenId,
        nfpmAddress: defaultNfpmAddress,
        pool: liquidityPool.poolAddress,
        owner: userAddress,
        tickLower,
        tickUpper,
        liquidity: positionLiquidity,
        isStakedInGauge: true,
      });

      // Drive updateStakedPositionLiquidity directly: it's the function NFPM
      // delegates to for staked positions, and bypassing the full event chain
      // keeps the test focused on the counter-update path the issue exposes.
      const setSpy = vi.fn();
      // Issue #780: updateStakedPositionLiquidity now also touches the staker's
      // UserStatsPerPool (Pool + user must move in lockstep for the gauge
      // Withdraw guard). Mock the user-side entities so the path completes.
      const mockContext = {
        Pool: { set: setSpy },
        PoolSnapshot: { set: vi.fn() },
        Token: { get: vi.fn().mockResolvedValue(undefined) },
        UserStatsPerPool: {
          get: vi.fn().mockResolvedValue(undefined),
          set: vi.fn(),
        },
        UserStatsPerPoolSnapshot: {
          get: vi.fn().mockResolvedValue(undefined),
          set: vi.fn(),
          getWhere: vi.fn().mockResolvedValue([]),
        },
        log: {
          error: vi.fn(),
          warn: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
        },
      } as unknown as handlerContext;

      const increaseDelta = 50n;
      await updateStakedPositionLiquidity(
        position,
        // biome-ignore lint/suspicious/noExplicitAny: trimmed PoolData for test
        { liquidityPoolAggregator: liquidityPool } as any,
        increaseDelta,
        mockContext,
        new Date(1_700_000_000_000),
        chainId,
        1,
      );

      expect(setSpy).toHaveBeenCalledTimes(1);
      const written = setSpy.mock.calls[0][0] as {
        stakedLiquidityInRange: bigint;
        stakedTickEdges: bigint[];
        stakedTickEdgeNets: bigint[];
        tick: bigint;
      };

      // Edges absorbed the +increaseDelta (consistent with applyStakedPositionToEdges).
      expect(written.stakedTickEdges).toEqual([tickLower, tickUpper]);
      expect(written.stakedTickEdgeNets).toEqual([
        positionLiquidity + increaseDelta,
        -(positionLiquidity + increaseDelta),
      ]);
      // The healing invariant at the post-write tick. With tick=500, both
      // edges contribute → +(L+Δ) - (L+Δ) = 0. The legacy code would have
      // kept the counter at `positionLiquidity` (stale).
      expect(written.stakedLiquidityInRange).toBe(
        deriveStakedLiquidityInRange(
          written.tick ?? 0n,
          written.stakedTickEdges,
          written.stakedTickEdgeNets,
        ),
      );
      expect(written.stakedLiquidityInRange).toBe(0n);
    });

    it("(f) edge-sanity invariant: gauge Deposit + Withdraw round-trips counter to 0n", async () => {
      // AC item: after deposit + N swaps + withdraw the counter MUST land on
      // 0n. Swaps are emulated by mutating the aggregator's tick between
      // Deposit and Withdraw — the structural fix means the counter is
      // recomputed from edges at every write, so any number of intervening
      // tick moves cannot poison the round-trip.
      let mockDb = MockDb.createMockDb();
      const liquidityPool = createMockPool({
        isCL: true,
        gaugeAddress,
        sqrtPriceX96: sqrtAt(0n),
        tick: 0n,
        hasStakes: false,
      });
      mockDb = mockDb.entities.Pool.set(liquidityPool);
      mockDb = mockDb.entities.Token.set(mockToken0Data as Token);
      mockDb = mockDb.entities.Token.set(mockToken1Data as Token);

      const tickLower = -100n;
      const tickUpper = 100n;
      const liquidity = 500n;
      const tokenId = 1n;
      mockDb = mockDb.entities.NonFungiblePosition.set(
        createMockNonFungiblePosition({
          tokenId,
          nfpmAddress: defaultNfpmAddress,
          pool: liquidityPool.poolAddress,
          owner: userAddress,
          tickLower,
          tickUpper,
          liquidity,
        }),
      );

      // 1) Deposit at in-range tick.
      const depositEvent = CLGauge.Deposit.createMockEvent({
        user: userAddress,
        tokenId,
        liquidityToStake: liquidity,
        mockEventData: {
          srcAddress: gaugeAddress,
          chainId,
          block: {
            number: 1,
            timestamp: 1_700_000_000,
            hash: `0x${"a".repeat(64)}`,
          },
        },
      });
      let resultDb = await mockDb.processEvents([depositEvent]);

      const postDeposit = resultDb.entities.Pool.get(
        PoolId(chainId, liquidityPool.poolAddress),
      );
      expect(postDeposit).toBeDefined();
      if (!postDeposit) return;
      expect(postDeposit.stakedLiquidityInRange).toBe(
        deriveStakedLiquidityInRange(
          postDeposit.tick ?? 0n,
          postDeposit.stakedTickEdges,
          postDeposit.stakedTickEdgeNets,
        ),
      );

      // 2) Emulate N "swaps" by jiggling tick across the range and out the
      // far side. Each pause writes the new (sqrtPriceX96, tick) state the
      // way a Swap handler would have. The invariant must hold at every step.
      const tickJourney = [50n, 99n, 500n, -300n, 0n];
      for (const t of tickJourney) {
        const current = resultDb.entities.Pool.get(
          PoolId(chainId, liquidityPool.poolAddress),
        );
        if (!current) throw new Error("aggregator vanished mid-journey");
        resultDb = resultDb.entities.Pool.set({
          ...current,
          tick: t,
          sqrtPriceX96: sqrtAt(t),
        });
      }

      // 3) Withdraw at the final tick (back in range).
      const withdrawEvent = CLGauge.Withdraw.createMockEvent({
        user: userAddress,
        tokenId,
        liquidityToStake: liquidity,
        mockEventData: {
          srcAddress: gaugeAddress,
          chainId,
          block: {
            number: 2,
            timestamp: 1_700_100_000,
            hash: `0x${"b".repeat(64)}`,
          },
        },
      });
      resultDb = await resultDb.processEvents([withdrawEvent]);

      const postWithdraw = resultDb.entities.Pool.get(
        PoolId(chainId, liquidityPool.poolAddress),
      );
      expect(postWithdraw).toBeDefined();
      if (!postWithdraw) return;

      // After the round-trip, edges and counter must be empty/zero.
      expect(postWithdraw.stakedTickEdges).toEqual([]);
      expect(postWithdraw.stakedTickEdgeNets).toEqual([]);
      expect(postWithdraw.stakedLiquidityInRange).toBe(
        deriveStakedLiquidityInRange(
          postWithdraw.tick ?? 0n,
          postWithdraw.stakedTickEdges,
          postWithdraw.stakedTickEdgeNets,
        ),
      );
      expect(postWithdraw.stakedLiquidityInRange).toBe(0n);
    });

    it("(g) [#780] Deposit + IncreaseLiquidity-while-staked + Withdraw round-trips counter and edges to zero", async () => {
      // Reproduces the exact #780 mechanism from issue body:
      // - Deposit at liquidity L0 → pool.currentLiquidityStaked = L0
      // - NFPM.IncreaseLiquidity while staked bumps position.liquidity to L0+ΔL
      // - Withdraw arrives with liquidityToStake = L0+ΔL (matches chain liquidity)
      // - Pre-fix: pool.currentLiquidityStaked - (L0+ΔL) = -ΔL < 0n → guard fires,
      //   edges decrement is dropped, stakedTickEdges/Nets pollute → stakedReserve0/1
      //   leak forever (phantom positive residue scaling with ΔL).
      // - Post-fix: updateStakedPositionLiquidity mirrors ΔL onto the counter so
      //   the Withdraw guard passes and the round-trip balances to 0n.
      let mockDb = MockDb.createMockDb();
      const liquidityPool = createMockPool({
        isCL: true,
        gaugeAddress,
        sqrtPriceX96: sqrtAt(0n),
        tick: 0n,
        hasStakes: false,
        nfpmAddress: defaultNfpmAddress,
      });
      mockDb = mockDb.entities.Pool.set(liquidityPool);
      mockDb = mockDb.entities.Token.set(mockToken0Data as Token);
      mockDb = mockDb.entities.Token.set(mockToken1Data as Token);

      const tickLower = -100n;
      const tickUpper = 100n;
      const initialLiquidity = 19_203_953_530_494n; // L0 from issue body's USDC/mooBIFI example
      const increaseDelta = 141_500_788_681_522_563n; // ΔL from issue body
      const tokenId = 31357n; // matches the issue body's example
      mockDb = mockDb.entities.NonFungiblePosition.set(
        createMockNonFungiblePosition({
          tokenId,
          nfpmAddress: defaultNfpmAddress,
          pool: liquidityPool.poolAddress,
          owner: userAddress,
          tickLower,
          tickUpper,
          liquidity: initialLiquidity,
          isStakedInGauge: false,
        }),
      );

      // 1) Gauge Deposit at L0.
      const depositEvent = CLGauge.Deposit.createMockEvent({
        user: userAddress,
        tokenId,
        liquidityToStake: initialLiquidity,
        mockEventData: {
          srcAddress: gaugeAddress,
          chainId,
          block: {
            number: 1,
            timestamp: 1_700_000_000,
            hash: `0x${"a".repeat(64)}`,
          },
        },
      });
      let resultDb = await mockDb.processEvents([depositEvent]);

      const postDeposit = resultDb.entities.Pool.get(
        PoolId(chainId, liquidityPool.poolAddress),
      );
      expect(postDeposit).toBeDefined();
      if (!postDeposit) return;
      expect(postDeposit.currentLiquidityStaked).toBe(initialLiquidity);

      // 2) NFPM.IncreaseLiquidity while position is staked. Mirror the chain
      // by bumping position.liquidity AND firing the IncreaseLiquidity event.
      const positionAfterDeposit = resultDb.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, defaultNfpmAddress, tokenId),
      );
      if (!positionAfterDeposit) throw new Error("position vanished");
      // Gauge Deposit sets isStakedInGauge=true via NFPMTransfer in the real
      // pipeline; here we set it explicitly to mirror that state.
      resultDb = resultDb.entities.NonFungiblePosition.set({
        ...positionAfterDeposit,
        isStakedInGauge: true,
      });

      const increaseEvent = NFPM.IncreaseLiquidity.createMockEvent({
        tokenId,
        liquidity: increaseDelta,
        amount0: 0n,
        amount1: 0n,
        mockEventData: {
          srcAddress: defaultNfpmAddress,
          chainId,
          block: {
            number: 2,
            timestamp: 1_700_010_000,
            hash: `0x${"c".repeat(64)}`,
          },
        },
      });
      resultDb = await resultDb.processEvents([increaseEvent]);

      const postIncrease = resultDb.entities.Pool.get(
        PoolId(chainId, liquidityPool.poolAddress),
      );
      expect(postIncrease).toBeDefined();
      if (!postIncrease) return;
      // The #780 fix: pool counter MUST track in-flight liquidity changes
      // so the next Withdraw guard does not underflow.
      expect(postIncrease.currentLiquidityStaked).toBe(
        initialLiquidity + increaseDelta,
      );

      // 3) Withdraw arrives with liquidityToStake = position.liquidity =
      // initialLiquidity + increaseDelta (mirroring how the gauge contract
      // emits Withdraw with the chain-truth liquidity).
      const withdrawEvent = CLGauge.Withdraw.createMockEvent({
        user: userAddress,
        tokenId,
        liquidityToStake: initialLiquidity + increaseDelta,
        mockEventData: {
          srcAddress: gaugeAddress,
          chainId,
          block: {
            number: 3,
            timestamp: 1_700_100_000,
            hash: `0x${"b".repeat(64)}`,
          },
        },
      });
      resultDb = await resultDb.processEvents([withdrawEvent]);

      const postWithdraw = resultDb.entities.Pool.get(
        PoolId(chainId, liquidityPool.poolAddress),
      );
      expect(postWithdraw).toBeDefined();
      if (!postWithdraw) return;

      // The round-trip must balance: counter = 0, edges empty, derive
      // invariant holds. Pre-#780 this would leave the edge nets at +(L0+ΔL)
      // and the counter at "L0 - (L0+ΔL) = guard fires, no decrement applied",
      // leaving phantom edges and a stale counter forever.
      expect(postWithdraw.currentLiquidityStaked).toBe(0n);
      expect(postWithdraw.stakedTickEdges).toEqual([]);
      expect(postWithdraw.stakedTickEdgeNets).toEqual([]);
      expect(postWithdraw.stakedLiquidityInRange).toBe(0n);
    });
  });
});
