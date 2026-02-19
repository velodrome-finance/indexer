import type {
  CLPool_Burn_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
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
    srcAddress: "0x1234567890123456789012345678901234567890",
    transaction: {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    },
    params: {
      owner: "0xabcdef1234567890abcdef1234567890abcdef12",
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

  describe("processCLPoolBurn", () => {
    it("should process burn event successfully with valid data", () => {
      const result = processCLPoolBurn(mockEvent, mockToken0, mockToken1);

      // Check liquidity pool diff with exact values (negative because burning decreases reserves)
      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(-500000n); // -amount0 (delta)
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(-300000n); // -amount1 (delta)

      // Calculate exact totalLiquidityUSD: (500000 * 1 USD) + (300000 * 2 USD) = 500000 + 600000 = 1100000 USD (negative because reserves decrease)
      expect(result.liquidityPoolDiff.incrementalCurrentLiquidityUSD).toBe(
        -1100000n,
      ); // -1.1M USD in 18 decimals
    });

    it("should calculate correct liquidity values for burn event", () => {
      const result = processCLPoolBurn(mockEvent, mockToken0, mockToken1);

      // The liquidity pool diff should reflect the reserve deltas (negative because burning decreases reserves)
      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(-500000n); // -amount0 (delta)
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(-300000n); // -amount1 (delta)
      expect(result.liquidityPoolDiff.incrementalCurrentLiquidityUSD).toBe(
        -1100000n,
      ); // Negative because reserves decrease
    });

    it("should handle different token decimals correctly", () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n, // USDC-like token
      };

      const result = processCLPoolBurn(
        mockEvent,
        tokenWithDifferentDecimals,
        mockToken1,
      );

      // Calculate expected values using the same logic as processCLPoolBurn
      const expectedTotalLiquidityUSD = calculateTotalUSD(
        mockEvent.params.amount0,
        mockEvent.params.amount1,
        tokenWithDifferentDecimals,
        mockToken1,
      );

      // Expected liquidity pool diff (negative because burning decreases reserves)
      const expectedLiquidityPoolDiff = {
        incrementalReserve0: -mockEvent.params.amount0, // -500000n
        incrementalReserve1: -mockEvent.params.amount1, // -300000n
        incrementalCurrentLiquidityUSD: -expectedTotalLiquidityUSD,
      };

      // Assert liquidity pool diff with precise values
      expect(result.liquidityPoolDiff.incrementalReserve0).toEqual(
        expectedLiquidityPoolDiff.incrementalReserve0,
      );
      expect(result.liquidityPoolDiff.incrementalReserve1).toEqual(
        expectedLiquidityPoolDiff.incrementalReserve1,
      );
      expect(result.liquidityPoolDiff.incrementalCurrentLiquidityUSD).toEqual(
        expectedLiquidityPoolDiff.incrementalCurrentLiquidityUSD,
      );
    });
  });
});
