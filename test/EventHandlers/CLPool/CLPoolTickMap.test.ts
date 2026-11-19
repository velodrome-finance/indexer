import { createTestIndexer } from "envio";
import { segmentReserveDelta } from "../../../src/Aggregators/CLStakedLiquidity";
import { toChecksumAddress } from "../../../src/Constants";
import { normalizeTokenAmountTo1e18 } from "../../../src/Helpers";
import { sqrtAt } from "../../Aggregators/common";
import { registerCLPool } from "../../registerDynamicContracts";
import { setupCommon } from "../Pool/common";

// The per-tick liquidityNet maps live on the Postgres-only PoolTickMap entity:
// written by Mint / Burn when the map changes, read (never written) by Swap.
describe("CLPool handlers and PoolTickMap", () => {
  const { mockToken0Data, mockToken1Data, createMockPool } = setupCommon();
  const chainId = 10 as const;
  const owner = toChecksumAddress("0x2222222222222222222222222222222222222222");
  const L = 10n ** 24n;
  const tickLower = -1000n;
  const tickUpper = 1000n;
  const hash = `0x${"1".repeat(64)}`;

  const block = (n: number, timestamp: number) => ({
    number: n,
    timestamp,
    hash,
  });
  const mint = (n: number, ts: number, amount = L) => ({
    contract: "CLPool" as const,
    event: "Mint" as const,
    logIndex: 1,
    block: block(n, ts),
    transaction: { hash },
    params: {
      sender: owner,
      owner,
      tickLower,
      tickUpper,
      amount,
      amount0: 1_000n,
      amount1: 1_000n,
    },
  });
  const burn = (
    n: number,
    ts: number,
    amount: bigint,
    amount0 = 0n,
    amount1 = 0n,
  ) => ({
    contract: "CLPool" as const,
    event: "Burn" as const,
    logIndex: 1,
    block: block(n, ts),
    transaction: { hash },
    params: { owner, tickLower, tickUpper, amount, amount0, amount1 },
  });

  async function setup(overrides: Parameters<typeof createMockPool>[0] = {}) {
    const indexer = createTestIndexer();
    const pool = createMockPool({
      isCL: true,
      tick: 0n,
      sqrtPriceX96: sqrtAt(0n),
      tickSpacing: 1n,
      liquidityInRange: 0n,
      currentFee: 3000n,
      baseFee: 3000n,
      ...overrides,
    });
    await registerCLPool(indexer, chainId, pool.poolAddress);
    indexer.Pool.set(pool);
    indexer.Token.set(mockToken0Data);
    indexer.Token.set(mockToken1Data);
    return { indexer, pool };
  }

  it("Mint writes the map; a Swap reads it, derives the fee and writes no map", async () => {
    const { indexer, pool } = await setup();

    // Token1-in swap from tick 0 to tick 10, inside the minted range.
    const seg = segmentReserveDelta(L, sqrtAt(0n), sqrtAt(10n));
    const fee = (seg.delta1 * 500n + 999_500n - 1n) / 999_500n; // 0.05%, rounded up
    const swap = {
      contract: "CLPool" as const,
      event: "Swap" as const,
      srcAddress: pool.poolAddress as `0x${string}`,
      logIndex: 2,
      block: block(1_000_001, 1_000_002),
      transaction: { hash, from: owner },
      params: {
        sender: owner,
        recipient: owner,
        amount0: seg.delta0,
        amount1: seg.delta1 + fee,
        sqrtPriceX96: sqrtAt(10n),
        liquidity: L,
        tick: 10n,
      },
    };

    const { changes } = await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              ...mint(1_000_000, 1_000_000),
              srcAddress: pool.poolAddress as `0x${string}`,
            },
            swap,
          ],
        },
      },
    } as never);

    const map = await indexer.PoolTickMap.get(pool.id);
    expect(map?.tickEdges).toEqual([tickLower, tickUpper]);
    expect(map?.tickEdgeNets).toEqual([L, -L]);
    expect(map?.stakedTickEdges).toEqual([]);

    const mintChange = changes.find((c) => c.block === 1_000_000);
    const swapChange = changes.find((c) => c.block === 1_000_001);
    expect(mintChange?.PoolTickMap).toBeDefined();
    expect(swapChange?.Pool).toBeDefined();
    expect(swapChange?.PoolTickMap).toBeUndefined();

    const updated = await indexer.Pool.get(pool.id);
    expect(updated?.liquidityInRange).toBe(L);
    expect(updated?.numberOfSwapFeeFallbacks).toBe(0n);
    expect(updated?.currentFee).toBe(500n);
    expect(
      (updated?.totalFeesGenerated1 ?? 0n) - pool.totalFeesGenerated1,
    ).toBe(normalizeTokenAmountTo1e18(fee, Number(mockToken1Data.decimals)));
  });

  it("a Burn that empties the position rewrites the map; Mint-0 writes nothing", async () => {
    const { indexer, pool } = await setup();
    const { changes } = await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              ...mint(1_000_000, 1_000_000),
              srcAddress: pool.poolAddress as `0x${string}`,
            },
            {
              ...burn(1_000_001, 1_000_001, L, 1_000n, 1_000n),
              srcAddress: pool.poolAddress as `0x${string}`,
            },
            {
              ...mint(1_000_002, 1_000_002, 0n),
              srcAddress: pool.poolAddress as `0x${string}`,
            },
          ],
        },
      },
    } as never);

    const map = await indexer.PoolTickMap.get(pool.id);
    expect(map?.tickEdges).toEqual([]);
    expect(map?.tickEdgeNets).toEqual([]);
    expect(
      changes.find((c) => c.block === 1_000_001)?.PoolTickMap,
    ).toBeDefined();
    expect(
      changes.find((c) => c.block === 1_000_002)?.PoolTickMap,
    ).toBeUndefined();
  });

  it("Mint re-derives the staked in-range liquidity when the pool has stakes", async () => {
    // A counter clamped to the old total (#891) must not survive the total
    // growing, since swaps trust 0 < staked < total as map-derived.
    const S = L / 4n;
    const { indexer, pool } = await setup({
      hasStakes: true,
      liquidityInRange: S / 2n,
      stakedLiquidityInRange: S / 2n,
    });
    indexer.PoolTickMap.set({
      id: pool.id,
      chainId,
      tickEdges: [-5000n, 5000n],
      tickEdgeNets: [S / 2n, -(S / 2n)],
      stakedTickEdges: [-2000n, 2000n],
      stakedTickEdgeNets: [S, -S],
    });
    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              ...mint(1_000_000, 1_000_000),
              srcAddress: pool.poolAddress as `0x${string}`,
            },
          ],
        },
      },
    } as never);
    const updated = await indexer.Pool.get(pool.id);
    expect(updated?.liquidityInRange).toBe(S / 2n + L);
    expect(updated?.stakedLiquidityInRange).toBe(S);
  });

  it("a zero-amount Burn (poke) within the snapshot hour writes nothing", async () => {
    const ts = 1_000_000;
    const { indexer, pool } = await setup({
      lastSnapshotTimestamp: new Date(ts * 1000),
    });
    const { changes } = await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              ...burn(1_000_000, ts + 10, 0n),
              srcAddress: pool.poolAddress as `0x${string}`,
            },
          ],
        },
      },
    } as never);

    const change = changes.find((c) => c.block === 1_000_000);
    expect(change?.Pool).toBeUndefined();
    expect(change?.PoolTickMap).toBeUndefined();
    expect(change?.CLPositionPendingPrincipal).toBeUndefined();
    expect(change?.UserStatsPerPool).toBeUndefined();
  });

  it("a poke that opens a new snapshot hour still writes the Pool and its snapshot", async () => {
    const ts = 1_000_000;
    const { indexer, pool } = await setup({
      lastSnapshotTimestamp: new Date(0),
    });
    const { changes } = await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              ...burn(1_000_000, ts, 0n),
              srcAddress: pool.poolAddress as `0x${string}`,
            },
          ],
        },
      },
    } as never);

    const change = changes.find((c) => c.block === 1_000_000);
    expect(change?.Pool).toBeDefined();
    expect(change?.PoolSnapshot).toBeDefined();
    expect(change?.PoolTickMap).toBeUndefined();
    const updated = await indexer.Pool.get(pool.id);
    expect(updated?.reserve0).toBe(pool.reserve0);
    expect(updated?.reserve1).toBe(pool.reserve1);
  });
});
