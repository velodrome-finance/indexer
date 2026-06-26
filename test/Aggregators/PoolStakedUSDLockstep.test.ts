import { updatePool } from "../../src/Aggregators/Pool";
import { toChecksumAddress } from "../../src/Constants";
import type { Pool, handlerContext } from "../../src/EntityTypes";
import { setupCommon } from "../EventHandlers/Pool/common";

/**
 * Issue #857 (residual of #782): the Pool aggregator must honour the same
 * staked-USD lockstep invariant that PR #792 added to UserStatsPerPool —
 * `currentLiquidityStaked === 0n ⇒ currentLiquidityStakedUSD === 0n` — on the
 * live entity, not only at snapshot boundaries.
 *
 * Root cause for the 2 residual Ink pool rows surfaced by the 2026-06-10
 * integrity audit: on the CL gauge withdraw path,
 * `computeCLStakedReservesOnGaugeEvent` early-returns `{}` (no `poolStakedUSD`)
 * when `tokenId` is undefined, `nfpmAddress` is missing, or the position cannot
 * be rehydrated. The diff then leaves `currentLiquidityStakedUSD` unset,
 * `updatePool` falls back to `current.currentLiquidityStakedUSD`, and a full
 * unstake drives units → 0 while the USD companion stays sticky.
 *
 * The lockstep clamp at the tail of `updatePool` enforces the invariant on
 * every write so no future caller can drift.
 */
describe("Pool staked-USD lockstep on live path (issue #857)", () => {
  let common: ReturnType<typeof setupCommon>;

  const chainId = 10;
  const poolAddress = toChecksumAddress(
    "0xabcdef1234567890abcdef1234567890abcdef12",
  );
  const factoryAddress = toChecksumAddress(
    "0x548118C7E0B865C2CfA94D15EC86B666468ac758",
  );

  // The entity was last snapshotted in this same hour-epoch, so the update
  // below does NOT cross an epoch boundary -> no snapshot recompute fires.
  const sameEpochTimestamp = new Date(1_000_000 * 1000);

  beforeEach(() => {
    common = setupCommon();
  });

  function buildMockContext(setMock: ReturnType<typeof vi.fn>) {
    return common.createMockContext({
      Pool: { set: setMock },
      log: { error: () => {}, warn: () => {}, info: () => {} },
    }) as unknown as handlerContext;
  }

  it("zeroes currentLiquidityStakedUSD on a full unstake even when the diff omits the USD field (CL pool)", async () => {
    // Simulates the CL gauge withdraw early-return path where
    // computeCLStakedReservesOnGaugeEvent returns {} (no poolStakedUSD) — e.g.
    // when nfpmAddress is missing or the NonFungiblePosition cannot be
    // rehydrated. The diff carries only the units decrement.
    const pool = common.createMockPool({
      poolAddress,
      chainId,
      isCL: true,
      lastSnapshotTimestamp: sameEpochTimestamp,
      lastUpdatedTimestamp: sameEpochTimestamp,
      currentLiquidityStaked: 1_000_000n,
      currentLiquidityStakedUSD: 4_126n, // stale residue mirroring the audit value
      factoryAddress,
    });

    const setMock = vi.fn();
    const ctx = buildMockContext(setMock);

    await updatePool(
      {
        incrementalCurrentLiquidityStaked: -1_000_000n, // full unstake -> units 0
      },
      pool,
      sameEpochTimestamp,
      ctx,
      chainId,
      131_536_921,
    );

    const updated = setMock.mock.calls[0]?.[0] as Pool;
    expect(updated.currentLiquidityStaked).toBe(0n);
    expect(updated.currentLiquidityStakedUSD).toBe(0n);
  });

  it("zeroes currentLiquidityStakedUSD on a full unstake for a non-CL pool when the diff omits the USD field", async () => {
    // Mirrors the non-CL gauge path when computeNonCLStakedUSDIfAvailable
    // returns undefined (totalLPTokenSupply missing/zero). The diff leaves
    // currentLiquidityStakedUSD as `undefined`; the clamp must still fire.
    const pool = common.createMockPool({
      poolAddress,
      chainId,
      isCL: false,
      lastSnapshotTimestamp: sameEpochTimestamp,
      lastUpdatedTimestamp: sameEpochTimestamp,
      currentLiquidityStaked: 500n,
      currentLiquidityStakedUSD: 4_126n,
    });

    const setMock = vi.fn();
    const ctx = buildMockContext(setMock);

    await updatePool(
      {
        incrementalCurrentLiquidityStaked: -500n,
      },
      pool,
      sameEpochTimestamp,
      ctx,
      chainId,
      131_536_921,
    );

    const updated = setMock.mock.calls[0]?.[0] as Pool;
    expect(updated.currentLiquidityStaked).toBe(0n);
    expect(updated.currentLiquidityStakedUSD).toBe(0n);
  });

  it("leaves currentLiquidityStakedUSD sticky on a partial unstake (units stay > 0)", async () => {
    // The lockstep clamp must NOT over-zero: while units remain positive the
    // USD companion is refreshed by the snapshot path / gauge recompute, so
    // on the live non-snapshot path it stays at its prior value.
    const pool = common.createMockPool({
      poolAddress,
      chainId,
      isCL: false,
      lastSnapshotTimestamp: sameEpochTimestamp,
      lastUpdatedTimestamp: sameEpochTimestamp,
      currentLiquidityStaked: 1_000_000n,
      currentLiquidityStakedUSD: 5_000n,
    });

    const setMock = vi.fn();
    const ctx = buildMockContext(setMock);

    await updatePool(
      {
        incrementalCurrentLiquidityStaked: -400_000n, // partial -> units 600k
      },
      pool,
      sameEpochTimestamp,
      ctx,
      chainId,
      131_536_921,
    );

    const updated = setMock.mock.calls[0]?.[0] as Pool;
    expect(updated.currentLiquidityStaked).toBe(600_000n);
    expect(updated.currentLiquidityStakedUSD).toBe(5_000n);
  });
});

