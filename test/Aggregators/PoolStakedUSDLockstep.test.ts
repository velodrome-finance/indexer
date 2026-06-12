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
