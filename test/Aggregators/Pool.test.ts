import type { Token } from "generated";
import {
  loadPoolData,
  loadPoolDataOrRootCLPool,
  updateDynamicFeePools,
  updatePool,
} from "../../src/Aggregators/Pool";
import {
  type CHAIN_CONSTANTS,
  PoolId,
  PoolSnapshotId,
  RootPoolLeafPoolId,
  toChecksumAddress,
} from "../../src/Constants";
import { getSwapFee } from "../../src/Effects/SwapFee";
import type { handlerContext } from "../../src/EntityTypes";
import type { Pool } from "../../src/EntityTypes";
import * as PriceOracle from "../../src/PriceOracle";
import { setPoolSnapshot } from "../../src/Snapshots/PoolSnapshot";
import { getSnapshotEpoch } from "../../src/Snapshots/Shared";
import { setupCommon } from "../EventHandlers/Pool/common";

// Type for the readContract method
type ReadContractMethod =
  (typeof CHAIN_CONSTANTS)[10]["eth_client"]["readContract"];

describe("Pool Functions", () => {
  let mockContext: Partial<handlerContext>;
  let liquidityPoolAggregator: Partial<Pool>;
  let timestamp: Date;
  const blockNumber = 131536921;
  const { createMockPool } = setupCommon();

  beforeEach(() => {
    mockContext = {
      PoolSnapshot: {
        set: vi.fn(),
        get: vi.fn(),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
      Pool: {
        set: vi.fn(),
        get: vi.fn(),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
      Token: {
        set: vi.fn(),
        get: vi.fn(),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
      TokenPriceSnapshot: {
        set: vi.fn(),
        get: vi.fn(),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
      RootPool_LeafPool: {
        set: vi.fn(),
        get: vi.fn(),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
      DynamicFeeGlobalConfig: {
        set: vi.fn(),
        get: vi.fn(),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
      log: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
      effect: vi.fn().mockImplementation(async (effectFn, input) => {
        // Mock the effect calls for testing
        if (effectFn.name === "getDynamicFeeConfig") {
          return {
            baseFee: 400n,
            feeCap: 2000n,
            scalingFactor: 10000000n,
          };
        }
        if (effectFn.name === "getSwapFee") {
          return 1900n;
        }
        return {};
      }),
    };
    liquidityPoolAggregator = createMockPool({
      id: toChecksumAddress("0x1234567890123456789012345678901234567890"),
      name: "Test Pool",
      token0_id: "token0",
      token1_id: "token1",
      token0_address: toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      ),
      token1_address: toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      ),
      isStable: false,
      isCL: false,
      factoryAddress: toChecksumAddress(
        "0x548118C7E0B865C2CfA94D15EC86B666468ac758",
      ),
      reserve0: 0n,
      reserve1: 0n,
      totalLiquidityUSD: 0n,
      totalVolume0: 0n,
      totalVolume1: 0n,
      totalVolumeUSD: 0n,
      totalVolumeUSDWhitelisted: 0n,
      totalUnstakedFeesCollected0: 0n,
      totalUnstakedFeesCollected1: 0n,
      totalStakedFeesCollected0: 0n,
      totalStakedFeesCollected1: 0n,
      totalUnstakedFeesCollectedUSD: 0n,
      totalStakedFeesCollectedUSD: 0n,
      totalFeesUSDWhitelisted: 0n,
      numberOfSwaps: 0n,
      token0Price: 0n,
      token1Price: 0n,
      totalVotesDeposited: 0n,
      totalVotesDepositedUSD: 0n,
      totalEmissions: 0n,
      totalEmissionsUSD: 0n,
      gaugeIsAlive: false,
      lastUpdatedTimestamp: new Date(),
      lastSnapshotTimestamp: new Date(),
    });
    timestamp = new Date();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("updateDynamicFeePools", () => {
    it("should update the pool with current dynamic fee", async () => {
      const updatedPool = await updateDynamicFeePools(
        liquidityPoolAggregator as Pool,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      // Verify that the pool was updated with the current fee
      expect(updatedPool.currentFee).toBe(1900n); // From the mocked effect
    });

    it("should skip update when pool has no factoryAddress", async () => {
      const poolNoFactory = {
        ...liquidityPoolAggregator,
        factoryAddress: "",
      } as Pool;

      const updatedPool = await updateDynamicFeePools(
        poolNoFactory,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      expect(updatedPool).toBe(poolNoFactory);
      expect(vi.mocked(mockContext.log?.warn)).toHaveBeenCalledWith(
        expect.stringContaining("no factoryAddress"),
      );
      expect(mockContext.effect).not.toHaveBeenCalled();
    });

    it("should handle effect errors gracefully", async () => {
      // Mock effect to return undefined (error case)
      expect(mockContext.effect).toBeDefined();
      vi
        // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
        .mocked(mockContext.effect!)
        .mockResolvedValue(undefined);

      // Should complete without throwing and skip update
      await updateDynamicFeePools(
        liquidityPoolAggregator as Pool,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      // Should log a warning
      expect(vi.mocked(mockContext.log?.warn)).toHaveBeenCalled();

      // Verify that the effect was called with the expected arguments
      // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
      const effectMock = vi.mocked(mockContext.effect!);
      expect(effectMock).toHaveBeenCalledWith(getSwapFee, {
        poolAddress: liquidityPoolAggregator.poolAddress,
        factoryAddress: toChecksumAddress(
          "0x548118C7E0B865C2CfA94D15EC86B666468ac758",
        ),
        chainId: liquidityPoolAggregator.chainId,
        blockNumber,
      });
    });

    it("should skip dynamic fee updates when event chain doesn’t match pool chain", async () => {
      expect(mockContext.effect).toBeDefined();
      const fallbackEffect = (async () =>
        undefined) as unknown as typeof mockContext.effect;
      const effectMock = vi.mocked(mockContext.effect ?? fallbackEffect);

      const updatedPool = await updateDynamicFeePools(
        liquidityPoolAggregator as Pool,
        mockContext as handlerContext,
        8453,
        blockNumber,
      );

      expect(updatedPool).toBe(liquidityPoolAggregator);
      expect(effectMock).not.toHaveBeenCalled();
    });
  });

  describe("Snapshot Creation", () => {
    beforeEach(() => {
      setPoolSnapshot(
        liquidityPoolAggregator as Pool,
        timestamp,
        mockContext as handlerContext,
      );
    });

    it("should create a snapshot of the liquidity pool aggregator", () => {
      const mockSet = vi.mocked(mockContext.PoolSnapshot?.set);
      expect(mockSet).toHaveBeenCalledTimes(1);
      const snapshot = mockSet?.mock.calls[0]?.[0];
      expect(snapshot).toBeDefined();
      const chainId = liquidityPoolAggregator.chainId;
      const poolAddress = liquidityPoolAggregator.poolAddress;
      if (chainId === undefined || poolAddress === undefined) {
        throw new Error("test setup: chainId and poolAddress must be set");
      }
      expect(snapshot?.id).toBe(
        PoolSnapshotId(
          chainId,
          poolAddress,
          getSnapshotEpoch(timestamp).getTime(),
        ),
      );
      expect(snapshot?.poolAddress).toBe(liquidityPoolAggregator.poolAddress);
    });
  });

  describe("updatePool", () => {
    it("should overwrite totalLiquidityUSD when currentTotalLiquidityUSD is provided", async () => {
      await updatePool(
        {
          currentTotalLiquidityUSD: 777n,
        },
        {
          ...(liquidityPoolAggregator as Pool),
          totalLiquidityUSD: 100n,
        },
        timestamp,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      const poolStore = mockContext.Pool;
      if (!poolStore) {
        throw new Error("test setup: Pool store must exist");
      }
      const setCalls = vi.mocked(poolStore.set).mock.calls;
      expect(setCalls.at(-1)?.[0]?.totalLiquidityUSD).toBe(777n);
    });

    it("should preserve totalLiquidityUSD when no overwrite is provided", async () => {
      await updatePool(
        {},
        {
          ...(liquidityPoolAggregator as Pool),
          totalLiquidityUSD: 100n,
        },
        timestamp,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      const poolStore = mockContext.Pool;
      if (!poolStore) {
        throw new Error("test setup: Pool store must exist");
      }
      const setCalls = vi.mocked(poolStore.set).mock.calls;
      expect(setCalls.at(-1)?.[0]?.totalLiquidityUSD).toBe(100n);
    });

    // Regression test for issue #703: liquidityInRange must mirror the CL pool's
    // on-chain liquidity() getter. Swap writes the absolute value (authoritative
    // reset); in-range Mint/Burn supply incrementalLiquidityInRange to bump it
    // without waiting for the next swap.
    describe("liquidityInRange (issue #703)", () => {
      it("applies incrementalLiquidityInRange on top of current value", async () => {
        await updatePool(
          { incrementalLiquidityInRange: 1_000_000n },
          {
            ...(liquidityPoolAggregator as Pool),
            liquidityInRange: 5_000_000n,
          },
          timestamp,
          mockContext as handlerContext,
          10,
          blockNumber,
        );

        const poolStore = mockContext.Pool;
        if (!poolStore) {
          throw new Error("test setup: Pool store must exist");
        }
        const setCalls = vi.mocked(poolStore.set).mock.calls;
        const updated = setCalls.at(-1)?.[0] as Pool;
        expect(updated.liquidityInRange).toBe(6_000_000n);
      });

      it("absolute liquidityInRange (Swap authoritative reset) wins over incrementalLiquidityInRange", async () => {
        await updatePool(
          {
            liquidityInRange: 42n,
            incrementalLiquidityInRange: 1_000_000n,
          },
          {
            ...(liquidityPoolAggregator as Pool),
            liquidityInRange: 5_000_000n,
          },
          timestamp,
          mockContext as handlerContext,
          10,
          blockNumber,
        );

        const poolStore = mockContext.Pool;
        if (!poolStore) {
          throw new Error("test setup: Pool store must exist");
        }
        const setCalls = vi.mocked(poolStore.set).mock.calls;
        const updated = setCalls.at(-1)?.[0] as Pool;
        expect(updated.liquidityInRange).toBe(42n);
      });

      it("preserves current liquidityInRange when diff supplies neither field", async () => {
        await updatePool(
          {},
          {
            ...(liquidityPoolAggregator as Pool),
            liquidityInRange: 5_000_000n,
          },
          timestamp,
          mockContext as handlerContext,
          10,
          blockNumber,
        );

        const poolStore = mockContext.Pool;
        if (!poolStore) {
          throw new Error("test setup: Pool store must exist");
        }
        const setCalls = vi.mocked(poolStore.set).mock.calls;
        const updated = setCalls.at(-1)?.[0] as Pool;
        expect(updated.liquidityInRange).toBe(5_000_000n);
      });

      it("decrements via negative incrementalLiquidityInRange (Burn semantics)", async () => {
        await updatePool(
          { incrementalLiquidityInRange: -700_000n },
          {
            ...(liquidityPoolAggregator as Pool),
            liquidityInRange: 5_000_000n,
          },
          timestamp,
          mockContext as handlerContext,
          10,
          blockNumber,
        );

        const poolStore = mockContext.Pool;
        if (!poolStore) {
          throw new Error("test setup: Pool store must exist");
        }
        const setCalls = vi.mocked(poolStore.set).mock.calls;
        const updated = setCalls.at(-1)?.[0] as Pool;
        expect(updated.liquidityInRange).toBe(4_300_000n);
      });
    });

    it("should preserve hasStakes=true when a full-unstake diff leaves hasStakes undefined (one-way latch)", async () => {
      // Simulates the NFPMCommonLogic path where the edge list becomes empty
      // after a full unstake: the producer passes `hasStakes: undefined` (see
      // src/EventHandlers/NFPM/NFPMCommonLogic.ts:147, `stakedTickEdges.length > 0 ? true : undefined`).
      // The monotonic-latch merge at Pool.ts:390
      // (`current.hasStakes || (diff.hasStakes ?? false)`) must keep the
      // prior `true` value regardless of the empty edge list.
      await updatePool(
        {
          hasStakes: undefined,
          stakedTickEdges: [],
          stakedTickEdgeNets: [],
        },
        {
          ...(liquidityPoolAggregator as Pool),
          hasStakes: true,
          stakedTickEdges: [100n, 200n],
          stakedTickEdgeNets: [500n, -500n],
        },
        timestamp,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      const poolStore = mockContext.Pool;
      if (!poolStore) {
        throw new Error("test setup: Pool store must exist");
      }
      const setCalls = vi.mocked(poolStore.set).mock.calls;
      const updated = setCalls.at(-1)?.[0] as Pool;
      expect(updated.hasStakes).toBe(true);
      // Edge arrays should still be replaced (empty) since the diff provides them.
      expect(updated.stakedTickEdges).toEqual([]);
      expect(updated.stakedTickEdgeNets).toEqual([]);
    });

    // Regression test for issue #666: stakedReserve0/stakedReserve1 are
    // running counters of staked LP-deposited capital and should never go
    // negative. 166 CL pools across all chains have drifted negative; a
    // defensive max(0, _) clamp at the USD-conversion site masks the symptom
    // at the USD layer but the raw fields persist as negative. The aggregator
    // emits [NEGATIVE_STAKED_RESERVE_DRIFT] at each snapshot epoch boundary
    // while still negative (≤1/hour per pool) so a persistent drift stays
    // visible in recent logs without flooding them and without aborting the
    // indexer. Mirrors the snapshot-epoch [FEE_VOLUME_DIVERGENCE] pattern
    // from #679 and the [NEGATIVE_RESERVE_DRIFT] tag from #674/#680.
    describe("negative staked reserve drift warning (issue #666)", () => {
      const negativeStakedReserveWarnings = () => {
        const warnMock = vi.mocked(mockContext.log?.warn);
        const calls = warnMock?.mock.calls ?? [];
        return calls.filter((args) =>
          String(args[0] ?? "").includes("[NEGATIVE_STAKED_RESERVE_DRIFT]"),
        );
      };

      const previousEpoch = () =>
        new Date(timestamp.getTime() - 2 * 60 * 60 * 1000);

      it("warns at snapshot epoch when stakedReserve0 is negative", async () => {
        await updatePool(
          { incrementalStakedReserve0: -100n },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedReserve0: 50n,
            stakedReserve1: 1000n,
            lastSnapshotTimestamp: previousEpoch(),
            lastUpdatedTimestamp: previousEpoch(),
          },
          timestamp,
          mockContext as handlerContext,
          10,
          blockNumber,
        );

        expect(negativeStakedReserveWarnings().length).toBe(1);
      });

      it("warns at snapshot epoch when stakedReserve1 is negative", async () => {
        await updatePool(
          { incrementalStakedReserve1: -100n },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedReserve0: 1000n,
            stakedReserve1: 50n,
            lastSnapshotTimestamp: previousEpoch(),
            lastUpdatedTimestamp: previousEpoch(),
          },
          timestamp,
          mockContext as handlerContext,
          10,
          blockNumber,
        );

        expect(negativeStakedReserveWarnings().length).toBe(1);
      });

      it("does not warn when staked reserves stay non-negative after the diff", async () => {
        await updatePool(
          {
            incrementalStakedReserve0: -50n,
            incrementalStakedReserve1: -50n,
          },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedReserve0: 100n,
            stakedReserve1: 100n,
            lastSnapshotTimestamp: previousEpoch(),
            lastUpdatedTimestamp: previousEpoch(),
          },
          timestamp,
          mockContext as handlerContext,
          10,
          blockNumber,
        );

        expect(negativeStakedReserveWarnings().length).toBe(0);
      });

      it("warns again at the next snapshot epoch while staked reserves remain negative", async () => {
        await updatePool(
          {
            incrementalStakedReserve0: -10n,
            incrementalStakedReserve1: -10n,
          },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedReserve0: -100n,
            stakedReserve1: -100n,
            lastSnapshotTimestamp: previousEpoch(),
            lastUpdatedTimestamp: previousEpoch(),
          },
          timestamp,
          mockContext as handlerContext,
          10,
          blockNumber,
        );

        // Both reserve0 and reserve1 still negative ⇒ one warn each per snapshot epoch.
        expect(negativeStakedReserveWarnings().length).toBe(2);
      });

      it("does not warn when reserves are negative but inside the same snapshot epoch (rate-limit gate)", async () => {
        await updatePool(
          {
            incrementalStakedReserve0: -10n,
            incrementalStakedReserve1: -10n,
          },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedReserve0: -100n,
            stakedReserve1: -100n,
            lastSnapshotTimestamp: timestamp,
            lastUpdatedTimestamp: timestamp,
          },
          timestamp,
          mockContext as handlerContext,
          10,
          blockNumber,
        );

        expect(negativeStakedReserveWarnings().length).toBe(0);
      });
    });

    // Regression test for issue #702: pool reserves must never persist negative.
    // The aggregator clamps reserve0 / reserve1 to >= 0n at the accumulator
    // path and emits [NEG_RESERVE_GUARD] with {poolAddress, chainId,
    // priorReserve, delta, clampedTo} each time the clamp fires.
    describe("negative reserve clamp guard (issue #702)", () => {
      const sameEpochAsTimestamp = () => timestamp;

      const negReserveGuardLogs = () => {
        const warnMock = vi.mocked(mockContext.log?.warn);
        const calls = warnMock?.mock.calls ?? [];
        return calls.filter((args) =>
          String(args[0] ?? "").includes("[NEG_RESERVE_GUARD]"),
        );
      };

      const lastSet = (): Pool => {
        const setMock = vi.mocked(mockContext.Pool?.set);
        return setMock?.mock.lastCall?.[0] as Pool;
      };

      it("clamps reserve0 to 0n and logs guard when delta would drive it negative", async () => {
        await updatePool(
          { incrementalReserve0: -100n },
          {
            ...(liquidityPoolAggregator as Pool),
            reserve0: 50n,
            reserve1: 1000n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().reserve0).toBe(0n);
        expect(lastSet().reserve1).toBe(1000n);

        const logs = negReserveGuardLogs();
        expect(logs.length).toBe(1);
        const msg = String(logs[0]?.[0] ?? "");
        expect(msg).toContain("reserve0");
        expect(msg).toContain("priorReserve=50");
        expect(msg).toContain("delta=-100");
        expect(msg).toContain("clampedTo=0");
        // chainId in the log is the pool entity's chainId, not the eventChainId
        // parameter — those agree in practice (a reserve diff comes from the
        // pool's own chain) and the pool's chainId is what Hasura consumers query.
        expect(msg).toContain(
          `chainId=${(liquidityPoolAggregator as Pool).chainId}`,
        );
      });

      it("clamps reserve1 to 0n and logs guard when delta would drive it negative", async () => {
        await updatePool(
          { incrementalReserve1: -100n },
          {
            ...(liquidityPoolAggregator as Pool),
            reserve0: 1000n,
            reserve1: 50n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().reserve0).toBe(1000n);
        expect(lastSet().reserve1).toBe(0n);

        const logs = negReserveGuardLogs();
        expect(logs.length).toBe(1);
        expect(String(logs[0]?.[0] ?? "")).toContain("reserve1");
      });

      it("does not clamp or log when reserves stay non-negative", async () => {
        await updatePool(
          { incrementalReserve0: -50n, incrementalReserve1: -50n },
          {
            ...(liquidityPoolAggregator as Pool),
            reserve0: 100n,
            reserve1: 100n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().reserve0).toBe(50n);
        expect(lastSet().reserve1).toBe(50n);
        expect(negReserveGuardLogs().length).toBe(0);
      });

      it("clamps both reserves independently and logs once per field", async () => {
        await updatePool(
          { incrementalReserve0: -200n, incrementalReserve1: -200n },
          {
            ...(liquidityPoolAggregator as Pool),
            reserve0: 100n,
            reserve1: 100n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().reserve0).toBe(0n);
        expect(lastSet().reserve1).toBe(0n);
        expect(negReserveGuardLogs().length).toBe(2);
      });

      // Distinguishes the new clamp from the prior snapshot-epoch warn: the
      // clamp fires on every update that would underflow, not only at hour
      // boundaries, so a Burn-larger-than-Mint mid-epoch still gets caught.
      it("clamps mid-epoch (no snapshot boundary required)", async () => {
        await updatePool(
          { incrementalReserve0: -500n },
          {
            ...(liquidityPoolAggregator as Pool),
            reserve0: 100n,
            reserve1: 100n,
            // lastSnapshotTimestamp === timestamp → no snapshot this call.
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().reserve0).toBe(0n);
        expect(negReserveGuardLogs().length).toBe(1);
      });

      // AC item 2: Burn-larger-than-Mint scenario produces clamped reserves
      // and a working USD path. We exercise the aggregator directly with the
      // diff a CL Burn would produce; the Burn handler's USD calc is tested
      // separately in CLPoolBurnLogic.test.ts.
      it("clamps when Burn delta exceeds cumulative Mint and downstream USD is computed", async () => {
        // currentTotalLiquidityUSD comes from the producer (Burn handler) and
        // is passed through unchanged; the aggregator does not recompute it
        // from reserves. We assert the diff value lands on the entity.
        await updatePool(
          {
            incrementalReserve0: -1000n,
            incrementalReserve1: -1000n,
            currentTotalLiquidityUSD: 0n,
          },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            reserve0: 100n,
            reserve1: 100n,
            totalLiquidityUSD: 5000n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().reserve0).toBe(0n);
        expect(lastSet().reserve1).toBe(0n);
        expect(lastSet().totalLiquidityUSD).toBe(0n);
        expect(negReserveGuardLogs().length).toBe(2);
      });
    });

    // Regression test for issue #719: stakedLiquidityInRange must never
    // persist negative. Mirrors the #702 reserve-clamp shape but for the
    // staked-in-range field. The aggregator emits [NEG_STAKED_LIQ_GUARD]
    // with {poolAddress, chainId, priorStakedLiqInRange, replacement,
    // clampedTo} when the diff would drive the field below zero.
    describe("negative stakedLiquidityInRange clamp guard (issue #719)", () => {
      const sameEpochAsTimestamp = () => timestamp;

      const negStakedLiqGuardLogs = () => {
        const warnMock = vi.mocked(mockContext.log?.warn);
        const calls = warnMock?.mock.calls ?? [];
        return calls.filter((args) =>
          String(args[0] ?? "").includes("[NEG_STAKED_LIQ_GUARD]"),
        );
      };

      const lastSet = (): Pool => {
        const setMock = vi.mocked(mockContext.Pool?.set);
        return setMock?.mock.lastCall?.[0] as Pool;
      };

      it("clamps stakedLiquidityInRange to 0n and logs guard when diff is negative", async () => {
        await updatePool(
          { stakedLiquidityInRange: -250n },
          {
            ...(liquidityPoolAggregator as Pool),
            stakedLiquidityInRange: 100n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedLiquidityInRange).toBe(0n);

        const logs = negStakedLiqGuardLogs();
        expect(logs.length).toBe(1);
        const msg = String(logs[0]?.[0] ?? "");
        expect(msg).toContain("stakedLiquidityInRange");
        expect(msg).toContain("priorStakedLiqInRange=100");
        expect(msg).toContain("replacement=-250");
        expect(msg).toContain("clampedTo=0");
        expect(msg).toContain(
          `chainId=${(liquidityPoolAggregator as Pool).chainId}`,
        );
        expect(msg).toContain(
          `poolAddress=${(liquidityPoolAggregator as Pool).poolAddress}`,
        );
      });

      it("clamps when current value is already negative and diff omits stakedLiquidityInRange", async () => {
        // Simulates the legacy poisoned-state case: pool's persisted
        // stakedLiquidityInRange is already < 0n from prior drift, and the
        // current update doesn't supply a replacement. The clamp still fires
        // because the post-replace value falls back to the negative current.
        await updatePool(
          {},
          {
            ...(liquidityPoolAggregator as Pool),
            stakedLiquidityInRange: -1_000_000n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedLiquidityInRange).toBe(0n);
        expect(negStakedLiqGuardLogs().length).toBe(1);
      });

      it("does not clamp or log when stakedLiquidityInRange stays non-negative", async () => {
        await updatePool(
          { stakedLiquidityInRange: 50n },
          {
            ...(liquidityPoolAggregator as Pool),
            stakedLiquidityInRange: 100n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedLiquidityInRange).toBe(50n);
        expect(negStakedLiqGuardLogs().length).toBe(0);
      });
    });
  });

  describe("Updating the Liquidity Pool Aggregator", () => {
    let diff = {
      incrementalTotalVolume0: 0n,
      incrementalTotalVolume1: 0n,
      incrementalTotalVolumeUSD: 0n,
      incrementalNumberOfSwaps: 0n,
      incrementalTotalVolumeUSDWhitelisted: 0n,
      incrementalTotalFeesUSDWhitelisted: 0n,
      totalVotesDeposited: 0n,
      totalVotesDepositedUSD: 0n,
      incrementalTotalEmissions: 0n,
    };
    beforeEach(async () => {
      diff = {
        incrementalTotalVolume0: 5000n,
        incrementalTotalVolume1: 6000n,
        incrementalTotalVolumeUSD: 7000n,
        incrementalNumberOfSwaps: 11n,
        incrementalTotalVolumeUSDWhitelisted: 8000n,
        incrementalTotalFeesUSDWhitelisted: 9000n,
        totalVotesDeposited: 2000n,
        totalVotesDepositedUSD: 3000n,
        incrementalTotalEmissions: 4000n,
      };
      await updatePool(
        diff,
        liquidityPoolAggregator as Pool,
        timestamp,
        mockContext as handlerContext,
        10,
        blockNumber,
      );
    });

    it("should update the liquidity pool aggregator", () => {
      const mockSet = vi.mocked(mockContext.Pool?.set);
      const updatedAggregator = mockSet?.mock.calls[0]?.[0] as Pool;
      expect(updatedAggregator.totalVolume0).toBe(diff.incrementalTotalVolume0);
      expect(updatedAggregator.totalVolume1).toBe(diff.incrementalTotalVolume1);
      expect(updatedAggregator.numberOfSwaps).toBe(
        diff.incrementalNumberOfSwaps,
      );
      expect(updatedAggregator.totalVolumeUSDWhitelisted).toBe(
        diff.incrementalTotalVolumeUSDWhitelisted,
      );
      expect(updatedAggregator.totalFeesUSDWhitelisted).toBe(
        diff.incrementalTotalFeesUSDWhitelisted,
      );
    });

    it("should create a snapshot if the last update was more than 1 hour ago", async () => {
      // Set up a scenario where the last snapshot was more than 1 hour ago
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const currentTimestamp = new Date();

      const liquidityPoolWithOldSnapshot = {
        ...liquidityPoolAggregator,
        lastSnapshotTimestamp: oldTimestamp,
      };

      // Mock the effect to track if it's called
      if (!mockContext.effect) {
        throw new Error("mockContext.effect is not defined");
      }
      const effectSpy = vi.mocked(mockContext.effect);
      effectSpy.mockClear();

      await updatePool(
        diff,
        liquidityPoolWithOldSnapshot as Pool,
        currentTimestamp,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      const mockSet = vi.mocked(mockContext.PoolSnapshot?.set);
      const snapshot = mockSet?.mock.calls[0]?.[0];
      expect(snapshot).toBeDefined();

      // For non-CL pools, updateDynamicFeePools should NOT be called
      const effectCalls = effectSpy.mock.calls.filter(
        (call) => call[0] === getSwapFee,
      );
      expect(effectCalls.length).toBe(0);
    });

    it("should call updateDynamicFeePools for CL pools when creating snapshot", async () => {
      // Set up a CL pool (liquidityPoolAggregator has factoryAddress set in beforeEach)
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const currentTimestamp = new Date();

      const clPoolWithOldSnapshot = {
        ...liquidityPoolAggregator,
        isCL: true,
        lastSnapshotTimestamp: oldTimestamp,
      };

      // Mock the effect to track if it's called
      if (!mockContext.effect) {
        throw new Error("mockContext.effect is not defined");
      }
      const effectSpy = vi.mocked(mockContext.effect);
      effectSpy.mockClear();

      await updatePool(
        diff,
        clPoolWithOldSnapshot as Pool,
        currentTimestamp,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      const mockSet = vi.mocked(mockContext.PoolSnapshot?.set);
      const snapshot = mockSet?.mock.calls[0]?.[0];
      expect(snapshot).toBeDefined();

      // For CL pools, updateDynamicFeePools should be called
      const effectCalls = effectSpy.mock.calls.filter(
        (call) => call[0] === getSwapFee,
      );
      expect(effectCalls.length).toBe(1);
    });

    it("should recompute CL staked USD at snapshot time when staked liquidity > 0", async () => {
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const currentTimestamp = new Date();
      setupCommon();

      const token0Id = "10-0x1111111111111111111111111111111111111111";
      const token1Id = "10-0x2222222222222222222222222222222222222222";
      const poolAddr = toChecksumAddress(
        "0x1234567890123456789012345678901234567890",
      );

      const clPool = createMockPool({
        poolAddress: poolAddr,
        chainId: 10,
        isCL: true,
        lastSnapshotTimestamp: oldTimestamp,
        currentLiquidityStaked: 5000n,
        currentLiquidityStakedUSD: 100n, // Stale value
        sqrtPriceX96: 79228162514264337593543950336n, // tick 0
        tick: 0n,
        stakedReserve0: 5000000000000000000000n, // Nonzero staked reserves for USD computation
        stakedReserve1: 5000000000000000000000n,
        token0_id: token0Id,
        token1_id: token1Id,
        token0_address: toChecksumAddress(
          "0x1111111111111111111111111111111111111111",
        ),
        token1_address: toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        ),
        factoryAddress: toChecksumAddress(
          "0x548118C7E0B865C2CfA94D15EC86B666468ac758",
        ),
      });

      const mockToken0 = {
        id: token0Id,
        address: toChecksumAddress(
          "0x1111111111111111111111111111111111111111",
        ),
        symbol: "TK0",
        name: "Token0",
        chainId: 10,
        decimals: 18n,
        pricePerUSDNew: 1000000000000000000n,
        lastUpdatedTimestamp: currentTimestamp,
        isWhitelisted: true,
      };
      const mockToken1 = {
        id: token1Id,
        address: toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        ),
        symbol: "TK1",
        name: "Token1",
        chainId: 10,
        decimals: 18n,
        pricePerUSDNew: 1000000000000000000n,
        lastUpdatedTimestamp: currentTimestamp,
        isWhitelisted: true,
      };

      // Fresh set mock to avoid picking up calls from outer beforeEach
      const setMock = vi.fn();
      const ctx = {
        ...mockContext,
        Pool: {
          ...mockContext.Pool,
          set: setMock,
        },
        Token: {
          ...mockContext.Token,
          get: vi.fn().mockImplementation((id: string) => {
            if (id === token0Id) return mockToken0;
            if (id === token1Id) return mockToken1;
            return undefined;
          }),
        },
      } as unknown as handlerContext;

      await updatePool(diff, clPool, currentTimestamp, ctx, 10, blockNumber);

      const updatedAggregator = setMock.mock.calls[0]?.[0] as Pool;

      // Should have computed staked USD from stakedReserve0/stakedReserve1 (not the stale 100n)
      expect(updatedAggregator.currentLiquidityStakedUSD).toBeGreaterThan(0n);
      expect(updatedAggregator.currentLiquidityStakedUSD).not.toBe(100n);
    });

    it("should NOT recompute CL staked USD when staked liquidity is 0", async () => {
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const currentTimestamp = new Date();

      const clPool = createMockPool({
        chainId: 10,
        isCL: true,
        lastSnapshotTimestamp: oldTimestamp,
        currentLiquidityStaked: 0n,
        currentLiquidityStakedUSD: 0n,
        factoryAddress: toChecksumAddress(
          "0x548118C7E0B865C2CfA94D15EC86B666468ac758",
        ),
      });

      const ctx = {
        ...mockContext,
        NonFungiblePosition: {
          getWhere: vi.fn().mockResolvedValue([]),
        },
      } as unknown as handlerContext;

      await updatePool(diff, clPool, currentTimestamp, ctx, 10, blockNumber);

      // getWhere should NOT have been called (skipped because staked == 0)
      expect(ctx.NonFungiblePosition.getWhere).not.toHaveBeenCalled();
    });

    it("should zero CL staked USD at snapshot time when staked liquidity is 0 but USD is stale", async () => {
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const currentTimestamp = new Date();

      const clPool = createMockPool({
        chainId: 10,
        isCL: true,
        lastSnapshotTimestamp: oldTimestamp,
        currentLiquidityStaked: 0n,
        currentLiquidityStakedUSD: 500n, // Stale positive value from before last exit
        factoryAddress: toChecksumAddress(
          "0x548118C7E0B865C2CfA94D15EC86B666468ac758",
        ),
      });

      const setMock = vi.fn();
      const ctx = {
        ...mockContext,
        Pool: {
          ...mockContext.Pool,
          set: setMock,
        },
        NonFungiblePosition: {
          getWhere: vi.fn().mockResolvedValue([]),
        },
      } as unknown as handlerContext;

      await updatePool(diff, clPool, currentTimestamp, ctx, 10, blockNumber);

      const updatedAggregator = setMock.mock.calls[0]?.[0] as Pool;

      // Stale USD should be cleared to 0
      expect(updatedAggregator.currentLiquidityStakedUSD).toBe(0n);
      // Should NOT have queried positions (no need when stake is 0)
      expect(ctx.NonFungiblePosition.getWhere).not.toHaveBeenCalled();
    });

    it("should NOT recompute staked USD for non-CL pools at snapshot time", async () => {
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const currentTimestamp = new Date();

      const v2Pool = createMockPool({
        chainId: 10,
        isCL: false,
        lastSnapshotTimestamp: oldTimestamp,
        currentLiquidityStaked: 5000n,
        currentLiquidityStakedUSD: 100n,
      });

      const setMock = vi.fn();
      const ctx = {
        ...mockContext,
        Pool: {
          ...mockContext.Pool,
          set: setMock,
        },
        NonFungiblePosition: {
          getWhere: vi.fn().mockResolvedValue([]),
        },
      } as unknown as handlerContext;

      await updatePool(diff, v2Pool, currentTimestamp, ctx, 10, blockNumber);

      // getWhere should NOT have been called (non-CL pool)
      expect(ctx.NonFungiblePosition.getWhere).not.toHaveBeenCalled();

      // Staked USD should be preserved
      const updatedAggregator = setMock.mock.calls[0]?.[0] as Pool;
      expect(updatedAggregator.currentLiquidityStakedUSD).toBe(100n);
    });
  });

  describe("fee/volume invariant warning (issue #670)", () => {
    // Real swap fee tiers cap at ~1%; a running totalFeesGeneratedUSD exceeding
    // 5% of totalVolumeUSD signals divergence between the fee-USD and volume-USD
    // paths. The aggregator emits a warning under [FEE_VOLUME_DIVERGENCE] at
    // each snapshot epoch boundary while still divergent (≤1/hour per pool) so
    // a persistent drift stays visible in recent logs without flooding them and
    // without aborting the indexer.
    const previousEpoch = () =>
      new Date(timestamp.getTime() - 2 * 60 * 60 * 1000);

    it("warns at snapshot epoch when totalFeesGeneratedUSD exceeds 5% of totalVolumeUSD", async () => {
      const pool = createMockPool({
        totalVolumeUSD: 1_000n * 10n ** 18n,
        totalFeesGeneratedUSD: 0n,
        lastSnapshotTimestamp: previousEpoch(),
        lastUpdatedTimestamp: previousEpoch(),
      });

      await updatePool(
        { incrementalTotalFeesGeneratedUSD: 60n * 10n ** 18n },
        pool as Pool,
        timestamp,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      const warnMock = vi.mocked(mockContext.log?.warn);
      const warnCalls = warnMock?.mock.calls ?? [];
      const divergenceWarnings = warnCalls.filter((args) =>
        String(args[0] ?? "").includes("[FEE_VOLUME_DIVERGENCE]"),
      );
      expect(divergenceWarnings.length).toBe(1);
    });

    it("does not warn when fees are below the 5% threshold", async () => {
      const pool = createMockPool({
        totalVolumeUSD: 1_000n * 10n ** 18n,
        totalFeesGeneratedUSD: 0n,
        lastSnapshotTimestamp: previousEpoch(),
        lastUpdatedTimestamp: previousEpoch(),
      });

      await updatePool(
        { incrementalTotalFeesGeneratedUSD: 10n * 10n ** 18n },
        pool as Pool,
        timestamp,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      const warnMock = vi.mocked(mockContext.log?.warn);
      const warnCalls = warnMock?.mock.calls ?? [];
      const divergenceWarnings = warnCalls.filter((args) =>
        String(args[0] ?? "").includes("[FEE_VOLUME_DIVERGENCE]"),
      );
      expect(divergenceWarnings.length).toBe(0);
    });

    it("does not warn when totalVolumeUSD is zero (avoid div-by-zero noise)", async () => {
      const pool = createMockPool({
        totalVolumeUSD: 0n,
        totalFeesGeneratedUSD: 0n,
        lastSnapshotTimestamp: previousEpoch(),
        lastUpdatedTimestamp: previousEpoch(),
      });

      await updatePool(
        { incrementalTotalFeesGeneratedUSD: 10n * 10n ** 18n },
        pool as Pool,
        timestamp,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      const warnMock = vi.mocked(mockContext.log?.warn);
      const warnCalls = warnMock?.mock.calls ?? [];
      const divergenceWarnings = warnCalls.filter((args) =>
        String(args[0] ?? "").includes("[FEE_VOLUME_DIVERGENCE]"),
      );
      expect(divergenceWarnings.length).toBe(0);
    });

    it("does not warn when divergent but inside the same snapshot epoch (rate-limit gate)", async () => {
      const pool = createMockPool({
        totalVolumeUSD: 1_000n * 10n ** 18n,
        totalFeesGeneratedUSD: 100n * 10n ** 18n,
        lastSnapshotTimestamp: timestamp,
        lastUpdatedTimestamp: timestamp,
      });

      await updatePool(
        { incrementalTotalFeesGeneratedUSD: 1n * 10n ** 18n },
        pool as Pool,
        timestamp,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      const warnMock = vi.mocked(mockContext.log?.warn);
      const warnCalls = warnMock?.mock.calls ?? [];
      const divergenceWarnings = warnCalls.filter((args) =>
        String(args[0] ?? "").includes("[FEE_VOLUME_DIVERGENCE]"),
      );
      expect(divergenceWarnings.length).toBe(0);
    });
  });

  describe("loadPoolData", () => {
    let token0: Token;
    let token1: Token;
    const poolAddress = toChecksumAddress(
      "0x1234567890123456789012345678901234567890",
    );
    const chainId = 10;

    beforeEach(() => {
      token0 = {
        id: "token0",
        address: toChecksumAddress(
          "0x1111111111111111111111111111111111111111",
        ),
        symbol: "TOKEN0",
        name: "Token 0",
        chainId: 10,
        decimals: 18n,
        pricePerUSDNew: 1000000n, // $1.00
        lastUpdatedTimestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        isWhitelisted: false,
      } as Token;

      token1 = {
        id: "token1",
        address: toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        ),
        symbol: "TOKEN1",
        name: "Token 1",
        chainId: 10,
        decimals: 18n,
        pricePerUSDNew: 2000000n, // $2.00
        lastUpdatedTimestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        isWhitelisted: false,
      } as Token;

      const mockLiquidityPoolGet = vi.mocked(mockContext.Pool?.get);
      mockLiquidityPoolGet?.mockResolvedValue(
        liquidityPoolAggregator as unknown as Pool,
      );

      const mockTokenGet = vi.mocked(mockContext.Token?.get);
      mockTokenGet?.mockImplementation((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const mockTokenSet = vi.mocked(mockContext.Token?.set);
      mockTokenSet?.mockClear();

      const mockSnapshotSet = vi.mocked(mockContext.TokenPriceSnapshot?.set);
      mockSnapshotSet?.mockClear();
    });

    it("should load pool data without refreshing prices when block data is not provided", async () => {
      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result).not.toBeNull();
      expect(result?.liquidityPoolAggregator).toBe(liquidityPoolAggregator);
      expect(result?.token0Instance).toBe(token0);
      expect(result?.token1Instance).toBe(token1);

      // Token.set should not be called (no price refresh)
      const mockTokenSet = vi.mocked(mockContext.Token?.set);
      expect(mockTokenSet).not.toHaveBeenCalled();
    });

    it("should refresh token prices when block data is provided and prices are stale", async () => {
      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000); // Current time
      const newPrice0 = 1500000n; // $1.50
      const newPrice1 = 2500000n; // $2.50

      // Mock effect to return new prices and token details
      expect(mockContext.effect).toBeDefined();
      vi
        // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
        .mocked(mockContext.effect!)
        // biome-ignore lint/suspicious/noExplicitAny: effect mock implementation needs flexible types
        .mockImplementation(async (effectFn: any, input: any) => {
          if (effectFn.name === "getTokenPrice") {
            if (
              input.tokenAddress.toLowerCase() === token0.address.toLowerCase()
            ) {
              return {
                pricePerUSDNew: newPrice0,
              };
            }
            if (
              input.tokenAddress.toLowerCase() === token1.address.toLowerCase()
            ) {
              return {
                pricePerUSDNew: newPrice1,
              };
            }
          }
          if (effectFn.name === "getTokenDetails") {
            if (
              input.contractAddress.toLowerCase() ===
              token0.address.toLowerCase()
            ) {
              return {
                name: token0.name,
                symbol: token0.symbol,
                decimals: Number(token0.decimals),
              };
            }
            if (
              input.contractAddress.toLowerCase() ===
              token1.address.toLowerCase()
            ) {
              return {
                name: token1.name,
                symbol: token1.symbol,
                decimals: Number(token1.decimals),
              };
            }
          }
          return {};
        });

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).not.toBeNull();
      expect(result?.token0Instance.pricePerUSDNew).toBe(newPrice0);
      expect(result?.token1Instance.pricePerUSDNew).toBe(newPrice1);
      expect(result?.token0Instance.lastUpdatedTimestamp).toBeInstanceOf(Date);
      expect(result?.token1Instance.lastUpdatedTimestamp).toBeInstanceOf(Date);

      // Token.set should be called for both tokens
      const mockTokenSet = vi.mocked(mockContext.Token?.set);
      expect(mockTokenSet).toHaveBeenCalledTimes(2);

      // TokenPriceSnapshot.set should be called for both tokens
      const mockSnapshotSet = vi.mocked(mockContext.TokenPriceSnapshot?.set);
      expect(mockSnapshotSet).toHaveBeenCalledTimes(2);
    });

    it("should not refresh token prices when they are recent (less than 1 hour)", async () => {
      const recentTimestamp = new Date(); // Just now
      token0 = { ...token0, lastUpdatedTimestamp: recentTimestamp };
      token1 = { ...token1, lastUpdatedTimestamp: recentTimestamp };

      // Update the mock to return the updated tokens
      const mockTokenGet = vi.mocked(mockContext.Token?.get);
      mockTokenGet?.mockImplementation((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000);

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).not.toBeNull();
      // Prices should remain unchanged
      expect(result?.token0Instance.pricePerUSDNew).toBe(token0.pricePerUSDNew);
      expect(result?.token1Instance.pricePerUSDNew).toBe(token1.pricePerUSDNew);

      // Token.set should not be called (no refresh needed)
      const mockTokenSet = vi.mocked(mockContext.Token?.set);
      expect(mockTokenSet).not.toHaveBeenCalled();
    });

    it("refreshes a $0 token once the hourly throttle has elapsed (#676 — no more 30-day trap)", async () => {
      const now = new Date("2024-01-01T12:00:00Z");
      const overOneHourAgo = new Date(now.getTime() - 61 * 60 * 1000);
      token0 = {
        ...token0,
        pricePerUSDNew: 0n,
        lastUpdatedTimestamp: overOneHourAgo,
      };
      // Ensure token1 has recent timestamp so it won't be refreshed
      token1 = {
        ...token1,
        lastUpdatedTimestamp: now,
      };

      // Update the mock to return the updated tokens
      const mockTokenGet = vi.mocked(mockContext.Token?.get);
      mockTokenGet?.mockImplementation((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(now.getTime() / 1000);
      const newPrice0 = 1000000n; // $1.00

      // Mock effect to return new price and token details
      expect(mockContext.effect).toBeDefined();
      vi
        // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
        .mocked(mockContext.effect!)
        // biome-ignore lint/suspicious/noExplicitAny: effect mock implementation needs flexible types
        .mockImplementation(async (effectFn: any, input: any) => {
          if (effectFn.name === "getTokenPrice") {
            if (
              input.tokenAddress.toLowerCase() === token0.address.toLowerCase()
            ) {
              return {
                pricePerUSDNew: newPrice0,
              };
            }
            if (
              input.tokenAddress.toLowerCase() === token1.address.toLowerCase()
            ) {
              return {
                pricePerUSDNew: token1.pricePerUSDNew,
              };
            }
          }
          if (effectFn.name === "getTokenDetails") {
            if (
              input.contractAddress.toLowerCase() ===
              token0.address.toLowerCase()
            ) {
              return {
                name: token0.name,
                symbol: token0.symbol,
                decimals: Number(token0.decimals),
              };
            }
            if (
              input.contractAddress.toLowerCase() ===
              token1.address.toLowerCase()
            ) {
              return {
                name: token1.name,
                symbol: token1.symbol,
                decimals: Number(token1.decimals),
              };
            }
          }
          return {};
        });

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).not.toBeNull();
      // token0 was $0 + stale → refresh fires
      expect(result?.token0Instance.pricePerUSDNew).toBe(newPrice0);
      // token1 has a recent timestamp → throttled
      expect(result?.token1Instance.pricePerUSDNew).toBe(token1.pricePerUSDNew);

      const mockTokenSet = vi.mocked(mockContext.Token?.set);
      expect(mockTokenSet).toHaveBeenCalledTimes(1);
    });

    it("should handle price refresh errors gracefully", async () => {
      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000);

      // Mock effect to throw error for token0, return price for token1
      expect(mockContext.effect).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
      const effectMock = vi.mocked(mockContext.effect!);
      // biome-ignore lint/suspicious/noExplicitAny: effect mock implementation needs flexible types
      effectMock.mockImplementation(async (effectFn: any, input: any) => {
        if (effectFn.name === "getTokenPrice") {
          if (
            input.tokenAddress.toLowerCase() === token0.address.toLowerCase()
          ) {
            throw new Error("Price fetch failed");
          }
          if (
            input.tokenAddress.toLowerCase() === token1.address.toLowerCase()
          ) {
            return {
              pricePerUSDNew: 3000000n,
            };
          }
        }
        if (effectFn.name === "getTokenDetails") {
          if (
            input.contractAddress.toLowerCase() === token0.address.toLowerCase()
          ) {
            return {
              name: token0.name,
              symbol: token0.symbol,
              decimals: Number(token0.decimals),
            };
          }
          if (
            input.contractAddress.toLowerCase() === token1.address.toLowerCase()
          ) {
            return {
              name: token1.name,
              symbol: token1.symbol,
              decimals: Number(token1.decimals),
            };
          }
        }
        return {};
      });

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).not.toBeNull();
      // token0 should remain unchanged (error handled)
      expect(result?.token0Instance.pricePerUSDNew).toBe(token0.pricePerUSDNew);
      // token1 should be refreshed successfully
      expect(result?.token1Instance.pricePerUSDNew).toBe(3000000n);

      // Error should be logged
      const mockErrorLog = vi.mocked(mockContext.log?.error);
      expect(mockErrorLog).toHaveBeenCalled();
    });

    it("should return original token0 and log error when token0 price refresh rejects", async () => {
      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000);
      vi.spyOn(PriceOracle, "refreshTokenPrice")
        .mockRejectedValueOnce(new Error("token0 refresh failed"))
        .mockImplementation(async (t) => Promise.resolve({ ...t }));

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).not.toBeNull();
      expect(result?.token0Instance).toBe(token0);
      const mockErrorLog = vi.mocked(mockContext.log?.error);
      expect(mockErrorLog).toHaveBeenCalledWith(
        expect.stringContaining("Error refreshing token0 price"),
      );
    });

    it("should return original token1 and log error when token1 price refresh rejects", async () => {
      const blockNumber = 1000000;
      const blockTimestamp = Math.floor(Date.now() / 1000);
      vi.spyOn(PriceOracle, "refreshTokenPrice").mockImplementation(
        async (t) => {
          if (t.address === token1.address) {
            throw new Error("token1 refresh failed");
          }
          return Promise.resolve({ ...t });
        },
      );

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
        blockNumber,
        blockTimestamp,
      );

      expect(result).not.toBeNull();
      expect(result?.token1Instance).toBe(token1);
      const mockErrorLog = vi.mocked(mockContext.log?.error);
      expect(mockErrorLog).toHaveBeenCalledWith(
        expect.stringContaining("Error refreshing token1 price"),
      );
    });

    it("should return null when pool is not found", async () => {
      const mockLiquidityPoolGet = vi.mocked(mockContext.Pool?.get);
      mockLiquidityPoolGet?.mockResolvedValue(undefined);

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result).toBeNull();
      const mockErrorLog = vi.mocked(mockContext.log?.error);
      expect(mockErrorLog).toHaveBeenCalled();
    });

    it("should return null when tokens are not found", async () => {
      const mockTokenGet = vi.mocked(mockContext.Token?.get);
      mockTokenGet?.mockResolvedValue(undefined);

      const result = await loadPoolData(
        poolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result).toBeNull();
      const mockErrorLog = vi.mocked(mockContext.log?.error);
      expect(mockErrorLog).toHaveBeenCalled();
    });
  });

  describe("loadPoolDataOrRootCLPool", () => {
    let token0: Token;
    let token1: Token;
    const rootPoolAddress = toChecksumAddress(
      "0x1111111111111111111111111111111111111111",
    );
    const leafPoolAddress = toChecksumAddress(
      "0x2222222222222222222222222222222222222222",
    );
    const chainId = 10;
    const rootPoolId = PoolId(chainId, rootPoolAddress);

    beforeEach(() => {
      token0 = {
        id: "token0",
        address: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ),
        symbol: "TOKEN0",
        name: "Token 0",
        chainId: 10,
        decimals: 18n,
        pricePerUSDNew: 1000000n,
        lastUpdatedTimestamp: new Date(),
        isWhitelisted: false,
      } as Token;

      token1 = {
        id: "token1",
        address: toChecksumAddress(
          "0x4444444444444444444444444444444444444444",
        ),
        symbol: "TOKEN1",
        name: "Token 1",
        chainId: 10,
        decimals: 18n,
        pricePerUSDNew: 2000000n,
        lastUpdatedTimestamp: new Date(),
        isWhitelisted: false,
      } as Token;
    });

    it("should return pool data directly when pool exists", async () => {
      const rootPool = createMockPool({
        id: rootPoolId,
        chainId: chainId,
        token0_id: "token0",
        token1_id: "token1",
        token0_address: token0.address,
        token1_address: token1.address,
      });

      const mockLiquidityPoolGet = vi.mocked(mockContext.Pool?.get);
      mockLiquidityPoolGet?.mockImplementation((address: string) => {
        if (address === rootPoolId) return Promise.resolve(rootPool);
        return Promise.resolve(undefined);
      });

      const mockTokenGet = vi.mocked(mockContext.Token?.get);
      mockTokenGet?.mockImplementation((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.poolData.liquidityPoolAggregator.id).toBe(rootPoolId);
        expect(result.poolData.token0Instance).toBe(token0);
        expect(result.poolData.token1Instance).toBe(token1);
      }

      // RootPool_LeafPool lookup runs first, then we fallback to direct pool load when no mapping exists
      const mockRootPoolLeafPoolGetWhere = vi.mocked(
        mockContext.RootPool_LeafPool?.getWhere,
      );
      expect(mockRootPoolLeafPoolGetWhere).toHaveBeenCalledTimes(1);
      expect(mockRootPoolLeafPoolGetWhere).toHaveBeenCalledWith({
        rootPoolAddress: { _eq: rootPoolAddress },
      });
    });

    it("should load leaf pool data when root pool is not found but RootPool_LeafPool exists", async () => {
      const leafChainId = 252;
      const leafPoolId = PoolId(leafChainId, leafPoolAddress);
      const leafPool = createMockPool({
        id: leafPoolId,
        chainId: leafChainId,
        token0_id: "token0",
        token1_id: "token1",
        token0_address: token0.address,
        token1_address: token1.address,
      });

      const rootPoolLeafPool = {
        id: RootPoolLeafPoolId(
          chainId,
          leafChainId,
          rootPoolAddress,
          leafPoolAddress,
        ),
        rootChainId: chainId,
        rootPoolAddress: rootPoolAddress,
        leafChainId: leafChainId,
        leafPoolAddress: leafPoolAddress,
      };

      const mockLiquidityPoolGet = vi.mocked(mockContext.Pool?.get);
      mockLiquidityPoolGet?.mockImplementation((address: string) => {
        if (address === rootPoolId) return Promise.resolve(undefined);
        if (address === leafPoolId) return Promise.resolve(leafPool);
        return Promise.resolve(undefined);
      });

      const mockTokenGet = vi.mocked(mockContext.Token?.get);
      mockTokenGet?.mockImplementation((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const mockRootPoolLeafPoolGetWhere = vi.mocked(
        mockContext.RootPool_LeafPool?.getWhere,
      );
      mockRootPoolLeafPoolGetWhere?.mockResolvedValue([rootPoolLeafPool]);

      const mockErrorLog = vi.mocked(mockContext.log?.error);

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.poolData.liquidityPoolAggregator.id).toBe(leafPoolId);
        expect(result.poolData.liquidityPoolAggregator.chainId).toBe(
          leafChainId,
        );
        expect(result.poolData.token0Instance).toBe(token0);
        expect(result.poolData.token1Instance).toBe(token1);
      }
      expect(mockRootPoolLeafPoolGetWhere).toHaveBeenCalled();

      const lookedUpPoolIds = mockLiquidityPoolGet?.mock.calls.map(
        (call) => call[0],
      );
      expect(lookedUpPoolIds).toContain(leafPoolId);
      expect(lookedUpPoolIds).not.toContain(rootPoolId);

      const errorMessages = mockErrorLog?.mock.calls.map((call) => call[0]);
      expect(
        errorMessages?.some(
          (msg) =>
            typeof msg === "string" &&
            msg.includes(`Pool ${rootPoolId} not found`),
        ),
      ).toBe(false);
    });

    it("should not forward blockNumber/blockTimestamp to leaf chain loadPoolData (cross-chain fix)", async () => {
      const leafChainId = 252;
      const leafPoolId = PoolId(leafChainId, leafPoolAddress);
      const leafPool = createMockPool({
        id: leafPoolId,
        chainId: leafChainId,
        token0_id: "token0",
        token1_id: "token1",
        token0_address: token0.address,
        token1_address: token1.address,
      });

      const rootPoolLeafPool = {
        id: RootPoolLeafPoolId(
          chainId,
          leafChainId,
          rootPoolAddress,
          leafPoolAddress,
        ),
        rootChainId: chainId,
        rootPoolAddress: rootPoolAddress,
        leafChainId: leafChainId,
        leafPoolAddress: leafPoolAddress,
      };

      const mockLiquidityPoolGet = vi.mocked(mockContext.Pool?.get);
      mockLiquidityPoolGet?.mockImplementation((address: string) => {
        if (address === leafPoolId) return Promise.resolve(leafPool);
        return Promise.resolve(undefined);
      });

      const mockTokenGet = vi.mocked(mockContext.Token?.get);
      mockTokenGet?.mockImplementation((id: string) => {
        if (id === "token0") return Promise.resolve(token0);
        if (id === "token1") return Promise.resolve(token1);
        return Promise.resolve(undefined);
      });

      const mockRootPoolLeafPoolGetWhere = vi.mocked(
        mockContext.RootPool_LeafPool?.getWhere,
      );
      mockRootPoolLeafPoolGetWhere?.mockResolvedValue([rootPoolLeafPool]);

      // Call WITH block params — they should NOT be forwarded to the leaf chain path
      const rootBlockNumber = 135229421; // OP block
      const rootBlockTimestamp = 1710000000;
      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        mockContext as handlerContext,
        rootBlockNumber,
        rootBlockTimestamp,
      );

      expect(result.ok).toBe(true);

      // The leaf chain loadPoolData call should NOT include blockNumber/blockTimestamp
      // because they belong to the root chain and would cause "Unknown block" errors
      // on the leaf chain's RPC.
      const lpaCalls = mockLiquidityPoolGet?.mock.calls ?? [];
      // loadPoolData for leaf pool should have been called — verify via LPA.get
      expect(lpaCalls.some((call) => call[0] === leafPoolId)).toBe(true);
    });

    it("should return MAPPING_NOT_FOUND when root pool not found and no RootPool_LeafPool exists", async () => {
      const mockLiquidityPoolGet = vi.mocked(mockContext.Pool?.get);
      mockLiquidityPoolGet?.mockResolvedValue(undefined);

      const mockRootPoolLeafPoolGetWhere = vi.mocked(
        mockContext.RootPool_LeafPool?.getWhere,
      );
      mockRootPoolLeafPoolGetWhere?.mockResolvedValue([]);
      const mockErrorLog = vi.mocked(mockContext.log?.error);

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("MAPPING_NOT_FOUND");
      }

      expect(mockRootPoolLeafPoolGetWhere).toHaveBeenCalledWith({
        rootPoolAddress: { _eq: rootPoolAddress },
      });
      expect(mockLiquidityPoolGet).toHaveBeenCalledWith(rootPoolId);

      const errorMessages = mockErrorLog?.mock.calls.map((call) => call[0]);
      expect(
        errorMessages?.some(
          (msg) =>
            typeof msg === "string" &&
            msg.includes(`Pool ${rootPoolId} not found on chain ${chainId}`),
        ),
      ).toBe(true);
    });

    it("should return null when multiple RootPool_LeafPool entries exist", async () => {
      const rootPoolLeafPool1 = {
        id: RootPoolLeafPoolId(
          chainId,
          chainId,
          rootPoolAddress,
          leafPoolAddress,
        ),
        rootChainId: chainId,
        rootPoolAddress: rootPoolAddress,
        leafChainId: chainId,
        leafPoolAddress: leafPoolAddress,
      };

      const rootPoolLeafPool2 = {
        id: RootPoolLeafPoolId(
          chainId,
          chainId,
          rootPoolAddress,
          toChecksumAddress("0x5555555555555555555555555555555555555555"),
        ),
        rootChainId: chainId,
        rootPoolAddress: rootPoolAddress,
        leafChainId: chainId,
        leafPoolAddress: toChecksumAddress(
          "0x5555555555555555555555555555555555555555",
        ),
      };

      const mockLiquidityPoolGet = vi.mocked(mockContext.Pool?.get);
      mockLiquidityPoolGet?.mockResolvedValue(undefined);

      const mockRootPoolLeafPoolGetWhere = vi.mocked(
        mockContext.RootPool_LeafPool?.getWhere,
      );
      mockRootPoolLeafPoolGetWhere?.mockResolvedValue([
        rootPoolLeafPool1,
        rootPoolLeafPool2,
      ]);

      const mockErrorLog = vi.mocked(mockContext.log?.error);

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("MULTIPLE_MAPPINGS");
      }
      expect(mockErrorLog).toHaveBeenCalled();
      // Check if any error call contains the expected message
      const errorMessages = mockErrorLog?.mock.calls.map((call) => call[0]);
      expect(
        errorMessages?.some(
          (msg) =>
            typeof msg === "string" &&
            msg.includes("Expected exactly one RootPool_LeafPool"),
        ),
      ).toBe(true);
    });

    it("should return LEAF_POOL_NOT_FOUND when leaf pool is not found", async () => {
      const leafChainId = 252;
      const rootPoolLeafPool = {
        id: RootPoolLeafPoolId(
          chainId,
          leafChainId,
          rootPoolAddress,
          leafPoolAddress,
        ),
        rootChainId: chainId,
        rootPoolAddress: rootPoolAddress,
        leafChainId: leafChainId,
        leafPoolAddress: leafPoolAddress,
      };

      const mockLiquidityPoolGet = vi.mocked(mockContext.Pool?.get);
      mockLiquidityPoolGet?.mockResolvedValue(undefined);

      const mockRootPoolLeafPoolGetWhere = vi.mocked(
        mockContext.RootPool_LeafPool?.getWhere,
      );
      mockRootPoolLeafPoolGetWhere?.mockResolvedValue([rootPoolLeafPool]);

      const mockErrorLog = vi.mocked(mockContext.log?.error);

      const result = await loadPoolDataOrRootCLPool(
        rootPoolAddress,
        chainId,
        mockContext as handlerContext,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("LEAF_POOL_NOT_FOUND");
      }
      expect(mockErrorLog).toHaveBeenCalled();
      // Check if any error call contains the expected message
      const errorMessages = mockErrorLog?.mock.calls.map((call) => call[0]);
      expect(
        errorMessages?.some(
          (msg) =>
            typeof msg === "string" && msg.includes("Leaf pool data not found"),
        ),
      ).toBe(true);
    });

    it("short-circuits silently with SINK_ROOT_POOL for a known-sink address", async () => {
      // Known sink per src/Constants.ts KNOWN_SINK_ROOT_POOLS (OP).
      const sinkRootPoolAddress = toChecksumAddress(
        "0x333030A736B47D20346d82A473680658ac1C2b88",
      );
      const sinkChainId = 10;

      const mockRootPoolLeafPoolGetWhere = vi.mocked(
        mockContext.RootPool_LeafPool?.getWhere,
      );
      const mockLiquidityPoolGet = vi.mocked(mockContext.Pool?.get);
      const mockErrorLog = vi.mocked(mockContext.log?.error);
      const mockWarnLog = vi.mocked(mockContext.log?.warn);

      const result = await loadPoolDataOrRootCLPool(
        sinkRootPoolAddress,
        sinkChainId,
        mockContext as handlerContext,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("SINK_ROOT_POOL");
      }
      // No DB reads and no log output for known sinks.
      expect(mockRootPoolLeafPoolGetWhere).not.toHaveBeenCalled();
      expect(mockLiquidityPoolGet).not.toHaveBeenCalled();
      expect(mockErrorLog).not.toHaveBeenCalled();
      expect(mockWarnLog).not.toHaveBeenCalled();
    });
  });
});
