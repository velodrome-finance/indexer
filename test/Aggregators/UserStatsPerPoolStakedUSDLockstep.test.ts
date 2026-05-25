import { updateUserStatsPerPool } from "../../src/Aggregators/UserStatsPerPool";
import { toChecksumAddress } from "../../src/Constants";
import { setupCommon } from "../EventHandlers/Pool/common";

/**
 * Issue #782: the staked units counter (currentLiquidityStaked) and its USD
 * companion (currentLiquidityStakedUSD) must reach 0 together on the LIVE
 * entity, not only at snapshot boundaries. Before the fix, a full unstake
 * between snapshots drove units -> 0 but left the USD companion sticky,
 * producing rows with currentLiquidityStaked=0 / currentLiquidityStakedUSD>0
 * (~$1T phantom in WETH/PEPE, amplified by the PEPE misprice).
 *
 * These tests exercise the NON-snapshot path: lastSnapshotTimestamp sits in the
 * same hour-epoch as the event timestamp, so shouldSnapshot() returns false and
 * the snapshot-time recompute block (which already zeroes USD when units hit 0)
 * is skipped.
 */
describe("UserStatsPerPool staked-USD lockstep on live path (issue #782)", () => {
  let common: ReturnType<typeof setupCommon>;

  const mockChainId = 10;
  const mockPoolAddress = toChecksumAddress(
    "0xabcdef1234567890abcdef1234567890abcdef12",
  );
  const mockUserAddress = toChecksumAddress(
    "0x1234567890123456789012345678901234567890",
  );

  // The entity was last snapshotted in this same hour-epoch, so the update
  // below does NOT cross an epoch boundary -> no snapshot recompute fires.
  const sameEpochTimestamp = new Date(1_000_000 * 1000);

  beforeEach(() => {
    common = setupCommon();
  });

  // Minimal context: the snapshot block is skipped, so the only context call
  // exercised is the final UserStatsPerPool.set().
  function buildMockContext() {
    return common.createMockContext({
      UserStatsPerPool: { set: async () => {} },
      log: { error: () => {}, warn: () => {}, info: () => {} },
    });
  }

  it("zeroes currentLiquidityStakedUSD in lockstep on a full unstake", async () => {
    const ctx = buildMockContext();
    const userStats = common.createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      currentLiquidityStaked: 1_000_000n,
      currentLiquidityStakedUSD: 5_000n, // stale positive USD from a prior stake
      lastSnapshotTimestamp: sameEpochTimestamp,
      lastActivityTimestamp: sameEpochTimestamp,
    });

    const result = await updateUserStatsPerPool(
      {
        incrementalCurrentLiquidityStaked: -1_000_000n, // full unstake -> units 0
        lastActivityTimestamp: sameEpochTimestamp,
      },
      userStats,
      ctx,
      sameEpochTimestamp,
    );

    expect(result.currentLiquidityStaked).toBe(0n);
    expect(result.currentLiquidityStakedUSD).toBe(0n);
  });

  it("leaves currentLiquidityStakedUSD sticky on a partial unstake (units stay > 0)", async () => {
    const ctx = buildMockContext();
    const userStats = common.createMockUserStatsPerPool({
      userAddress: mockUserAddress,
      poolAddress: mockPoolAddress,
      chainId: mockChainId,
      currentLiquidityStaked: 1_000_000n,
      currentLiquidityStakedUSD: 5_000n,
      lastSnapshotTimestamp: sameEpochTimestamp,
      lastActivityTimestamp: sameEpochTimestamp,
    });

    const result = await updateUserStatsPerPool(
      {
        incrementalCurrentLiquidityStaked: -400_000n, // partial -> units 600k
        lastActivityTimestamp: sameEpochTimestamp,
      },
      userStats,
      ctx,
      sameEpochTimestamp,
    );

    expect(result.currentLiquidityStaked).toBe(600_000n);
    // The lockstep zeroing fires only when units reach 0. While units remain
    // positive, USD is refreshed at snapshot time, so on the live path it stays
    // at its prior value — the fix must not over-zero or recompute here.
    expect(result.currentLiquidityStakedUSD).toBe(5_000n);
  });
});
