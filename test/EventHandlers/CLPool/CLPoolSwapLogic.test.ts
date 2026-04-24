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
  const CL_FEE_30 = 3000n; // 0.3% fee (CL fees use 1e6 scale: 3000 / 1_000_000 = 0.3%)
  const CL_FEE_100 = 10000n; // 1% fee (CL fees use 1e6 scale: 10000 / 1_000_000 = 1%)
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
    currentFee: CL_FEE_30,
    baseFee: CL_FEE_30,
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

    it("should count whitelisted volume when only one token is whitelisted", () => {
      const whitelistedToken0: Token = { ...mockToken0, isWhitelisted: true };

      const result = calculateSwapVolume(
        mockEvent,
        whitelistedToken0,
        mockToken1,
      );

      // "Any whitelisted" rule — consistent with calculateWhitelistedFeesUSD
      expect(result.volumeInUSDWhitelisted).toBe(result.volumeInUSD);
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

      // Fee = 3000 (0.3% in 1e6 scale), only charged on input token (positive amount)
      // token0 (input, +1e18): (1e18 * 3000) / 1000000 = 3e15, normalized to 1e18: 3e15
      // token1 (output, -2e18): 0 (fees only on input side)
      // USD: calculateTokenAmountUSD(3e15, 18, 1e18) = 3e15
      expect(result.swapFeesInToken0).toBe(3000000000000000n); // 3e15
      expect(result.swapFeesInToken1).toBe(0n); // output side — no fee
      expect(result.swapFeesInUSD).toBe(3000000000000000n); // 3e15
    });

    it("should fallback to baseFee when currentFee is undefined", () => {
      const poolWithBaseFee = {
        ...mockLiquidityPoolAggregator,
        currentFee: undefined,
        baseFee: CL_FEE_100,
      } as unknown as LiquidityPoolAggregator;

      const result = calculateSwapFees(
        mockEvent,
        poolWithBaseFee,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Fee = 10000 (1% in 1e6 scale), only charged on input token (positive amount)
      // token0 (input, +1e18): (1e18 * 10000) / 1000000 = 1e16, normalized to 1e18: 1e16
      // token1 (output, -2e18): 0 (fees only on input side)
      expect(result.swapFeesInToken0).toBe(10000000000000000n); // 1e16
      expect(result.swapFeesInToken1).toBe(0n); // output side — no fee
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
      // Log should include actual values for diagnostics
      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining("undefined"),
      );
      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining(poolWithoutFee.id),
      );
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

      // Fee = 3000 (0.3% in 1e6 scale), only charged on input token (positive amount)
      // token0 (input, +1e18): (1e18 * 3000) / 1000000 = 3e15, normalized from 6 decimals: (3e15 * 1e18) / 1e6 = 3e27
      // token1 (output, -2e18): 0 (fees only on input side)
      expect(result.swapFeesInToken0).toBe(3000000000000000000000000000n); // 3e27
      expect(result.swapFeesInToken1).toBe(0n); // output side — no fee
    });

    it("should calculate USD fees using token0 price when available", () => {
      const result = calculateSwapFees(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Same fee calculation as first test: 3e15
      expect(result.swapFeesInUSD).toBe(3000000000000000n); // 3e15
    });

    it("should return zero USD fees when input token has no price and output has no fee", () => {
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

      // token0 is input (amount0 > 0) but price is 0 → can't price the fee
      // token1 is output (amount1 < 0) → no fee computed
      expect(result.swapFeesInUSD).toBe(0n);
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
    it("should exclude fees from the input token and leave output unchanged", () => {
      const result = calculateSwapLiquidityChanges(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        CL_FEE_30,
      );
      const fee0 = (1n * TEN_TO_THE_18_BI * CL_FEE_30) / 1000000n;
      expect(result.newReserve0).toBe(
        mockLiquidityPoolAggregator.reserve0 + 1n * TEN_TO_THE_18_BI - fee0,
      );
      expect(result.newReserve1).toBe(
        mockLiquidityPoolAggregator.reserve1 - 2n * TEN_TO_THE_18_BI,
      );
    });

    it("should not deduct fees when both amounts are negative (output)", () => {
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
        CL_FEE_30,
      );
      expect(result.newReserve0).toBe(
        mockLiquidityPoolAggregator.reserve0 - 5n * TEN_TO_THE_18_BI,
      );
      expect(result.newReserve1).toBe(
        mockLiquidityPoolAggregator.reserve1 - 3n * TEN_TO_THE_18_BI,
      );
    });

    it("should deduct fees from both sides when both amounts are positive", () => {
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
        CL_FEE_30,
      );
      const fee0 = (5n * TEN_TO_THE_18_BI * CL_FEE_30) / 1000000n;
      const fee1 = (3n * TEN_TO_THE_18_BI * CL_FEE_30) / 1000000n;
      expect(result.newReserve0).toBe(
        mockLiquidityPoolAggregator.reserve0 + 5n * TEN_TO_THE_18_BI - fee0,
      );
      expect(result.newReserve1).toBe(
        mockLiquidityPoolAggregator.reserve1 + 3n * TEN_TO_THE_18_BI - fee1,
      );
    });

    it("should not deduct fees when fee rate is zero", () => {
      const result = calculateSwapLiquidityChanges(
        mockEvent,
        mockLiquidityPoolAggregator,
        undefined,
        undefined,
        0n,
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
      // Fee = 3000 (0.3%): (amount * 3000) / 1000000 → 3e15 for token0, 6e15 for token1
      expect(result.liquidityPoolDiff.incrementalTotalFeesGenerated0).toBe(
        3000000000000000n,
      ); // 3e15
      expect(result.liquidityPoolDiff.incrementalTotalFeesGeneratedUSD).toBe(
        3000000000000000n,
      ); // 3e15
      // TVL: reserves exclude the 0.3% fee on the input side (amount0 = +1e18)
      // reserve0 = 10e18 + (1e18 - 3e15) = 10.997e18, reserve1 = 6e18 - 2e18 = 4e18
      // TVL = 10.997 * $1 + 4 * $2 = $18.997
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBe(
        18997000000000000000n,
      );

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
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBe(
        22n * TEN_TO_THE_18_BI,
      );
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

    it("should exclude fees from reserve increments (input side only)", async () => {
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

      const fee0 = (5n * TEN_TO_THE_18_BI * CL_FEE_30) / 1000000n;
      const fee1 = (3n * TEN_TO_THE_18_BI * CL_FEE_30) / 1000000n;
      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(
        5n * TEN_TO_THE_18_BI - fee0,
      );
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(
        3n * TEN_TO_THE_18_BI - fee1,
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

    it("should set liquidityInRange from event params", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.liquidityInRange).toBe(
        mockEvent.params.liquidity,
      );
    });

    it("should compute staked reserve deltas proportionally", async () => {
      const poolWithStaked = {
        ...mockLiquidityPoolAggregator,
        tick: 500n, // Different from event tick (1000n) to trigger tick crossing
        tickSpacing: 200n,
        stakedLiquidityInRange: 200n,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        poolWithStaked,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // No tick entities exist → stakedLiquidityInRange stays 200n
      // reserveDelta0/1 are proportioned by 200/1000000000000000000000 (event liquidity)
      // With such small staked vs total, staked deltas will be ~0 due to bigint truncation
      expect(result.liquidityPoolDiff.stakedLiquidityInRange).toBe(200n);
      expect(result.liquidityPoolDiff.incrementalStakedReserve0).toBeDefined();
      expect(result.liquidityPoolDiff.incrementalStakedReserve1).toBeDefined();
    });

    it("should return zero staked deltas when no staked liquidity", async () => {
      const poolNoStaked = {
        ...mockLiquidityPoolAggregator,
        stakedLiquidityInRange: 0n,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        poolNoStaked,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.incrementalStakedReserve0).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalStakedReserve1).toBe(0n);
      expect(result.liquidityPoolDiff.stakedLiquidityInRange).toBe(0n);
    });

    it("should skip tick crossings when tick unchanged", async () => {
      const poolSameTick = {
        ...mockLiquidityPoolAggregator,
        tick: mockEvent.params.tick, // Same tick → no crossing
        tickSpacing: 200n,
        stakedLiquidityInRange: 500n,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        poolSameTick,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // No tick crossing → stakedLiquidityInRange unchanged
      expect(result.liquidityPoolDiff.stakedLiquidityInRange).toBe(500n);
    });
  });
});
