import type {
  CLPool_Mint_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { processCLPoolMint } from "../../../src/EventHandlers/CLPool/CLPoolMintLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolMintLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const mockEvent: CLPool_Mint_event = {
    params: {
      owner: "0x1111111111111111111111111111111111111111",
      tickLower: 100000n,
      tickUpper: 200000n,
      amount: 1000000000000000000n, // 1 token
      amount0: 500000000000000000n, // 0.5 token
      amount1: 300000000000000000n, // 0.3 token
    },
    block: {
      timestamp: 1000000,
      number: 123456,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    },
    chainId: 10,
    logIndex: 1,
    srcAddress: "0x3333333333333333333333333333333333333333",
    transaction: {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    },
  } as CLPool_Mint_event;

  const mockLiquidityPoolAggregator: LiquidityPoolAggregator = {
    ...mockLiquidityPoolData,
    id: "0x1234567890123456789012345678901234567890",
    token0_id: mockToken0Data.id,
    token1_id: mockToken1Data.id,
    token0_address: mockToken0Data.address,
    token1_address: mockToken1Data.address,
    isCL: true,
    reserve0: 10000000n,
    reserve1: 6000000n,
    totalLiquidityUSD: 10000000n,
    token0Price: 1000000000000000000n,
    token1Price: 2000000000000000000n,
    gaugeIsAlive: false,
    token0IsWhitelisted: false,
    token1IsWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
    lastSnapshotTimestamp: new Date(1000000 * 1000),
  };

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

  describe("processCLPoolMint", () => {
    it("should process mint event successfully with valid data", () => {
      const result = processCLPoolMint(mockEvent, mockToken0, mockToken1);

      // Check liquidity pool diff with exact values
      expect(result.liquidityPoolDiff.reserve0).toBe(500000000000000000n); // amount0 (0.5 token)
      expect(result.liquidityPoolDiff.reserve1).toBe(300000000000000000n); // amount1 (0.3 token)

      // Calculate exact totalLiquidityUSD: (0.5 * 1 USD) + (0.3 * 2 USD) = 0.5 + 0.6 = 1.1 USD
      expect(result.liquidityPoolDiff.totalLiquidityUSD).toBe(
        1100000000000000000n,
      ); // 1.1 USD in 18 decimals

      // Check user liquidity diff with exact values
      expect(result.userLiquidityDiff.currentLiquidityUSD).toBe(
        1100000000000000000n,
      ); // 1.1 USD in 18 decimals (positive for addition)
      expect(result.userLiquidityDiff.currentLiquidityToken0).toBe(
        500000000000000000n,
      ); // amount0
      expect(result.userLiquidityDiff.currentLiquidityToken1).toBe(
        300000000000000000n,
      ); // amount1
    });

    it("should calculate correct liquidity values for mint event", () => {
      const result = processCLPoolMint(mockEvent, mockToken0, mockToken1);

      // For mint events, we expect positive liquidity change with exact values
      expect(result.userLiquidityDiff.currentLiquidityUSD).toBe(
        1100000000000000000n,
      ); // 1.1 USD in 18 decimals
      expect(result.userLiquidityDiff.currentLiquidityToken0).toBe(
        500000000000000000n,
      ); // amount0
      expect(result.userLiquidityDiff.currentLiquidityToken1).toBe(
        300000000000000000n,
      ); // amount1

      // The liquidity pool diff should reflect the amounts being added with exact values
      expect(result.liquidityPoolDiff.reserve0).toBe(500000000000000000n); // amount0
      expect(result.liquidityPoolDiff.reserve1).toBe(300000000000000000n); // amount1
      expect(result.liquidityPoolDiff.totalLiquidityUSD).toBe(
        1100000000000000000n,
      ); // 1.1 USD in 18 decimals
    });

    it("should handle different token decimals correctly", () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n, // USDC-like token
      };

      const result = processCLPoolMint(
        mockEvent,
        tokenWithDifferentDecimals,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).not.toBeUndefined();
      expect(result.userLiquidityDiff).not.toBeUndefined();
    });

    it("should handle zero amounts correctly", () => {
      const eventWithZeroAmounts: CLPool_Mint_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 0n,
          amount1: 0n,
        },
      };

      const result = processCLPoolMint(
        eventWithZeroAmounts,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff.reserve0).toBe(0n);
      expect(result.liquidityPoolDiff.reserve1).toBe(0n);
      expect(result.userLiquidityDiff.currentLiquidityUSD).toBe(0n);
    });
  });
});
