import type { Token } from "generated";
import { CLGauge, MockDb } from "../../generated/src/TestHelpers.gen";
import {
  applyStakedPositionToEdges,
  processTickCrossingsForStaked,
} from "../../src/Aggregators/CLStakedLiquidity";
import {
  CLTickStakedId,
  NonFungiblePositionId,
  PoolId,
  toChecksumAddress,
} from "../../src/Constants";
import { setupCommon } from "../EventHandlers/Pool/common";

/**
 * Co-located sanity test for #649: replacing `processTickCrossingsForStaked`
 * fan-out with the sparse stakedTickEdges / stakedTickEdgeNets list on
 * LiquidityPoolAggregator.
 *
 * Two assertions:
 *   (a) The edge list stays sorted + monotone under arbitrary gauge
 *       deposit/withdraw ordering across ≥200 synthetic events.
 *   (b) `processTickCrossingsForStaked` returns the same staked-liq-in-range
 *       delta as the pre-PR baseline (which reads CLTickStaked entities) for
 *       a swap window that crosses multiple edges.
 */
describe("CLStakedLiquidity edge-list sanity (#649)", () => {
  const {
    mockToken0Data,
    mockToken1Data,
    createMockLiquidityPoolAggregator,
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

    const liquidityPool = createMockLiquidityPoolAggregator({
      isCL: true,
      gaugeAddress,
      hasStakes: false,
    });

    mockDb = mockDb.entities.LiquidityPoolAggregator.set(liquidityPool);
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
    const updated = resultDb.entities.LiquidityPoolAggregator.get(
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

    // Invariant 4: edge list consistent with CLTickStaked — each edge's net
    // equals the corresponding CLTickStaked.stakedLiquidityNet.
    // TODO(#652): Remove this invariant when the legacy CLTickStaked writes
    // are deleted; the in-aggregator edge list becomes the sole source of truth.
    for (let i = 0; i < edges.length; i++) {
      const tickEntity = resultDb.entities.CLTickStaked.get(
        CLTickStakedId(chainId, liquidityPool.poolAddress, edges[i]),
      );
      expect(tickEntity).toBeDefined();
      expect(tickEntity?.stakedLiquidityNet).toBe(nets[i]);
    }
  });

  it("(b) processTickCrossingsForStaked returns the same in-range delta as a CLTickStaked-reading baseline across a swap window crossing multiple edges", async () => {
    const mockPoolAddress = toChecksumAddress(`0x${"1".repeat(40)}`);
    // Build a realistic edge set by simulating 50 stake events and walking
    // the exact same events through the pure baseline (a CLTickStaked map).
    const baselineNet = new Map<bigint, bigint>();
    let edges: readonly bigint[] = [];
    let nets: readonly bigint[] = [];

    for (let i = 0; i < 50; i++) {
      const tickLower = BigInt(-500 + i * 20);
      const tickUpper = tickLower + 100n;
      const liquidity = BigInt(500 + i * 10);

      // Baseline: maintain a map keyed by tick, mirroring CLTickStaked.stakedLiquidityNet.
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

    // Baseline: walk the map directly and sum liquidityNet for ticks strictly
    // above oldTick through newTick.
    let baselineResult = 0n;
    for (const [tick, net] of baselineNet.entries()) {
      if (tick > oldTick && tick <= newTick) {
        baselineResult += net;
      }
    }

    // Under test: use the new function with in-aggregator arrays. Must NOT
    // touch CLTickStaked (we assert by installing a spy that throws).
    const noDbContext = {
      log: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      },
      CLTickStaked: {
        get: vi.fn(() => {
          throw new Error(
            "processTickCrossingsForStaked must not call CLTickStaked.get on the swap path (#649)",
          );
        }),
      },
      // biome-ignore lint/suspicious/noExplicitAny: test-only shape
    } as any;

    const newResult = processTickCrossingsForStaked(
      chainId,
      mockPoolAddress,
      oldTick,
      newTick,
      10n,
      noDbContext,
      0n,
      true,
      edges,
      nets,
    );

    expect(newResult).toBe(baselineResult);
    expect(noDbContext.CLTickStaked.get).not.toHaveBeenCalled();

    // Sanity: the window actually crosses multiple edges.
    const crossingCount = edges.filter(
      (e) => e > oldTick && e <= newTick,
    ).length;
    expect(crossingCount).toBeGreaterThan(5);

    // Also verify the OPPOSITE direction (price moving DOWN). Uniswap v3 sign
    // convention: on a downward cross the pool does `liquidity -= net[T]`, which
    // means the sparse walker must subtract (not add) across the same edges,
    // and the window is `newTick < T <= oldTick` (at-or-below oldTick, strictly
    // above newTick). Seeding stakedLiq with the result of the up-swap gives us
    // round-trip parity: up then down should land back on the starting liquidity.
    const oldTickDown = newTick;
    const newTickDown = oldTick;
    let baselineDownResult = baselineResult;
    for (const [tick, net] of baselineNet.entries()) {
      if (tick > newTickDown && tick <= oldTickDown) {
        baselineDownResult -= net;
      }
    }

    const downResult = processTickCrossingsForStaked(
      chainId,
      mockPoolAddress,
      oldTickDown,
      newTickDown,
      10n,
      noDbContext,
      baselineResult,
      true,
      edges,
      nets,
    );

    expect(downResult).toBe(baselineDownResult);
    // Round-trip parity: up-swap then down-swap over the same window must
    // return stakedLiq to its starting value (0n in this test).
    expect(downResult).toBe(0n);
    expect(noDbContext.CLTickStaked.get).not.toHaveBeenCalled();
  });
});
