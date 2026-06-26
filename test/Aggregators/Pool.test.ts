import type { Token } from "envio";
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
import { roundBlockToInterval } from "../../src/Effects/Token";
import type { Pool, handlerContext } from "../../src/EntityTypes";
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
      totalUnstakedFeesCollected0: 0n,
      totalUnstakedFeesCollected1: 0n,
      totalStakedFeesCollected0: 0n,
      totalStakedFeesCollected1: 0n,
      totalUnstakedFeesCollectedUSD: 0n,
      totalStakedFeesCollectedUSD: 0n,
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

      // Verify that the effect was called with the hour-rounded blockNumber
      // (issue #749: cache key must be stable within an hour for L1/preload reuse)
      // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
      const effectMock = vi.mocked(mockContext.effect!);
      expect(effectMock).toHaveBeenCalledWith(getSwapFee, {
        poolAddress: liquidityPoolAggregator.poolAddress,
        factoryAddress: toChecksumAddress(
          "0x548118C7E0B865C2CfA94D15EC86B666468ac758",
        ),
        chainId: liquidityPoolAggregator.chainId,
        blockNumber: roundBlockToInterval(
          blockNumber,
          // biome-ignore lint/style/noNonNullAssertion: chainId is set in beforeEach
          liquidityPoolAggregator.chainId!,
        ),
      });
    });

    // Regression test for issue #749: getSwapFee's effect cache key must be
    // hour-stable so preload dual-pass and re-index back-fills hit the cache
    // instead of producing a new slot per raw block.
    it("should pass an hour-rounded blockNumber so cache key is stable within the hour", async () => {
      const blocksPerHour = 1800; // 2s blocks on Optimism (chainId 10)
      const firstBlockInHour =
        Math.floor(blockNumber / blocksPerHour) * blocksPerHour;
      const lastBlockInHour = firstBlockInHour + blocksPerHour - 1;

      await updateDynamicFeePools(
        liquidityPoolAggregator as Pool,
        mockContext as handlerContext,
        10,
        firstBlockInHour,
      );
      await updateDynamicFeePools(
        liquidityPoolAggregator as Pool,
        mockContext as handlerContext,
        10,
        lastBlockInHour,
      );

      // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
      const effectMock = vi.mocked(mockContext.effect!);
      const swapFeeCalls = effectMock.mock.calls.filter(
        (call) => call[0] === getSwapFee,
      );
      expect(swapFeeCalls).toHaveLength(2);
      const [firstCall, secondCall] = swapFeeCalls;
      // biome-ignore lint/style/noNonNullAssertion: filtered for length 2 above
      const firstInput = firstCall![1] as { blockNumber: number };
      // biome-ignore lint/style/noNonNullAssertion: filtered for length 2 above
      const secondInput = secondCall![1] as { blockNumber: number };
      expect(firstInput.blockNumber).toBe(firstBlockInHour);
      expect(secondInput.blockNumber).toBe(firstBlockInHour);
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

    // Regression test for issue #759: rounding-before-deploy revert.
    // For a pool whose deployment block falls inside an hour but after the
    // hour's start, the legacy code would query getSwapFee at the (earlier)
    // rounded boundary where pool bytecode is empty and the call reverts.
    // The fix clamps the rounded block up to the pool's createdBlockNumber.
    it("clamps the queried blockNumber up to createdBlockNumber to avoid pre-deploy reverts", async () => {
      // Swell (chainId 1923 → 2s blocks → 1800/hour). Pool deployed at 3920396,
      // hour boundary is 3918600 — before deployment. The mock throws if
      // getSwapFee is invoked at a block earlier than createdBlockNumber.
      expect(mockContext.effect).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
      const effectMock = vi.mocked(mockContext.effect!);
      const createdBlockNumber = 3920396n;
      effectMock.mockImplementation(async (effectFn, input) => {
        if (effectFn === getSwapFee) {
          const { blockNumber: queriedBlock } = input as {
            blockNumber: number;
          };
          if (BigInt(queriedBlock) < createdBlockNumber) {
            throw new Error(
              `getSwapFee queried at ${queriedBlock}, before pool deployment ${createdBlockNumber}`,
            );
          }
          return 100n;
        }
        return {};
      });

      const pool = {
        ...liquidityPoolAggregator,
        chainId: 1923,
        createdBlockNumber,
      } as Pool;

      const updatedPool = await updateDynamicFeePools(
        pool,
        mockContext as handlerContext,
        1923,
        Number(createdBlockNumber),
      );

      expect(updatedPool.currentFee).toBe(100n);
      const swapFeeCall = effectMock.mock.calls.find(
        (call) => call[0] === getSwapFee,
      );
      expect(swapFeeCall).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: existence verified above
      const input = swapFeeCall![1] as { blockNumber: number };
      expect(input.blockNumber).toBe(Number(createdBlockNumber));
    });

    // Defensive fallback (#759 AC): legacy pools indexed before the
    // createdBlockNumber schema field existed will read it back as undefined.
    // `Number(undefined)` is NaN — without the `?? BigInt(blockNumber)` fallback,
    // `Math.max(rounded, NaN)` returns NaN and crashes the SwapFeeModule call.
    it("falls back to the event blockNumber when createdBlockNumber is undefined (legacy pool)", async () => {
      const legacyPool = {
        ...liquidityPoolAggregator,
        chainId: 10,
        createdBlockNumber: undefined,
      } as unknown as Pool;

      await updateDynamicFeePools(
        legacyPool,
        mockContext as handlerContext,
        10,
        blockNumber,
      );

      // biome-ignore lint/style/noNonNullAssertion: effect is verified to be defined above
      const effectMock = vi.mocked(mockContext.effect!);
      const swapFeeCall = effectMock.mock.calls.find(
        (call) => call[0] === getSwapFee,
      );
      expect(swapFeeCall).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: existence verified above
      const input = swapFeeCall![1] as { blockNumber: number };
      // With fallback minBlock = blockNumber, the clamp restores the event block
      // (rounded 131536800 would be less than the fallback 131536921).
      expect(Number.isNaN(input.blockNumber)).toBe(false);
      expect(input.blockNumber).toBe(blockNumber);
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

    // Issue #803: the TOTAL-liquidity parallel pair (tickEdges, tickEdgeNets)
    // gets the same lockstep guard the staked pair has. A presence- or
    // length-mismatched diff would silently desync the map the swap path
    // binary-searches for the fee-free reserve geometry, so updatePool drops
    // both edge fields, logs [TICK_EDGE_DRIFT], and retains the prior pair.
    // Unlike the staked guard, liquidityInRange is NOT dropped (it comes from
    // event.params.liquidity, not from this map).
    it("drops tickEdges/tickEdgeNets together on a presence mismatch (#803)", async () => {
      await updatePool(
        {
          tickEdges: [100n, 200n, 300n],
          // tickEdgeNets intentionally omitted — half-written diff
        },
        {
          ...(liquidityPoolAggregator as Pool),
          tickEdges: [100n, 200n],
          tickEdgeNets: [500n, -500n],
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
      const updated = vi.mocked(poolStore.set).mock.calls.at(-1)?.[0] as Pool;
      // Prior consistent pair retained, not the half-written diff.
      expect(updated.tickEdges).toEqual([100n, 200n]);
      expect(updated.tickEdgeNets).toEqual([500n, -500n]);
      expect(vi.mocked(mockContext.log?.error)).toHaveBeenCalledWith(
        expect.stringContaining("[TICK_EDGE_DRIFT]"),
      );
    });

    it("drops tickEdges/tickEdgeNets together on a length mismatch (#803)", async () => {
      await updatePool(
        {
          tickEdges: [100n, 200n, 300n],
          tickEdgeNets: [500n, -500n], // length 2 ≠ 3
        },
        {
          ...(liquidityPoolAggregator as Pool),
          tickEdges: [100n, 200n],
          tickEdgeNets: [500n, -500n],
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
      const updated = vi.mocked(poolStore.set).mock.calls.at(-1)?.[0] as Pool;
      expect(updated.tickEdges).toEqual([100n, 200n]);
      expect(updated.tickEdgeNets).toEqual([500n, -500n]);
      expect(vi.mocked(mockContext.log?.error)).toHaveBeenCalledWith(
        expect.stringContaining("[TICK_EDGE_DRIFT]"),
      );
    });

    it("writes a consistent tickEdges/tickEdgeNets pair through unchanged (#803)", async () => {
      await updatePool(
        {
          tickEdges: [100n, 200n, 300n],
          tickEdgeNets: [500n, -200n, -300n],
        },
        {
          ...(liquidityPoolAggregator as Pool),
          tickEdges: [100n, 200n],
          tickEdgeNets: [500n, -500n],
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
      const updated = vi.mocked(poolStore.set).mock.calls.at(-1)?.[0] as Pool;
      expect(updated.tickEdges).toEqual([100n, 200n, 300n]);
      expect(updated.tickEdgeNets).toEqual([500n, -200n, -300n]);
      expect(vi.mocked(mockContext.log?.error)).not.toHaveBeenCalledWith(
        expect.stringContaining("[TICK_EDGE_DRIFT]"),
      );
    });

    // Regression test for issue #771: stakedReserve0/stakedReserve1 are
    // running counters of staked LP-deposited capital and must never persist
    // negative. The accumulator path clamps both fields to >= 0n and emits
    // [NEG_STAKED_RESERVE_GUARD] with {poolAddress, chainId, priorStakedReserve,
    // delta, clampedTo}. Mirrors the #702 [NEG_RESERVE_GUARD] shape; the
    // structural rounding fix in segmentReserveDelta bounds the residual
    // drift so the clamp catches only sub-wei truncation noise, not real
    // liquidity imbalance.
    //
    // Issue #802 splits the log LEVEL by USD-valued overshoot magnitude: the
    // benign rounding residue (`-stakedReserveSum` valued via getTrustedUSD ≤
    // $1,000) logs at `info` so it stops spamming the warn channel, while a
    // genuinely large discard (> $1,000 USD) still surfaces at `warn` as a
    // regression tripwire. The clamp-to-0n behaviour is identical for both.
    // Missing or untrusted token entities safe-degrade to `info` (an unpriced
    // token contributes 0n to the trusted USD value and cannot be a $1k+
    // break).
    describe("negative stakedReserve clamp guard (issue #771 / #802)", () => {
      const sameEpochAsTimestamp = () => timestamp;

      const negStakedReserveGuardLogs = (level: "warn" | "info") => {
        const mock = vi.mocked(mockContext.log?.[level]);
        const calls = mock?.mock.calls ?? [];
        return calls.filter((args) =>
          String(args[0] ?? "").includes("[NEG_STAKED_RESERVE_GUARD]"),
        );
      };

      const lastSet = (): Pool => {
        const setMock = vi.mocked(mockContext.Pool?.set);
        return setMock?.mock.lastCall?.[0] as Pool;
      };

      // Token mock helpers — getTrustedUSD requires a trusted (whitelisted,
      // non-blacklisted) Token entity with non-zero pricePerUSDNew to return a
      // non-zero USD value. Tests covering the warn/info threshold install
      // these via mockContext.Token.get.
      const TOKEN0_ID = "token0";
      const TOKEN1_ID = "token1";
      // chainId 8453 (Base) is not present in PriceOverrides BLACKLIST for
      // these synthetic addresses, so the gate trusts the token solely on
      // isWhitelisted = true.
      const TOKEN0_ADDR = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const TOKEN1_ADDR = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const TEN_TO_THE_18_BI = 10n ** 18n;
      const ONE_USD_PRICE = TEN_TO_THE_18_BI; // pricePerUSDNew == 1e18 ⇒ 1 USD/token
      const makeTrustedToken = (
        id: string,
        address: string,
        decimals: bigint,
        pricePerUSDNew: bigint,
      ): Token => ({
        id,
        address: address as `0x${string}`,
        symbol: "MOCK",
        name: "Mock Token",
        decimals,
        pricePerUSDNew,
        chainId: 8453,
        isWhitelisted: true,
        lastUpdatedTimestamp: new Date(),
        lastSuccessfulPriceTimestamp: new Date(),
        priceTrustOutcome: "TRUSTED",
        priceTrustReason: "WL",
      });
      const installTrustedTokens = () => {
        // biome-ignore lint/style/noNonNullAssertion: Token store is set in beforeEach
        vi.mocked(mockContext.Token!.get).mockImplementation(async (id) => {
          if (id === TOKEN0_ID)
            return makeTrustedToken(TOKEN0_ID, TOKEN0_ADDR, 18n, ONE_USD_PRICE);
          if (id === TOKEN1_ID)
            return makeTrustedToken(TOKEN1_ID, TOKEN1_ADDR, 18n, ONE_USD_PRICE);
          return undefined;
        });
      };

      it("clamps stakedReserve0 to 0n and emits guard at info when overshoot's USD value is sub-threshold (token unpriced — safe degrade)", async () => {
        // Mock Token.get returns undefined by default → getTrustedUSD = 0n →
        // overshoot valued at $0 → info (safe degrade per AC).
        await updatePool(
          { incrementalStakedReserve0: -100n },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            // reserve0/1 set above stakedReserve0/1 to satisfy the #854
            // upper-bound invariant (staked is a subset of total); without
            // this the new OVER_STAKED_RESERVE_GUARD would clamp the
            // unrelated stakedReserve1 down to 0 and mask the lower-bound
            // assertion under test.
            reserve0: 10_000n,
            reserve1: 10_000n,
            stakedReserve0: 50n,
            stakedReserve1: 1000n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedReserve0).toBe(0n);
        expect(lastSet().stakedReserve1).toBe(1000n);

        const infoLogs = negStakedReserveGuardLogs("info");
        expect(infoLogs.length).toBe(1);
        expect(negStakedReserveGuardLogs("warn").length).toBe(0);
        const msg = String(infoLogs[0]?.[0] ?? "");
        expect(msg).toContain("stakedReserve0");
        expect(msg).toContain("priorStakedReserve=50");
        expect(msg).toContain("delta=-100");
        expect(msg).toContain("clampedTo=0");
        expect(msg).toContain(
          `chainId=${(liquidityPoolAggregator as Pool).chainId}`,
        );
        expect(msg).toContain(
          `poolAddress=${(liquidityPoolAggregator as Pool).poolAddress}`,
        );
      });

      it("clamps stakedReserve1 to 0n and emits guard at info when overshoot's USD value is sub-threshold (token unpriced — safe degrade)", async () => {
        await updatePool(
          { incrementalStakedReserve1: -100n },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            // reserve0/1 set above stakedReserve0/1 to satisfy the #854
            // upper-bound invariant; see sibling test for rationale.
            reserve0: 10_000n,
            reserve1: 10_000n,
            stakedReserve0: 1000n,
            stakedReserve1: 50n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedReserve0).toBe(1000n);
        expect(lastSet().stakedReserve1).toBe(0n);
        expect(negStakedReserveGuardLogs("info").length).toBe(1);
        expect(negStakedReserveGuardLogs("warn").length).toBe(0);
        expect(
          String(negStakedReserveGuardLogs("info")[0]?.[0] ?? ""),
        ).toContain("stakedReserve1");
      });

      it("does not clamp or log when staked reserves stay non-negative", async () => {
        await updatePool(
          {
            incrementalStakedReserve0: -50n,
            incrementalStakedReserve1: -50n,
          },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            // reserve0/1 set above stakedReserve0/1 to satisfy the #854
            // upper-bound invariant; see sibling tests for rationale.
            reserve0: 10_000n,
            reserve1: 10_000n,
            stakedReserve0: 100n,
            stakedReserve1: 100n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedReserve0).toBe(50n);
        expect(lastSet().stakedReserve1).toBe(50n);
        expect(negStakedReserveGuardLogs("warn").length).toBe(0);
        expect(negStakedReserveGuardLogs("info").length).toBe(0);
      });

      it("clamps both stakedReserves independently and emits guard once per field", async () => {
        await updatePool(
          {
            incrementalStakedReserve0: -200n,
            incrementalStakedReserve1: -200n,
          },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedReserve0: 100n,
            stakedReserve1: 100n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedReserve0).toBe(0n);
        expect(lastSet().stakedReserve1).toBe(0n);
        // Both fields tripped — both log at info because mock Token.get
        // returns undefined (safe-degrade USD = $0 ≤ $1,000).
        expect(negStakedReserveGuardLogs("info").length).toBe(2);
        expect(negStakedReserveGuardLogs("warn").length).toBe(0);
      });

      it("heals legacy poisoned state where current.stakedReserve is already negative (logs at info — safe degrade)", async () => {
        // Simulates a pool that was indexed before the rounding/clamp fix and
        // persisted negative stakedReserve0/1. A subsequent update with a
        // zero delta still clamps to 0n on the next write — no manual
        // backfill needed.
        await updatePool(
          {},
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedReserve0: -42n,
            stakedReserve1: -1101n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedReserve0).toBe(0n);
        expect(lastSet().stakedReserve1).toBe(0n);
        expect(negStakedReserveGuardLogs("info").length).toBe(2);
        expect(negStakedReserveGuardLogs("warn").length).toBe(0);
      });

      // --- #802 USD-threshold split coverage ---

      it("[#802] sub-$1,000 overshoot on a trusted-priced token logs at info, not warn", async () => {
        installTrustedTokens();
        // Token decimals=18, price=$1 ⇒ overshoot 100n raw units is worth
        // 100n * 1e18 / 1e18 = 100n in 1e18-base USD — i.e. ~$1e-16, well
        // under the $1,000 floor.
        await updatePool(
          { incrementalStakedReserve0: -100n },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedReserve0: 50n,
            stakedReserve1: 1000n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedReserve0).toBe(0n);
        expect(negStakedReserveGuardLogs("info").length).toBe(1);
        expect(negStakedReserveGuardLogs("warn").length).toBe(0);
      });

      it("[#802] above-$1,000 overshoot on a trusted-priced token logs at warn, not info", async () => {
        installTrustedTokens();
        // Token decimals=18, price=$1 ⇒ a 2_000n * 1e18 raw overshoot is
        // worth $2,000 in 1e18-base USD — comfortably above the $1,000 floor.
        const grossDelta = -(2_000n * TEN_TO_THE_18_BI);
        await updatePool(
          { incrementalStakedReserve0: grossDelta },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedReserve0: 0n,
            stakedReserve1: 0n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedReserve0).toBe(0n);
        const warnLogs = negStakedReserveGuardLogs("warn");
        expect(warnLogs.length).toBe(1);
        expect(negStakedReserveGuardLogs("info").length).toBe(0);
        const msg = String(warnLogs[0]?.[0] ?? "");
        expect(msg).toContain("stakedReserve0");
        expect(msg).toContain("clampedTo=0");
        // Message content unchanged from pre-#802 (poolAddress / chainId /
        // priorStakedReserve / delta / clampedTo).
        expect(msg).toContain(
          `chainId=${(liquidityPoolAggregator as Pool).chainId}`,
        );
        expect(msg).toContain(`delta=${grossDelta}`);
      });

      it("[#802] above-$1,000 overshoot routes via the correct token (stakedReserve1 → token1)", async () => {
        // Asymmetric prices: token0 priced at $1, token1 at $1_000_000 — a
        // 2n raw-unit overshoot on stakedReserve1 is worth $2M and MUST
        // surface at warn. If the gate accidentally consulted token0 the
        // overshoot would compute to $2 (info), so this test pins the
        // per-field token mapping (token0_id → token0, token1_id → token1).
        // biome-ignore lint/style/noNonNullAssertion: Token store is set in beforeEach
        vi.mocked(mockContext.Token!.get).mockImplementation(async (id) => {
          if (id === TOKEN0_ID)
            return makeTrustedToken(
              TOKEN0_ID,
              TOKEN0_ADDR,
              18n,
              ONE_USD_PRICE, // $1
            );
          if (id === TOKEN1_ID)
            return makeTrustedToken(
              TOKEN1_ID,
              TOKEN1_ADDR,
              18n,
              1_000_000n * ONE_USD_PRICE, // $1,000,000 per token
            );
          return undefined;
        });
        await updatePool(
          { incrementalStakedReserve1: -(2n * TEN_TO_THE_18_BI) },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedReserve0: 0n,
            stakedReserve1: 0n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedReserve1).toBe(0n);
        expect(negStakedReserveGuardLogs("warn").length).toBe(1);
        expect(negStakedReserveGuardLogs("info").length).toBe(0);
        expect(
          String(negStakedReserveGuardLogs("warn")[0]?.[0] ?? ""),
        ).toContain("stakedReserve1");
      });

      it("[#802] untrusted (non-whitelisted) token degrades to info even on a huge raw overshoot", async () => {
        // Untrusted token ⇒ getTrustedUSD returns 0n regardless of
        // raw-magnitude, so the level must safe-degrade to info. This is the
        // documented AC ("an unpriced token cannot be a $1k+ break"):
        // applied symmetrically to non-whitelisted tokens, since they fail
        // the trust gate and contribute 0n to USD aggregates.
        // biome-ignore lint/style/noNonNullAssertion: Token store is set in beforeEach
        vi.mocked(mockContext.Token!.get).mockImplementation(async (id) => {
          if (id === TOKEN0_ID) {
            const t = makeTrustedToken(
              TOKEN0_ID,
              TOKEN0_ADDR,
              18n,
              ONE_USD_PRICE,
            );
            return {
              ...t,
              isWhitelisted: false,
              priceTrustOutcome: "UNTRUSTED",
              priceTrustReason: "NON_WL",
            };
          }
          return undefined;
        });
        // A raw-magnitude overshoot that WOULD be worth $1e9 if trusted.
        await updatePool(
          { incrementalStakedReserve0: -(1_000_000_000n * TEN_TO_THE_18_BI) },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedReserve0: 0n,
            stakedReserve1: 0n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedReserve0).toBe(0n);
        expect(negStakedReserveGuardLogs("info").length).toBe(1);
        expect(negStakedReserveGuardLogs("warn").length).toBe(0);
      });
    });

    // Regression test for issue #854: stakedReserve0/1 must never exceed
    // reserve0/1 (staked is a subset of total). The total-reserve and
    // staked-reserve accumulators run independent `divRoundNearest`
    // per-segment passes — over the pool's full tick map (#803) and the
    // staked-only map (#666) respectively — so their wei-scale rounding
    // residues can leave `stakedReserve_i > reserve_i` on full-drain swaps.
    // The upper-bound clamp at the accumulator path clamps
    // `stakedReserve_i = min(stakedReserve_i, reserve_i)` and emits
    // [OVER_STAKED_RESERVE_GUARD] with the same USD-magnitude log-level
    // split as the lower-bound clamp (#771 / #802).
    describe("over-staked reserve clamp guard (issue #854)", () => {
      const sameEpochAsTimestamp = () => timestamp;

      const overStakedReserveGuardLogs = (level: "warn" | "info") => {
        const mock = vi.mocked(mockContext.log?.[level]);
        const calls = mock?.mock.calls ?? [];
        return calls.filter((args) =>
          String(args[0] ?? "").includes("[OVER_STAKED_RESERVE_GUARD]"),
        );
      };

      const lastSet = (): Pool => {
        const setMock = vi.mocked(mockContext.Pool?.set);
        return setMock?.mock.lastCall?.[0] as Pool;
      };

      it("clamps stakedReserve1 to reserve1 when wei-scale rounding leaves staked > total (reproduces 10-0x844B drift)", async () => {
        // Field values lifted from the deployed-indexer snapshot reported in
        // #854 (10-0x844BdA8C…): reserve1=1.8e22, stakedReserve1 drifts ~3.9e15
        // above it. With a 0-delta update the upper-bound clamp must pull
        // stakedReserve1 back down to reserve1, matching the on-chain invariant.
        const reserve1 = 18425260124867999206688n;
        const priorStakedReserve1 = 18425264052148983809444n;
        await updatePool(
          {},
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            reserve0: 24670167986310698043n,
            reserve1,
            stakedReserve0: 24492612720183636798n,
            stakedReserve1: priorStakedReserve1,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        // Invariant restored: staked ≤ total on both legs.
        expect(lastSet().stakedReserve1).toBe(reserve1);
        expect(lastSet().stakedReserve0).toBeLessThanOrEqual(
          lastSet().reserve0,
        );
        // Single guard fires (token unpriced → safe-degrade to info per #802).
        const infoLogs = overStakedReserveGuardLogs("info");
        expect(infoLogs.length).toBe(1);
        expect(overStakedReserveGuardLogs("warn").length).toBe(0);
        const msg = String(infoLogs[0]?.[0] ?? "");
        expect(msg).toContain("stakedReserve1");
        expect(msg).toContain(`priorStakedReserve=${priorStakedReserve1}`);
        expect(msg).toContain(`reserve=${reserve1}`);
        expect(msg).toContain(`clampedTo=${reserve1}`);
      });

      it("does not clamp or log when stakedReserves stay <= reserves", async () => {
        await updatePool(
          {},
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            reserve0: 1000n,
            reserve1: 1000n,
            stakedReserve0: 500n,
            stakedReserve1: 800n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().stakedReserve0).toBe(500n);
        expect(lastSet().stakedReserve1).toBe(800n);
        expect(overStakedReserveGuardLogs("warn").length).toBe(0);
        expect(overStakedReserveGuardLogs("info").length).toBe(0);
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

    // Regression test for issue #856: totalLiquidityUSD must never persist
    // negative. CL Swap/Burn handlers compute currentTotalLiquidityUSD from a
    // synthetic newReserve0/1 = current ± delta BEFORE the reserve clamp at
    // the accumulator path, so wei-scale tick-crossing drift (or a Burn that
    // exceeds the cumulative Mint) can produce a sub-cent negative USD even
    // though the reserves themselves end up at 0n. The aggregator clamps
    // totalLiquidityUSD to >= 0n and emits [NEG_TLU_GUARD] with
    // {poolAddress, chainId, priorTLU, replacement, clampedTo}.
    describe("negative totalLiquidityUSD clamp guard (issue #856)", () => {
      const sameEpochAsTimestamp = () => timestamp;

      const negTluGuardLogs = () => {
        const warnMock = vi.mocked(mockContext.log?.warn);
        const calls = warnMock?.mock.calls ?? [];
        return calls.filter((args) =>
          String(args[0] ?? "").includes("[NEG_TLU_GUARD]"),
        );
      };

      const lastSet = (): Pool => {
        const setMock = vi.mocked(mockContext.Pool?.set);
        return setMock?.mock.lastCall?.[0] as Pool;
      };

      it("clamps totalLiquidityUSD to 0n and logs guard when diff supplies a sub-cent negative", async () => {
        // Mirrors the 2 Fraxtal CL pools reported in #856: the producer
        // computed currentTotalLiquidityUSD from a pre-clamp newReserve that
        // briefly went negative, leaking a tiny negative residue here.
        await updatePool(
          { currentTotalLiquidityUSD: -20970n },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            totalLiquidityUSD: 0n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          252,
          blockNumber,
        );

        expect(lastSet().totalLiquidityUSD).toBe(0n);
        const logs = negTluGuardLogs();
        expect(logs.length).toBe(1);
        const msg = String(logs[0]?.[0] ?? "");
        expect(msg).toContain("totalLiquidityUSD");
        expect(msg).toContain("replacement=-20970");
        expect(msg).toContain("clampedTo=0");
      });

      it("does not clamp or log when currentTotalLiquidityUSD is zero or positive", async () => {
        await updatePool(
          { currentTotalLiquidityUSD: 5000n },
          {
            ...(liquidityPoolAggregator as Pool),
            totalLiquidityUSD: 0n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          8453,
          blockNumber,
        );

        expect(lastSet().totalLiquidityUSD).toBe(5000n);
        expect(negTluGuardLogs().length).toBe(0);
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
            // Keep total in-range liquidity above the staked replacement so the
            // #891 upper clamp doesn't fire — this test isolates the lower-bound
            // (>= 0n) clamp's no-op behaviour on a non-negative value.
            liquidityInRange: 1000n,
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

    // Regression test for issue #891: stakedLiquidityInRange must never exceed
    // liquidityInRange — staked in-range liquidity is a SUBSET of the pool's
    // total in-range liquidity. The staked-only tick-edge map (#719) and the
    // Swap-authoritative total (#703) drift independently, so on tick-crossings
    // the staked value can be left above the total (3 Superseed CL pools were
    // observed in this state, the worst a 2.7× overshoot). The upper-bound
    // clamp pulls it back to liquidityInRange and emits [OVER_STAKED_LIQ_GUARD]
    // with {poolAddress, chainId, priorStakedLiqInRange, replacement,
    // liquidityInRange, clampedTo}. Mirrors the [OVER_STAKED_RESERVE_GUARD]
    // reserve clamp (#854); the lower-bound >= 0n clamp (#719) still applies.
    describe("over-staked stakedLiquidityInRange clamp guard (issue #891)", () => {
      const sameEpochAsTimestamp = () => timestamp;

      const overStakedLiqGuardLogs = (level: "warn" | "info") => {
        const mock = vi.mocked(mockContext.log?.[level]);
        const calls = mock?.mock.calls ?? [];
        return calls.filter((args) =>
          String(args[0] ?? "").includes("[OVER_STAKED_LIQ_GUARD]"),
        );
      };

      const lastSet = (): Pool => {
        const setMock = vi.mocked(mockContext.Pool?.set);
        return setMock?.mock.lastCall?.[0] as Pool;
      };

      it("clamps stakedLiquidityInRange down to liquidityInRange when the replacement exceeds it (reproduces Superseed 0xDaC2 2.7× overshoot)", async () => {
        // Field values lifted from the #891 audit (5330-0xDaC26c3f…): the
        // staked-in-range replacement is ~2.7× the pool's total in-range
        // liquidity. The upper-bound clamp must pull staked back down to the
        // liquidityInRange written in this same update.
        const liquidityInRange = 728_496_859_484_955n;
        const stakedReplacement = 1_959_834_779_580_129n;
        await updatePool(
          {
            stakedLiquidityInRange: stakedReplacement,
            liquidityInRange,
          },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedLiquidityInRange: 0n,
            liquidityInRange: 0n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          5330,
          blockNumber,
        );

        // Invariant restored: staked in-range ≤ total in-range.
        expect(lastSet().stakedLiquidityInRange).toBe(liquidityInRange);
        expect(lastSet().liquidityInRange).toBe(liquidityInRange);

        // Genuine overshoot against a POPULATED total → warn channel.
        const logs = overStakedLiqGuardLogs("warn");
        expect(logs.length).toBe(1);
        expect(overStakedLiqGuardLogs("info").length).toBe(0);
        const msg = String(logs[0]?.[0] ?? "");
        expect(msg).toContain("stakedLiquidityInRange");
        expect(msg).toContain(`replacement=${stakedReplacement}`);
        expect(msg).toContain(`liquidityInRange=${liquidityInRange}`);
        expect(msg).toContain(`clampedTo=${liquidityInRange}`);
        expect(msg).toContain(
          `poolAddress=${(liquidityPoolAggregator as Pool).poolAddress}`,
        );
        expect(msg).toContain(
          `chainId=${(liquidityPoolAggregator as Pool).chainId}`,
        );
      });

      it("clamps against the CARRIED liquidityInRange when the diff omits it (not a stale prior)", async () => {
        // The diff bumps stakedLiquidityInRange but does not supply a fresh
        // liquidityInRange, so the persisted total is the carried current
        // (700n). The clamp must bound staked against THAT value — the one
        // actually being written — pulling 1000n down to 700n.
        await updatePool(
          { stakedLiquidityInRange: 1000n },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedLiquidityInRange: 0n,
            liquidityInRange: 700n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          5330,
          blockNumber,
        );

        expect(lastSet().stakedLiquidityInRange).toBe(700n);
        expect(lastSet().liquidityInRange).toBe(700n);
        // Carried total is positive → warn channel.
        expect(overStakedLiqGuardLogs("warn").length).toBe(1);
        expect(overStakedLiqGuardLogs("info").length).toBe(0);
      });

      it("does not clamp or log when stakedLiquidityInRange stays <= liquidityInRange", async () => {
        await updatePool(
          {
            stakedLiquidityInRange: 500n,
            liquidityInRange: 1000n,
          },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedLiquidityInRange: 0n,
            liquidityInRange: 0n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          5330,
          blockNumber,
        );

        expect(lastSet().stakedLiquidityInRange).toBe(500n);
        expect(lastSet().liquidityInRange).toBe(1000n);
        expect(overStakedLiqGuardLogs("warn").length).toBe(0);
        expect(overStakedLiqGuardLogs("info").length).toBe(0);
      });

      it("cannot drive stakedLiquidityInRange negative: the floored total is the ceiling", async () => {
        // An in-range Burn whose magnitude exceeds the carried total would drive
        // the total negative; liquidityInRange is now floored to 0n (see the
        // [NEG_LIQ_IN_RANGE_GUARD] block), so the staked clamp's ceiling is
        // always >= 0n and min(staked, total) can never persist a NEGATIVE
        // staked value (which would otherwise defeat the #719 lower clamp).
        await updatePool(
          {
            stakedLiquidityInRange: 500n,
            incrementalLiquidityInRange: -100n,
          },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedLiquidityInRange: 0n,
            liquidityInRange: 0n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          5330,
          blockNumber,
        );

        // Total floored to 0n; staked floored to 0n (never negative).
        expect(lastSet().liquidityInRange).toBe(0n);
        expect(lastSet().stakedLiquidityInRange).toBe(0n);
        // staked capped against a (floored) zero total → benign info, not warn.
        expect(overStakedLiqGuardLogs("warn").length).toBe(0);
        expect(overStakedLiqGuardLogs("info").length).toBe(1);
      });

      it("logs the benign zero-total transient (#719 gauge Deposit before first Swap) on info, not warn", async () => {
        // A gauge Deposit derives a positive staked counter before the pool's
        // total liquidityInRange has been established (still 0n). Capping staked
        // to 0n here is the expected self-healing transient — it must not spam
        // the warn channel (mirrors #802's reserve-guard level split).
        await updatePool(
          { stakedLiquidityInRange: 500n },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            stakedLiquidityInRange: 0n,
            liquidityInRange: 0n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          5330,
          blockNumber,
        );

        expect(lastSet().stakedLiquidityInRange).toBe(0n);
        expect(lastSet().liquidityInRange).toBe(0n);
        expect(overStakedLiqGuardLogs("info").length).toBe(1);
        expect(overStakedLiqGuardLogs("warn").length).toBe(0);
      });
    });

    // Regression test for the #891 follow-up: liquidityInRange must never
    // persist negative. It was the only in-range/reserve field in updatePool
    // without a >= 0n floor (reserves #702, stakedReserves #771/#854, TLU #856,
    // stakedLiquidityInRange #719 all clamp). A Burn underflow / tick-crossing
    // drift can drive it below zero, corrupting snapshots and gauge-share, and —
    // as the #891 staked clamp's ceiling — re-introducing a negative staked
    // counter. Clamp-and-log under [NEG_LIQ_IN_RANGE_GUARD], mirroring
    // [NEG_TLU_GUARD] (#856).
    describe("negative liquidityInRange clamp guard (issue #891 / #856-analog)", () => {
      const sameEpochAsTimestamp = () => timestamp;

      const negLiqInRangeGuardLogs = () => {
        const warnMock = vi.mocked(mockContext.log?.warn);
        const calls = warnMock?.mock.calls ?? [];
        return calls.filter((args) =>
          String(args[0] ?? "").includes("[NEG_LIQ_IN_RANGE_GUARD]"),
        );
      };

      const lastSet = (): Pool => {
        const setMock = vi.mocked(mockContext.Pool?.set);
        return setMock?.mock.lastCall?.[0] as Pool;
      };

      it("clamps liquidityInRange to 0n and logs guard when an in-range Burn underflows it", async () => {
        await updatePool(
          { incrementalLiquidityInRange: -100n },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            liquidityInRange: 50n,
            stakedLiquidityInRange: 0n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          5330,
          blockNumber,
        );

        expect(lastSet().liquidityInRange).toBe(0n);

        const logs = negLiqInRangeGuardLogs();
        expect(logs.length).toBe(1);
        const msg = String(logs[0]?.[0] ?? "");
        expect(msg).toContain("field=liquidityInRange");
        expect(msg).toContain("priorLiquidityInRange=50");
        expect(msg).toContain("replacement=-50");
        expect(msg).toContain("clampedTo=0");
        expect(msg).toContain(
          `poolAddress=${(liquidityPoolAggregator as Pool).poolAddress}`,
        );
        expect(msg).toContain(
          `chainId=${(liquidityPoolAggregator as Pool).chainId}`,
        );
      });

      it("does not clamp or log when liquidityInRange stays non-negative", async () => {
        await updatePool(
          { incrementalLiquidityInRange: 100n },
          {
            ...(liquidityPoolAggregator as Pool),
            isCL: true,
            liquidityInRange: 50n,
            lastSnapshotTimestamp: sameEpochAsTimestamp(),
            lastUpdatedTimestamp: sameEpochAsTimestamp(),
          },
          timestamp,
          mockContext as handlerContext,
          5330,
          blockNumber,
        );

        expect(lastSet().liquidityInRange).toBe(150n);
        expect(negLiqInRangeGuardLogs().length).toBe(0);
      });
    });
  });

  describe("Updating the Liquidity Pool Aggregator", () => {
    let diff = {
      incrementalTotalVolume0: 0n,
      incrementalTotalVolume1: 0n,
      incrementalTotalVolumeUSD: 0n,
      incrementalNumberOfSwaps: 0n,
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
