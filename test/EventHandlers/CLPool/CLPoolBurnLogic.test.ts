import type {
  CLPool_Burn_event,
  CLPositionPendingPrincipal,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { toChecksumAddress } from "../../../src/Constants";
import { processCLPoolBurn } from "../../../src/EventHandlers/CLPool/CLPoolBurnLogic";
import { calculateTotalUSD } from "../../../src/Helpers";
import { setupCommon } from "../Pool/common";

describe("CLPoolBurnLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const mockEvent = {
    chainId: 10,
    block: {
      number: 12345,
      timestamp: 1000000,
    },
    logIndex: 1,
    srcAddress: toChecksumAddress("0x1234567890123456789012345678901234567890"),
    transaction: {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    },
    params: {
      owner: toChecksumAddress("0xabcdef1234567890abcdef1234567890abcdef12"),
      tickLower: -1000n,
      tickUpper: 1000n,
      amount: 1000000n,
      amount0: 500000n,
      amount1: 300000n,
    },
  } as unknown as CLPool_Burn_event;

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

  const mockLiquidityPoolAggregator: LiquidityPoolAggregator = {
    ...mockLiquidityPoolData,
    reserve0: 1000000n,
    reserve1: 3000000000000000000n,
    totalLiquidityUSD: 7000000000000000000n,
  };

  /** Creates a mock context that tracks CLPositionPendingPrincipal get/set */
  function createMockContext(
    existingTracker?: CLPositionPendingPrincipal | null,
  ): handlerContext {
    return {
      CLPositionPendingPrincipal: {
        get: vi.fn().mockResolvedValue(existingTracker ?? null),
        set: vi.fn(),
      },
    } as unknown as handlerContext;
  }

  describe("processCLPoolBurn", () => {
    it("should process burn event successfully with valid data", async () => {
      const ctx = createMockContext();
      const result = await processCLPoolBurn(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        ctx,
      );

      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(-500000n);
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(-300000n);
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBe(
        5999999999999900000n,
      );
    });

    it("should track burned principal in CLPositionPendingPrincipal", async () => {
      const ctx = createMockContext();
      await processCLPoolBurn(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        ctx,
      );

      // Should have called set with burn amounts
      const setCall = vi.mocked(ctx.CLPositionPendingPrincipal.set).mock
        .lastCall?.[0] as CLPositionPendingPrincipal;
      expect(setCall.pendingPrincipal0).toBe(500000n);
      expect(setCall.pendingPrincipal1).toBe(300000n);
    });

    it("should accumulate principal across multiple burns", async () => {
      const existingTracker: CLPositionPendingPrincipal = {
        id: "tracker",
        pendingPrincipal0: 100000n,
        pendingPrincipal1: 200000n,
      };
      const ctx = createMockContext(existingTracker);
      await processCLPoolBurn(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        ctx,
      );

      const setCall = vi.mocked(ctx.CLPositionPendingPrincipal.set).mock
        .lastCall?.[0] as CLPositionPendingPrincipal;
      expect(setCall.pendingPrincipal0).toBe(600000n); // 100000 + 500000
      expect(setCall.pendingPrincipal1).toBe(500000n); // 200000 + 300000
    });

    it("should handle different token decimals correctly", async () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n,
      };
      const ctx = createMockContext();
      const result = await processCLPoolBurn(
        mockEvent,
        mockLiquidityPoolAggregator,
        tokenWithDifferentDecimals,
        mockToken1,
        ctx,
      );

      const expectedLiquidityPoolDiff = {
        incrementalReserve0: -mockEvent.params.amount0,
        incrementalReserve1: -mockEvent.params.amount1,
        currentTotalLiquidityUSD: calculateTotalUSD(
          mockLiquidityPoolAggregator.reserve0 - mockEvent.params.amount0,
          mockLiquidityPoolAggregator.reserve1 - mockEvent.params.amount1,
          tokenWithDifferentDecimals,
          mockToken1,
        ),
      };

      expect(result.liquidityPoolDiff.incrementalReserve0).toEqual(
        expectedLiquidityPoolDiff.incrementalReserve0,
      );
      expect(result.liquidityPoolDiff.incrementalReserve1).toEqual(
        expectedLiquidityPoolDiff.incrementalReserve1,
      );
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toEqual(
        expectedLiquidityPoolDiff.currentTotalLiquidityUSD,
      );
    });
  });
});