/**
 * Issue #890 (residual of #857): the lockstep clamp at the tail of `updatePool`
 * is re-broken at snapshot-epoch boundaries by the CL-only staked-USD recompute
 * inside the `shouldSnapshot` block. That block values the running
 * `stakedReserve0/1` accumulators via `calculateTotalUSD`; on a full unstake
 * `currentLiquidityStaked` reaches `0n` while `stakedReserve0/1` can still hold
 * wei-scale dust (they are independent accumulators). The recompute then
 * overwrites the just-applied `0n`, producing `currentLiquidityStaked === 0n`
 * alongside `currentLiquidityStakedUSD > 0n` — exactly the 2 rows (Base + Ink)
 * surfaced by the 2026-06-19 integrity audit.
 *
 * These tests cross an epoch boundary (unlike the #857 tests above, which stay
 * in-epoch and never enter the snapshot block) so the CL recompute actually
 * fires.
 */
describe("Pool staked-USD lockstep on the CL snapshot recompute path (issue #890)", () => {
  let common: ReturnType<typeof setupCommon>;

  const chainId = 10;
  // Address mirrors the Base audit row; reused on the test chain (10) so the
  // default mock tokens (chain-10 ids) line up with the pool's token ids.
  const poolAddress = toChecksumAddress(
    "0xa4FDd479eda160671636e2eCF8f993Cbf86258a8",
  );
  const factoryAddress = toChecksumAddress(
    "0x548118C7E0B865C2CfA94D15EC86B666468ac758",
  );

  // lastSnapshotTimestamp sits in an earlier hour-epoch than the update, so
  // shouldSnapshot() fires and the CL stakedReserve-based USD recompute runs.
  const lastSnapshot = new Date(1_000_000 * 1000);
  const newEpochTimestamp = new Date((1_000_000 + 7_200) * 1000); // +2h -> new epoch

  beforeEach(() => {
    common = setupCommon();
  });

  function buildMockContext(setMock: ReturnType<typeof vi.fn>) {
    const ctx = common.createMockContext({
      Pool: { set: setMock },
      PoolSnapshot: { set: vi.fn() },
      Token: {
        get: vi.fn(async (id: string) =>
          id === common.mockToken1Data.id
            ? common.mockToken1Data
            : common.mockToken0Data,
        ),
      },
      log: { error: () => {}, warn: () => {}, info: () => {} },
    }) as unknown as handlerContext;
    // `effect` is a top-level context fn, not an entity store, so it's attached
    // after construction. getSwapFee (via updateDynamicFeePools) -> undefined
    // skips the dynamic-fee update; the test only exercises the staked-USD recompute.
    (ctx as unknown as { effect: unknown }).effect = vi.fn(
      async () => undefined,
    );
    return ctx;
  }

  it("keeps currentLiquidityStakedUSD at 0n on a full unstake even when stakedReserve dust remains (snapshot boundary, CL pool)", async () => {
    const pool = common.createMockPool({
      poolAddress,
      chainId,
      isCL: true,
      factoryAddress,
      lastSnapshotTimestamp: lastSnapshot,
      lastUpdatedTimestamp: lastSnapshot,
      currentLiquidityStaked: 1_000_000n,
      currentLiquidityStakedUSD: 4_126n, // stale residue mirroring the audit value
      // Wei-scale dust left on the running staked-reserve accumulators after a
      // full unstake. token0 is 18-dec @ $1, so the buggy recompute would value
      // this at ~152000000000014n — the Base audit row's currentLiquidityStakedUSD.
      stakedReserve0: 152_000_000_000_014n,
      stakedReserve1: 0n,
    });

    const setMock = vi.fn();
    const ctx = buildMockContext(setMock);

    await updatePool(
      { incrementalCurrentLiquidityStaked: -1_000_000n }, // full unstake -> units 0
      pool,
      newEpochTimestamp,
      ctx,
      chainId,
      131_536_921,
    );

    const updated = setMock.mock.calls[0]?.[0] as Pool;
    expect(updated.currentLiquidityStaked).toBe(0n);
    expect(updated.currentLiquidityStakedUSD).toBe(0n);
  });

  it("still computes currentLiquidityStakedUSD from stakedReserves when units stay > 0 (snapshot boundary, CL pool)", async () => {
    // Guard-rail for AC #2: the non-zero path must be unchanged — staked USD is
    // still derived from the staked reserves at the snapshot boundary.
    const pool = common.createMockPool({
      poolAddress,
      chainId,
      isCL: true,
      factoryAddress,
      lastSnapshotTimestamp: lastSnapshot,
      lastUpdatedTimestamp: lastSnapshot,
      currentLiquidityStaked: 1_000_000n,
      currentLiquidityStakedUSD: 0n,
      stakedReserve0: 152_000_000_000_014n,
      stakedReserve1: 0n,
    });

    const setMock = vi.fn();
    const ctx = buildMockContext(setMock);

    await updatePool(
      { incrementalCurrentLiquidityStaked: -400_000n }, // partial -> units 600k
      pool,
      newEpochTimestamp,
      ctx,
      chainId,
      131_536_921,
    );

    const updated = setMock.mock.calls[0]?.[0] as Pool;
    expect(updated.currentLiquidityStaked).toBe(600_000n);
    // 18-dec token @ $1 -> USD == reserve dust value.
    expect(updated.currentLiquidityStakedUSD).toBe(152_000_000_000_014n);
  });
});
