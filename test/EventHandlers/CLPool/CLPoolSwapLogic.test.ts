import type {
  CLPool_Swap_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { TEN_TO_THE_18_BI, toChecksumAddress } from "../../../src/Constants";
import {
  calculateSwapFees,
  calculateSwapLiquidityChanges,
  calculateSwapVolume,
  processCLPoolSwap,
} from "../../../src/EventHandlers/CLPool/CLPoolSwapLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolSwapLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();

  // Constants for reusable test values
  const ONE_USD = 1n * TEN_TO_THE_18_BI;
  const TWO_USD = 2n * TEN_TO_THE_18_BI;
  const FEE_30_BPS = 30n; // 0.3% fee
  const FEE_100_BPS = 100n; // 1% fee
  const CHAIN_ID = 10;
  const BLOCK_TIMESTAMP = 1000000;
  const POOL_ID = toChecksumAddress(
    "0x1234567890123456789012345678901234567890",
  );

  const mockEvent: CLPool_Swap_event = {
    params: {
      sender: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      recipient: toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      ),
      amount0: 1n * TEN_TO_THE_18_BI,
      amount1: -2n * TEN_TO_THE_18_BI,
      sqrtPriceX96: 2000000000000000000000000000000n,
      liquidity: 1000000000000000000000n,
      tick: 1000n,
    },
    block: {
      timestamp: BLOCK_TIMESTAMP,
      number: 123456,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    },
    chainId: CHAIN_ID,
    logIndex: 1,
    srcAddress: toChecksumAddress("0x3333333333333333333333333333333333333333"),
    transaction: {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    },
  } as CLPool_Swap_event;

  const mockLiquidityPoolAggregator: LiquidityPoolAggregator = {
    ...mockLiquidityPoolData,
    id: POOL_ID,
    token0_id: mockToken0Data.id,
    token1_id: mockToken1Data.id,
    token0_address: mockToken0Data.address,
    token1_address: mockToken1Data.address,
    reserve0: 10n * TEN_TO_THE_18_BI,
    reserve1: 6n * TEN_TO_THE_18_BI,
    totalLiquidityUSD: 10n * TEN_TO_THE_18_BI,
    token0Price: ONE_USD,
    token1Price: TWO_USD,
    currentFee: FEE_30_BPS,
    baseFee: FEE_30_BPS,
    lastUpdatedTimestamp: new Date(BLOCK_TIMESTAMP * 1000),
  };

  const mockToken0: Token = {
    ...mockToken0Data,
    id: "token0_id",
    address: toChecksumAddress(
      "0x0000000000000000000000000000000000000001",
    ) as `0x${string}`,
    symbol: "TOKEN0",
    name: "Token 0",
    decimals: 18n,
    pricePerUSDNew: ONE_USD,
    isWhitelisted: false,
    lastUpdatedTimestamp: new Date(BLOCK_TIMESTAMP * 1000),
  };

  const mockToken1: Token = {
    ...mockToken1Data,
    id: "token1_id",
    address: toChecksumAddress(
      "0x0000000000000000000000000000000000000002",
    ) as `0x${string}`,
    symbol: "TOKEN1",
    name: "Token 1",
    decimals: 18n,
    pricePerUSDNew: TWO_USD,
    isWhitelisted: false,
    lastUpdatedTimestamp: new Date(BLOCK_TIMESTAMP * 1000),
  };

  const mockContext: handlerContext = {
    log: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    },
  } as unknown as handlerContext;

  describe("calculateSwapVolume", () => {
    it("should calculate volume using token0 when available and non-zero", () => {
      const result = calculateSwapVolume(mockEvent, mockToken0, mockToken1);

      expect(result.volumeInUSD).toBe(ONE_USD); // 1 token * $1 = $1
      expect(result.volumeInUSDWhitelisted).toBe(0n); // Neither token is whitelisted
    });

    it("should calculate volume using token1 when token0 value is zero", () => {
      const eventWithZeroToken0: CLPool_Swap_event = {
        ...mockEvent,
        params: { ...mockEvent.params, amount0: 0n },
      };

      const result = calculateSwapVolume(
        eventWithZeroToken0,
        mockToken0,
        mockToken1,
      );

      // token1: 2 tokens * $2 = $4
      expect(result.volumeInUSD).toBe(4n * TEN_TO_THE_18_BI);
    });

    it("should return zero volume when both tokens are undefined", () => {
      const result = calculateSwapVolume(mockEvent, undefined, undefined);

      expect(result.volumeInUSD).toBe(0n);
      expect(result.volumeInUSDWhitelisted).toBe(0n);
    });

    it("should calculate whitelisted volume when both tokens are whitelisted", () => {
      const whitelistedToken0: Token = { ...mockToken0, isWhitelisted: true };
      const whitelistedToken1: Token = { ...mockToken1, isWhitelisted: true };

      const result = calculateSwapVolume(
        mockEvent,
        whitelistedToken0,
        whitelistedToken1,
      );

      expect(result.volumeInUSDWhitelisted).toBe(result.volumeInUSD);
    });

    it("should return zero whitelisted volume when only one token is whitelisted", () => {
      const whitelistedToken0: Token = { ...mockToken0, isWhitelisted: true };

      const result = calculateSwapVolume(
        mockEvent,
        whitelistedToken0,
        mockToken1,
      );

      expect(result.volumeInUSDWhitelisted).toBe(0n);
    });

    it("should handle different token decimals correctly", () => {
      const tokenWith6Decimals: Token = {
        ...mockToken0,
        decimals: 6n,
        pricePerUSDNew: ONE_USD,
      };
      const eventWith6Decimals: CLPool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 1000000n, // 1 token in 6 decimals
        },
      };

      const result = calculateSwapVolume(
        eventWith6Decimals,
        tokenWith6Decimals,
        mockToken1,
      );

      expect(result.volumeInUSD).toBe(ONE_USD);
    });
  });

  describe("calculateSwapFees", () => {
    it("should calculate fees correctly with currentFee", () => {
      const result = calculateSwapFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Fee = 30 bps = 0.3%
      // token0: (1e18 * 30) / 10000 = 3e15, normalized to 1e18: (3e15 * 1e18) / 1e18 = 3e15
      // token1: (2e18 * 30) / 10000 = 6e15, normalized to 1e18: (6e15 * 1e18) / 1e18 = 6e15
      // USD: calculateTokenAmountUSD(3e15, 18, 1e18) = multiplyBase1e18(3e15, 1e18) = 3e15
      expect(result.swapFeesInToken0).toBe(3000000000000000n); // 3e15
      expect(result.swapFeesInToken1).toBe(6000000000000000n); // 6e15
      expect(result.swapFeesInUSD).toBe(3000000000000000n); // 3e15
    });

    it("should fallback to baseFee when currentFee is undefined", () => {
      const poolWithBaseFee = {
        ...mockLiquidityPoolAggregator,
        currentFee: undefined,
        baseFee: FEE_100_BPS,
      } as unknown as LiquidityPoolAggregator;

      const result = calculateSwapFees(
        mockEvent,
        poolWithBaseFee,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Fee = 100 bps = 1%
      // token0: (1e18 * 100) / 10000 = 1e16, normalized to 1e18: 1e16
      // token1: (2e18 * 100) / 10000 = 2e16, normalized to 1e18: 2e16
      expect(result.swapFeesInToken0).toBe(10000000000000000n); // 1e16
      expect(result.swapFeesInToken1).toBe(20000000000000000n); // 2e16
    });

    it("should return zero fees when both currentFee and baseFee are undefined", () => {
      const poolWithoutFee = {
        ...mockLiquidityPoolAggregator,
        currentFee: undefined,
        baseFee: undefined,
      } as unknown as LiquidityPoolAggregator;

      const result = calculateSwapFees(
        mockEvent,
        poolWithoutFee,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.swapFeesInToken0).toBe(0n);
      expect(result.swapFeesInToken1).toBe(0n);
      expect(result.swapFeesInUSD).toBe(0n);
      expect(mockContext.log.error).toHaveBeenCalled();
    });

    it("should handle different token decimals correctly", () => {
      const tokenWith6Decimals: Token = {
        ...mockToken0,
        decimals: 6n,
      };

      const result = calculateSwapFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        tokenWith6Decimals,
        mockToken1,
        mockContext,
      );

      // Fee = 30 bps
      // token0: (1e18 * 30) / 10000 = 3e15, normalized to 1e18: (3e15 * 1e18) / 1e6 = 3e27
      // token1: (2e18 * 30) / 10000 = 6e15, normalized to 1e18: (6e15 * 1e18) / 1e18 = 6e15
      expect(result.swapFeesInToken0).toBe(3000000000000000000000000000n); // 3e27
      expect(result.swapFeesInToken1).toBe(6000000000000000n); // 6e15
    });

    it("should calculate USD fees using token0 price when available", () => {
      const result = calculateSwapFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Same calculation as first test: 3e15
      expect(result.swapFeesInUSD).toBe(3000000000000000n); // 3e15
    });

    it("should calculate USD fees using token1 price when token0 price is zero", () => {
      const token0WithZeroPrice: Token = {
        ...mockToken0,
        pricePerUSDNew: 0n,
      };

      const result = calculateSwapFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        token0WithZeroPrice,
        mockToken1,
        mockContext,
      );

      // Uses token1: calculateTokenAmountUSD(6e15, 18, 2e18) = multiplyBase1e18(6e15, 2e18) = 12e15
      expect(result.swapFeesInUSD).toBe(12000000000000000n); // 12e15
    });

    it("should return zero USD fees when both token prices are unavailable", () => {
      const token0WithZeroPrice: Token = {
        ...mockToken0,
        pricePerUSDNew: 0n,
      };
      const token1WithoutPrice = {
        ...mockToken1,
        pricePerUSDNew: undefined,
      } as unknown as Token;

      const result = calculateSwapFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        token0WithZeroPrice,
        token1WithoutPrice,
        mockContext,
      );

      expect(result.swapFeesInUSD).toBe(0n);
    });
  });

  describe("calculateSwapLiquidityChanges", () => {
    it("should calculate new reserves correctly with positive amounts", () => {
      const eventWithPositiveAmounts: CLPool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 5n * TEN_TO_THE_18_BI,
          amount1: 3n * TEN_TO_THE_18_BI,
        },
      };

      const result = calculateSwapLiquidityChanges(
        eventWithPositiveAmounts,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      expect(result.newReserve0).toBe(
        mockLiquidityPoolAggregator.reserve0 + 5n * TEN_TO_THE_18_BI,
      );
      expect(result.newReserve1).toBe(
        mockLiquidityPoolAggregator.reserve1 + 3n * TEN_TO_THE_18_BI,
      );
    });

    it("should calculate new reserves correctly with negative amounts", () => {
      const eventWithNegativeAmounts: CLPool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: -5n * TEN_TO_THE_18_BI,
          amount1: -3n * TEN_TO_THE_18_BI,
        },
      };

      const result = calculateSwapLiquidityChanges(
        eventWithNegativeAmounts,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
      );

      expect(result.newReserve0).toBe(
        mockLiquidityPoolAggregator.reserve0 - 5n * TEN_TO_THE_18_BI,
      );
      expect(result.newReserve1).toBe(
        mockLiquidityPoolAggregator.reserve1 - 3n * TEN_TO_THE_18_BI,
      );
    });

    it("should calculate liquidity delta correctly when liquidity increases", () => {
      const poolWithLowLiquidity: LiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        reserve0: 1n * TEN_TO_THE_18_BI,
        reserve1: 2n * TEN_TO_THE_18_BI,
        totalLiquidityUSD: 5n * TEN_TO_THE_18_BI,
      };

      const eventAddingLiquidity: CLPool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 1n * TEN_TO_THE_18_BI,
          amount1: 2n * TEN_TO_THE_18_BI,
        },
      };

      const result = calculateSwapLiquidityChanges(
        eventAddingLiquidity,
        poolWithLowLiquidity,
        mockToken0,
        mockToken1,
      );

      // New reserves: 1 + 1 = 2 tokens0, 2 + 2 = 4 tokens1
      // New liquidity: 2 * $1 + 4 * $2 = $2 + $8 = $10
      // Delta: $10 - $5 = $5
      expect(result.deltaTotalLiquidityUSD).toBe(5n * TEN_TO_THE_18_BI);
    });

    it("should calculate liquidity delta correctly when liquidity decreases", () => {
      const poolWithHighLiquidity: LiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        reserve0: 10n * TEN_TO_THE_18_BI,
        reserve1: 20n * TEN_TO_THE_18_BI,
        totalLiquidityUSD: 50n * TEN_TO_THE_18_BI,
      };

      const eventRemovingLiquidity: CLPool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: -5n * TEN_TO_THE_18_BI,
          amount1: -10n * TEN_TO_THE_18_BI,
        },
      };

      const result = calculateSwapLiquidityChanges(
        eventRemovingLiquidity,
        poolWithHighLiquidity,
        mockToken0,
        mockToken1,
      );

      // New reserves: 10 - 5 = 5 tokens0, 20 - 10 = 10 tokens1
      // New liquidity: 5 * $1 + 10 * $2 = $5 + $20 = $25
      // Delta: $25 - $50 = -$25
      expect(result.deltaTotalLiquidityUSD).toBe(-25n * TEN_TO_THE_18_BI);
    });

    it("should handle undefined tokens correctly", () => {
      const result = calculateSwapLiquidityChanges(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        undefined,
      );

      expect(result.newReserve0).toBe(
        mockLiquidityPoolAggregator.reserve0 + mockEvent.params.amount0,
      );
      expect(result.newReserve1).toBe(
        mockLiquidityPoolAggregator.reserve1 + mockEvent.params.amount1,
      );
    });
  });

  describe("processCLPoolSwap", () => {
    it("should process swap event and calculate correct volumes and fees", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.incrementalTotalVolume0).toBe(
        1n * TEN_TO_THE_18_BI,
      );
      expect(result.liquidityPoolDiff.incrementalTotalVolume1).toBe(
        2n * TEN_TO_THE_18_BI,
      );
      expect(result.liquidityPoolDiff.incrementalNumberOfSwaps).toBe(1n);
      expect(result.liquidityPoolDiff.incrementalTotalVolumeUSD).toBe(ONE_USD);
      // Same fee calculation as first test: 3e15 for both
      expect(result.liquidityPoolDiff.incrementalTotalFeesGenerated0).toBe(
        3000000000000000n,
      ); // 3e15
      expect(result.liquidityPoolDiff.incrementalTotalFeesGeneratedUSD).toBe(
        3000000000000000n,
      ); // 3e15

      expect(result.userSwapDiff.incrementalNumberOfSwaps).toBe(1n);
      expect(result.userSwapDiff.incrementalTotalSwapVolumeAmount0).toBe(
        1n * TEN_TO_THE_18_BI,
      );
      expect(result.userSwapDiff.incrementalTotalSwapVolumeAmount1).toBe(
        2n * TEN_TO_THE_18_BI,
      );
      expect(result.userSwapDiff.incrementalTotalSwapVolumeUSD).toBe(ONE_USD);
    });

    it("should handle zero amounts correctly", async () => {
      const eventWithZeroAmounts: CLPool_Swap_event = {
        ...mockEvent,
        params: { ...mockEvent.params, amount0: 0n, amount1: 0n },
      };

      const result = await processCLPoolSwap(
        eventWithZeroAmounts,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.incrementalTotalVolume0).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalTotalVolume1).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalTotalVolumeUSD).toBe(0n);
    });

    it("should handle undefined tokens with fallback to pool prices", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        undefined,
        mockContext,
      );

      expect(result.liquidityPoolDiff.token0Price).toBe(
        mockLiquidityPoolAggregator.token0Price,
      );
      expect(result.liquidityPoolDiff.token1Price).toBe(
        mockLiquidityPoolAggregator.token1Price,
      );
    });

    it("should calculate reserves correctly with signed amounts", async () => {
      const eventWithPositiveAmounts: CLPool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 5n * TEN_TO_THE_18_BI,
          amount1: 3n * TEN_TO_THE_18_BI,
        },
      };

      const result = await processCLPoolSwap(
        eventWithPositiveAmounts,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(
        5n * TEN_TO_THE_18_BI,
      );
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(
        3n * TEN_TO_THE_18_BI,
      );
    });

    it("should calculate whitelisted volume correctly", async () => {
      const whitelistedToken0: Token = { ...mockToken0, isWhitelisted: true };
      const whitelistedToken1: Token = { ...mockToken1, isWhitelisted: true };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        whitelistedToken0,
        whitelistedToken1,
        mockContext,
      );

      expect(
        result.liquidityPoolDiff.incrementalTotalVolumeUSDWhitelisted,
      ).toBe(result.liquidityPoolDiff.incrementalTotalVolumeUSD);
    });

    it("should use updated token prices when available", async () => {
      const token0WithNewPrice: Token = {
        ...mockToken0,
        pricePerUSDNew: 1500000000000000000n,
      };
      const token1WithNewPrice: Token = {
        ...mockToken1,
        pricePerUSDNew: 2500000000000000000n,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        token0WithNewPrice,
        token1WithNewPrice,
        mockContext,
      );

      expect(result.liquidityPoolDiff.token0Price).toBe(1500000000000000000n);
      expect(result.liquidityPoolDiff.token1Price).toBe(2500000000000000000n);
    });

    it("should set correct timestamps", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.lastUpdatedTimestamp).toEqual(
        new Date(BLOCK_TIMESTAMP * 1000),
      );
      expect(result.userSwapDiff.lastActivityTimestamp).toEqual(
        new Date(BLOCK_TIMESTAMP * 1000),
      );
    });
  });
});
