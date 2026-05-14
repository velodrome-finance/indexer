import type { LiquidityPoolAggregator, Token } from "generated";
import { CLPool } from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { processCLPoolMint } from "../../../src/EventHandlers/CLPool/CLPoolMintLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolMintLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();

  const mockEvent = CLPool.Mint.createMockEvent({
    owner: toChecksumAddress("0x1111111111111111111111111111111111111111"),
    tickLower: 100000n,
    tickUpper: 200000n,
    amount: 1000000000000000000n, // 1 token
    amount0: 500000000000000000n, // 0.5 token
    amount1: 300000000000000000n, // 0.3 token
    mockEventData: {
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      chainId: 10,
      logIndex: 1,
      srcAddress: toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      ),
      transaction: {
        hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      },
    },
  });

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

  const mockLiquidityPoolAggregator = {
    ...mockLiquidityPoolData,
    reserve0: 1000000000000000000n,
    reserve1: 2000000000000000000n,
    totalLiquidityUSD: 5000000000000000000n,
  } as LiquidityPoolAggregator;

  describe("processCLPoolMint", () => {
    it("should process mint event successfully with valid data", () => {
      const result = processCLPoolMint(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      // Check liquidity pool diff with exact values
      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(
        500000000000000000n,
      ); // amount0 (0.5 token)
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(
        300000000000000000n,
      ); // amount1 (0.3 token)

      // Post-mint reserves: token0 = 1.5, token1 = 2.3 -> TVL = 1.5 + 4.6 = 6.1 USD
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBe(
        6100000000000000000n,
      );
    });

    it("should calculate correct liquidity values for mint event", () => {
      const result = processCLPoolMint(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      // The liquidity pool diff should reflect the amounts being added with exact values
      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(
        500000000000000000n,
      ); // amount0
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(
        300000000000000000n,
      ); // amount1
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBe(
        6100000000000000000n,
      );
    });

    it("should handle different token decimals correctly", () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n, // USDC-like token
      };

      const result = processCLPoolMint(
        mockEvent,
        mockLiquidityPoolAggregator,
        tokenWithDifferentDecimals,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).toBeDefined();
    });

    it("should handle zero amounts correctly", () => {
      const eventWithZeroAmounts = CLPool.Mint.createMockEvent({
        owner: mockEvent.params.owner,
        tickLower: mockEvent.params.tickLower,
        tickUpper: mockEvent.params.tickUpper,
        amount: mockEvent.params.amount,
        amount0: 0n,
        amount1: 0n,
        mockEventData: {
          block: mockEvent.block,
          chainId: mockEvent.chainId,
          logIndex: mockEvent.logIndex,
          srcAddress: mockEvent.srcAddress,
          transaction: mockEvent.transaction,
        },
      });

      const result = processCLPoolMint(
        eventWithZeroAmounts,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(0n);
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBe(
        5000000000000000000n,
      );
    });

    it("should increment liquidityInRange when tickLower <= aggregator.tick < tickUpper (in-range)", () => {
      // mockEvent uses tickLower=100000, tickUpper=200000.
      // Place aggregator.tick mid-range so the position contributes its full L.
      const inRangeAggregator = {
        ...mockLiquidityPoolAggregator,
        tick: 150000n,
        liquidityInRange: 7_000_000_000n,
      } as LiquidityPoolAggregator;

      const result = processCLPoolMint(
        mockEvent,
        inRangeAggregator,
        mockToken0,
        mockToken1,
      );

      // event.params.amount = 1e18 — full L contribution
      expect(result.liquidityPoolDiff.incrementalLiquidityInRange).toBe(
        1000000000000000000n,
      );
      // Swap-authoritative replace must NOT be set on Mint
      expect(result.liquidityPoolDiff.liquidityInRange).toBeUndefined();
    });

    it("should not touch liquidityInRange when position is out of range (tick below tickLower)", () => {
      // Default mockLiquidityPoolAggregator.tick = 0n, tickLower = 100000n → below.
      const result = processCLPoolMint(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      expect(
        result.liquidityPoolDiff.incrementalLiquidityInRange,
      ).toBeUndefined();
      expect(result.liquidityPoolDiff.liquidityInRange).toBeUndefined();
    });

    it("should not touch liquidityInRange when position is out of range (tick at or above tickUpper)", () => {
      // tickUpper is exclusive: tick === tickUpper means out-of-range above.
      const aboveAggregator = {
        ...mockLiquidityPoolAggregator,
        tick: 200000n,
      } as LiquidityPoolAggregator;

      const result = processCLPoolMint(
        mockEvent,
        aboveAggregator,
        mockToken0,
        mockToken1,
      );

      expect(
        result.liquidityPoolDiff.incrementalLiquidityInRange,
      ).toBeUndefined();
    });

    it("should include the boundary at tickLower (inclusive)", () => {
      const atLowerAggregator = {
        ...mockLiquidityPoolAggregator,
        tick: 100000n,
      } as LiquidityPoolAggregator;

      const result = processCLPoolMint(
        mockEvent,
        atLowerAggregator,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff.incrementalLiquidityInRange).toBe(
        1000000000000000000n,
      );
    });
  });
});
