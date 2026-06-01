import type { EvmEvent } from "envio";
import type { CLPositionPendingPrincipal, Token } from "envio";
import {
  CLPositionPendingPrincipalId,
  toChecksumAddress,
} from "../../../src/Constants";
import type { Pool, handlerContext } from "../../../src/EntityTypes";
import { processCLPoolBurn } from "../../../src/EventHandlers/CLPool/CLPoolBurnLogic";
import { processCLPoolCollect } from "../../../src/EventHandlers/CLPool/CLPoolCollectLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolCollectLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();

  const POOL_ADDRESS = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );

  const mockEvent: EvmEvent<"CLPool", "Collect"> = {
    params: {
      owner: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      recipient: toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      ),
      tickLower: 100000n,
      tickUpper: 200000n,
      amount0: 1000000000000000000n, // 1 token
      amount1: 2000000000000000000n, // 2 tokens
    },
    block: {
      timestamp: 1000000,
      number: 123456,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    },
    chainId: 10,
    logIndex: 1,
    srcAddress: POOL_ADDRESS,
    transaction: {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    },
  } as EvmEvent<"CLPool", "Collect">;

  const mockToken0: Token = {
    ...mockToken0Data,
    id: "token0_id",
    address: "0xtoken0",
    symbol: "TOKEN0",
    name: "Token 0",
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  const mockToken1: Token = {
    ...mockToken1Data,
    id: "token1_id",
    address: "0xtoken1",
    symbol: "TOKEN1",
    name: "Token 1",
    decimals: 18n,
    pricePerUSDNew: 2000000000000000000n,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  /**
   * Creates a mock context with optional pending principal tracker.
   * The store is dynamic: `get` reflects the latest `set`/`deleteUnsafe`, so a
   * real Burn → Collect sequence can be observed end-to-end.
   */
  function createMockContext(
    tracker?: CLPositionPendingPrincipal | null,
  ): handlerContext {
    const storedTracker = { current: tracker ?? null };
    return {
      CLPositionPendingPrincipal: {
        get: vi.fn(async () => storedTracker.current),
        set: vi.fn((t: CLPositionPendingPrincipal) => {
          storedTracker.current = t;
        }),
        deleteUnsafe: vi.fn((_id: string) => {
          storedTracker.current = null;
        }),
      },
    } as unknown as handlerContext;
  }

  describe("processCLPoolCollect", () => {
    it("should treat entire amount as fees when no prior burns exist", async () => {
      const ctx = createMockContext(null);
      const result = await processCLPoolCollect(
        mockEvent,
        mockToken0,
        mockToken1,
        ctx,
      );

      // No pending principal → entire collect amount is fees
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected0,
      ).toBe(1000000000000000000n);
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected1,
      ).toBe(2000000000000000000n);
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollectedUSD,
      ).toBe(5000000000000000000n); // 1*$1 + 2*$2 = $5

      expect(
        result.userLiquidityDiff.incrementalTotalUnstakedFeesCollected0,
      ).toBe(1000000000000000000n);
      expect(
        result.userLiquidityDiff.incrementalTotalUnstakedFeesCollected1,
      ).toBe(2000000000000000000n);
      expect(
        result.userLiquidityDiff.incrementalTotalUnstakedFeesCollectedUSD,
      ).toBe(5000000000000000000n);
    });

    it("should subtract burned principal to isolate fees", async () => {
      // Burn of 0.8 token0 and 1.5 token1 preceded this collect
      const tracker: CLPositionPendingPrincipal = {
        id: "tracker",
        pendingPrincipal0: 800000000000000000n, // 0.8 token0
        pendingPrincipal1: 1500000000000000000n, // 1.5 token1
      };
      const ctx = createMockContext(tracker);
      const result = await processCLPoolCollect(
        mockEvent,
        mockToken0,
        mockToken1,
        ctx,
      );

      // fees0 = 1.0 - 0.8 = 0.2, fees1 = 2.0 - 1.5 = 0.5
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected0,
      ).toBe(200000000000000000n); // 0.2 token0
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected1,
      ).toBe(500000000000000000n); // 0.5 token1

      // Fully drained → tracker row is deleted, not persisted at 0/0 (#789)
      expect(ctx.CLPositionPendingPrincipal.deleteUnsafe).toHaveBeenCalledTimes(
        1,
      );
      expect(ctx.CLPositionPendingPrincipal.set).not.toHaveBeenCalled();
    });

    it("should handle collect smaller than pending principal (partial collect)", async () => {
      // More principal pending than what's being collected
      const tracker: CLPositionPendingPrincipal = {
        id: "tracker",
        pendingPrincipal0: 5000000000000000000n, // 5 tokens (larger than collect's 1)
        pendingPrincipal1: 10000000000000000000n, // 10 tokens (larger than collect's 2)
      };
      const ctx = createMockContext(tracker);
      const result = await processCLPoolCollect(
        mockEvent,
        mockToken0,
        mockToken1,
        ctx,
      );

      // Entire collect is principal, no fees
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected0,
      ).toBe(0n);
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected1,
      ).toBe(0n);
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollectedUSD,
      ).toBe(0n);

      // Tracker should retain remaining principal
      const setCall = vi.mocked(ctx.CLPositionPendingPrincipal.set).mock
        .lastCall?.[0] as CLPositionPendingPrincipal;
      expect(setCall.pendingPrincipal0).toBe(4000000000000000000n); // 5 - 1
      expect(setCall.pendingPrincipal1).toBe(8000000000000000000n); // 10 - 2
    });

    it("should handle zero collect amounts correctly", async () => {
      const eventWithZeroAmounts: EvmEvent<"CLPool", "Collect"> = {
        ...mockEvent,
        params: { ...mockEvent.params, amount0: 0n, amount1: 0n },
      };
      const ctx = createMockContext(null);
      const result = await processCLPoolCollect(
        eventWithZeroAmounts,
        mockToken0,
        mockToken1,
        ctx,
      );

      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected0,
      ).toBe(0n);
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected1,
      ).toBe(0n);
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollectedUSD,
      ).toBe(0n);
    });

    it("should only track unstaked fees, not staked fees", async () => {
      const ctx = createMockContext(null);
      const result = await processCLPoolCollect(
        mockEvent,
        mockToken0,
        mockToken1,
        ctx,
      );

      // Staked fees should not be present in the diff
      expect(result.liquidityPoolDiff).not.toHaveProperty(
        "incrementalTotalStakedFeesCollected0",
      );
      expect(result.liquidityPoolDiff).not.toHaveProperty(
        "incrementalTotalStakedFeesCollected1",
      );
      expect(result.liquidityPoolDiff).not.toHaveProperty(
        "incrementalTotalStakedFeesCollectedUSD",
      );
      // No reserve changes from Collect
      expect(result.liquidityPoolDiff).not.toHaveProperty(
        "incrementalReserve0",
      );
      expect(result.liquidityPoolDiff).not.toHaveProperty(
        "incrementalReserve1",
      );
      expect(result.liquidityPoolDiff).not.toHaveProperty(
        "currentTotalLiquidityUSD",
      );
    });

    it("should handle different token decimals correctly", async () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n,
      };
      const ctx = createMockContext(null);
      const result = await processCLPoolCollect(
        mockEvent,
        tokenWithDifferentDecimals,
        mockToken1,
        ctx,
      );

      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userLiquidityDiff).toBeDefined();
    });
  });

  // End-to-end reconciliation: a real Burn writes principal under the position's
  // tracker id, then a real Collect on the same identity drains it. Verifies the
  // tracker is deleted on full drain rather than lingering at 0/0 (#789).
  describe("tracker lifecycle (Burn → Collect)", () => {
    // Burn must share position identity (chain, pool, owner, ticks) with the
    // Collect mockEvent so both resolve to the same CLPositionPendingPrincipal id.
    const burnEvent = {
      chainId: mockEvent.chainId,
      block: { number: 123455, timestamp: 999999 },
      logIndex: 0,
      srcAddress: POOL_ADDRESS,
      transaction: {
        hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      },
      params: {
        owner: mockEvent.params.owner,
        tickLower: mockEvent.params.tickLower,
        tickUpper: mockEvent.params.tickUpper,
        amount: 0n,
        amount0: 1000000000000000000n, // 1 token0 burned
        amount1: 2000000000000000000n, // 2 token1 burned
      },
    } as unknown as EvmEvent<"CLPool", "Burn">;

    const trackerId = CLPositionPendingPrincipalId(
      mockEvent.chainId,
      mockEvent.srcAddress,
      mockEvent.params.owner,
      mockEvent.params.tickLower,
      mockEvent.params.tickUpper,
    );

    const burnPool: Pool = {
      ...mockLiquidityPoolData,
      reserve0: 1000000000000000000000n,
      reserve1: 1000000000000000000000n,
    };

    it("Burn → full Collect leaves no row", async () => {
      const ctx = createMockContext(null);
      await processCLPoolBurn(burnEvent, burnPool, mockToken0, mockToken1, ctx);
      // Collect amounts (1 / 2) exactly equal burned principal → full drain.
      await processCLPoolCollect(mockEvent, mockToken0, mockToken1, ctx);

      expect(ctx.CLPositionPendingPrincipal.deleteUnsafe).toHaveBeenCalledWith(
        trackerId,
      );
      expect(await ctx.CLPositionPendingPrincipal.get(trackerId)).toBeNull();
    });

    it("Burn → partial Collect leaves a nonzero row", async () => {
      const ctx = createMockContext(null);
      // Burn 5 token0 / 10 token1, then collect only 1 / 2 → remainder persists.
      const bigBurn = {
        ...burnEvent,
        params: {
          ...burnEvent.params,
          amount0: 5000000000000000000n,
          amount1: 10000000000000000000n,
        },
      } as unknown as EvmEvent<"CLPool", "Burn">;
      await processCLPoolBurn(bigBurn, burnPool, mockToken0, mockToken1, ctx);
      const result = await processCLPoolCollect(
        mockEvent,
        mockToken0,
        mockToken1,
        ctx,
      );

      expect(
        ctx.CLPositionPendingPrincipal.deleteUnsafe,
      ).not.toHaveBeenCalled();
      const row = await ctx.CLPositionPendingPrincipal.get(trackerId);
      expect(row?.pendingPrincipal0).toBe(4000000000000000000n); // 5 - 1
      expect(row?.pendingPrincipal1).toBe(8000000000000000000n); // 10 - 2
      // Entire collect was principal → no fees isolated.
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected0,
      ).toBe(0n);
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected1,
      ).toBe(0n);
    });

    it("re-uses position identity after full drain (tracker re-created from 0)", async () => {
      const ctx = createMockContext(null);
      // First lifecycle: burn 1 / 2, collect 1 / 2 → tracker deleted.
      await processCLPoolBurn(burnEvent, burnPool, mockToken0, mockToken1, ctx);
      await processCLPoolCollect(mockEvent, mockToken0, mockToken1, ctx);
      expect(await ctx.CLPositionPendingPrincipal.get(trackerId)).toBeNull();

      // Second lifecycle on the same identity: a new Burn re-creates the tracker
      // from 0, so the next Collect still isolates fees correctly
      // (1 - 0.8 = 0.2 token0, 2 - 1.5 = 0.5 token1).
      const reBurn = {
        ...burnEvent,
        params: {
          ...burnEvent.params,
          amount0: 800000000000000000n,
          amount1: 1500000000000000000n,
        },
      } as unknown as EvmEvent<"CLPool", "Burn">;
      await processCLPoolBurn(reBurn, burnPool, mockToken0, mockToken1, ctx);
      const result = await processCLPoolCollect(
        mockEvent,
        mockToken0,
        mockToken1,
        ctx,
      );

      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected0,
      ).toBe(200000000000000000n); // 0.2 token0
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected1,
      ).toBe(500000000000000000n); // 0.5 token1
      // Fully drained again → deleted again, no dormant row left behind.
      expect(await ctx.CLPositionPendingPrincipal.get(trackerId)).toBeNull();
    });
  });
});
