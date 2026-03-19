import type {
  CLPool_Collect_event,
  CLPositionPendingPrincipal,
  Token,
  handlerContext,
} from "generated";
import { toChecksumAddress } from "../../../src/Constants";
import { processCLPoolCollect } from "../../../src/EventHandlers/CLPool/CLPoolCollectLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolCollectLogic", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();

  const POOL_ADDRESS = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );

  const mockEvent: CLPool_Collect_event = {
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
  } as CLPool_Collect_event;

  const mockToken0: Token = {
    ...mockToken0Data,
    id: "token0_id",
    address: "0xtoken0",
    symbol: "TOKEN0",
    name: "Token 0",
    isWhitelisted: false,
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
    isWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  /** Creates a mock context with optional pending principal tracker */
  function createMockContext(
    tracker?: CLPositionPendingPrincipal | null,
  ): handlerContext {
    const storedTracker = { current: tracker ?? null };
    return {
      CLPositionPendingPrincipal: {
        get: vi.fn().mockResolvedValue(storedTracker.current),
        set: vi.fn((t: CLPositionPendingPrincipal) => {
          storedTracker.current = t;
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

      // Tracker should be fully drained
      const setCall = vi.mocked(ctx.CLPositionPendingPrincipal.set).mock
        .lastCall?.[0] as CLPositionPendingPrincipal;
      expect(setCall.pendingPrincipal0).toBe(0n);
      expect(setCall.pendingPrincipal1).toBe(0n);
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
      const eventWithZeroAmounts: CLPool_Collect_event = {
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
});
