import type {
  LiquidityPoolAggregator,
  Pool_Swap_event,
  Token,
  handlerContext,
} from "generated";
import { processPoolSwap } from "../../../src/EventHandlers/Pool/PoolSwapLogic";
import * as Helpers from "../../../src/Helpers";
import * as PriceOracle from "../../../src/PriceOracle";
import { setupCommon } from "./common";

describe("PoolSwapLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  // Shared mock event for all tests
  const mockEvent: Pool_Swap_event = {
    params: {
      sender: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      amount0In: 1000n,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: 500n,
    },
    srcAddress: "0x3333333333333333333333333333333333333333",
    transaction: {
      hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
    },
    block: {
      timestamp: 1000000,
      number: 123456,
      hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
    },
    chainId: 10,
    logIndex: 1,
  };

  // Mock context
  const mockLogError = jest.fn();
  const mockContext = {
    log: {
      error: mockLogError,
    },
  } as unknown as handlerContext;

  // Mock liquidity pool aggregator
  const mockLiquidityPoolAggregator: LiquidityPoolAggregator = {
    ...mockLiquidityPoolData,
    id: "0x3333333333333333333333333333333333333333",
    token0_id: mockToken0Data.id,
    token1_id: mockToken1Data.id,
    token0_address: mockToken0Data.address,
    token1_address: mockToken1Data.address,
    reserve0: 1000n,
    reserve1: 1000n,
    totalLiquidityUSD: 2000n,
    totalVolume0: 1n,
    totalVolume1: 1n,
    totalVolumeUSD: 1200n,
    totalVolumeUSDWhitelisted: 1200n,
    token0Price: 1000000000000000000n,
    token1Price: 5000000000000000000n,
    gaugeIsAlive: true,
    name: "Test Pool",
  };

  // Mock token instances
  const mockToken0: Token = {
    ...mockToken0Data,
    id: "token0_id",
    address: "0x1111111111111111111111111111111111111111",
    symbol: "USDT",
  };

  const mockToken1: Token = {
    ...mockToken1Data,
    id: "token1_id",
    address: "0x2222222222222222222222222222222222222222",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6n,
  };

  let refreshTokenPriceSpy: jest.SpyInstance;

  beforeEach(() => {
    refreshTokenPriceSpy = jest
      .spyOn(PriceOracle, "refreshTokenPrice")
      .mockImplementation(async (token) => token); // Return the token as-is
    mockLogError.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("processPoolSwap", () => {
    it("should create entity and calculate swap updates for successful swap", async () => {
      // Process the swap event
      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Assertions
      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userSwapDiff).toBeDefined();

      // Verify user swap diff content
      expect(result.userSwapDiff).toMatchObject({
        incrementalNumberOfSwaps: 1n,
        incrementalTotalSwapVolumeUSD: 1000n, // from swapData.volumeInUSD (token0: 1000 * 1 USD)
        incrementalTotalSwapVolumeAmount0: 1000n, // amount0In + amount0Out = 1000 + 0
        incrementalTotalSwapVolumeAmount1: 500n, // amount1In + amount1Out = 0 + 500
        lastActivityTimestamp: new Date(1000000 * 1000),
      });

      // Verify liquidity pool diff content
      expect(result.liquidityPoolDiff).toMatchObject({
        incrementalTotalVolume0: 1000n, // netAmount0 (diff) - amount0In + amount0Out = 1000 + 0
        incrementalTotalVolume1: 500n, // netAmount1 (diff) - amount1In + amount1Out = 0 + 500
        incrementalNumberOfSwaps: 1n, // diff
        token0Price: 1000000000000000000n, // from mockToken0.pricePerUSDNew
        token1Price: 1000000000000000000n, // from mockToken1.pricePerUSDNew
      });

      // Check timestamp separately
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );

      // Verify that refreshTokenPrice was called for both tokens
      expect(refreshTokenPriceSpy).toHaveBeenCalledTimes(2);
      expect(refreshTokenPriceSpy.mock.calls[0]).toEqual([
        mockToken0,
        123456,
        1000000,
        10,
        mockContext,
      ]);
      expect(refreshTokenPriceSpy.mock.calls[1]).toEqual([
        mockToken1,
        123456,
        1000000,
        10,
        mockContext,
      ]);
    });

    it("should handle refreshTokenPrice errors gracefully", async () => {
      // Mock refreshTokenPrice to throw an error for token0
      refreshTokenPriceSpy
        .mockRejectedValueOnce(new Error("Price refresh failed"))
        .mockImplementationOnce(async (token) => token);

      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Should still process and continue processing
      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userSwapDiff).toBeDefined();

      // Verify error was logged
      expect(mockLogError).toHaveBeenCalledTimes(1);
      expect(mockLogError.mock.calls[0][0]).toContain(
        "Error refreshing token price",
      );
    });

    it("should calculate volume correctly when token1 has higher volume", async () => {
      const modifiedEvent: Pool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0In: 2n,
          amount1In: 2000n,
          amount0Out: 100n,
          amount1Out: 5n,
        },
      };

      const result = await processPoolSwap(
        modifiedEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Token0 has amount0In + amount0Out = 2n + 100n = 102n
      // Token1 has amount1In + amount1Out = 2000n + 5n = 2005n
      // The logic uses the smaller volume for calculation (102n from token0)
      // Expected: 102n (token0 volume diff)
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(102n);
    });

    it("should not add to whitelisted volume when tokens are not whitelisted", async () => {
      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        { ...mockToken0, isWhitelisted: false },
        { ...mockToken1, isWhitelisted: false },
        mockContext,
      );

      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userSwapDiff).toBeDefined();

      // When tokens are not whitelisted, whitelisted volume diff should be 0
      expect(
        result.liquidityPoolDiff?.incrementalTotalVolumeUSDWhitelisted,
      ).toBe(0n);
      // But total volume should still be calculated: 1000n USD (1000 USDT * 1 USD, uses token0 value)
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(1000n);
    });

    it("should add to whitelisted volume when both tokens are whitelisted", async () => {
      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        { ...mockToken0, isWhitelisted: true },
        { ...mockToken1, isWhitelisted: true },
        mockContext,
      );

      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userSwapDiff).toBeDefined();

      // When both tokens are whitelisted, whitelisted volume should be added
      // Expected: 1000n USD (1000 USDT * 1 USD, uses token0 value)
      expect(
        result.liquidityPoolDiff?.incrementalTotalVolumeUSDWhitelisted,
      ).toBe(1000n);
    });

    it("should handle mixed whitelist status correctly", async () => {
      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        { ...mockToken0, isWhitelisted: true },
        { ...mockToken1, isWhitelisted: false },
        mockContext,
      );

      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userSwapDiff).toBeDefined();

      // When only one token is whitelisted, whitelisted volume diff should be 0
      expect(
        result.liquidityPoolDiff?.incrementalTotalVolumeUSDWhitelisted,
      ).toBe(0n);
    });

    it("should update token prices correctly", async () => {
      const updatedToken0 = {
        ...mockToken0,
        pricePerUSDNew: 2000000000000000000n,
      }; // 2 USD
      const updatedToken1 = {
        ...mockToken1,
        pricePerUSDNew: 3000000000000000000n,
      }; // 3 USD

      refreshTokenPriceSpy
        .mockResolvedValueOnce(updatedToken0)
        .mockResolvedValueOnce(updatedToken1);

      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.token0Price).toBe(2000000000000000000n);
      expect(result.liquidityPoolDiff?.token1Price).toBe(3000000000000000000n);
    });

    it("should correctly calculate incrementalTotalSwapVolumeAmount0 and incrementalTotalSwapVolumeAmount1", async () => {
      const swapEvent: Pool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0In: 500n,
          amount0Out: 300n,
          amount1In: 200n,
          amount1Out: 400n,
        },
      };

      const result = await processPoolSwap(
        swapEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // incrementalTotalSwapVolumeAmount0 should be amount0In + amount0Out = 500 + 300 = 800
      expect(result.userSwapDiff?.incrementalTotalSwapVolumeAmount0).toBe(800n);
      // incrementalTotalSwapVolumeAmount1 should be amount1In + amount1Out = 200 + 400 = 600
      expect(result.userSwapDiff?.incrementalTotalSwapVolumeAmount1).toBe(600n);
    });
  });

  describe("Fallback branches (nullish coalescing)", () => {
    let updateSwapTokenDataSpy: jest.SpyInstance;

    beforeEach(() => {
      updateSwapTokenDataSpy = jest.spyOn(Helpers, "updateSwapTokenData");
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const createMockSwapData = (
      overrides: Partial<
        Awaited<ReturnType<typeof Helpers.updateSwapTokenData>>
      > = {},
    ) => ({
      token0: mockToken0,
      token1: mockToken1,
      token0NetAmount: 1000n,
      token1NetAmount: 500n,
      volumeInUSD: 1000n,
      volumeInUSDWhitelisted: 1000n,
      ...overrides,
    });

    it("should use fallback when token0NetAmount is undefined", async () => {
      updateSwapTokenDataSpy.mockResolvedValue(
        createMockSwapData({ token0NetAmount: undefined }),
      );

      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.incrementalTotalVolume0).toBe(0n);
      expect(result.liquidityPoolDiff?.incrementalTotalVolume1).toBe(500n);
    });

    it("should use fallback when token1NetAmount is undefined", async () => {
      updateSwapTokenDataSpy.mockResolvedValue(
        createMockSwapData({ token1NetAmount: undefined }),
      );

      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.incrementalTotalVolume0).toBe(1000n);
      expect(result.liquidityPoolDiff?.incrementalTotalVolume1).toBe(0n);
    });

    it("should use fallback when token0 is undefined", async () => {
      updateSwapTokenDataSpy.mockResolvedValue(
        createMockSwapData({ token0: undefined }),
      );

      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.token0Price).toBe(
        mockLiquidityPoolAggregator.token0Price,
      );
      expect(result.liquidityPoolDiff?.token1Price).toBe(
        mockToken1.pricePerUSDNew,
      );
    });

    it("should use fallback when token1 is undefined", async () => {
      updateSwapTokenDataSpy.mockResolvedValue(
        createMockSwapData({ token1: undefined }),
      );

      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.token0Price).toBe(
        mockToken0.pricePerUSDNew,
      );
      expect(result.liquidityPoolDiff?.token1Price).toBe(
        mockLiquidityPoolAggregator.token1Price,
      );
    });

    it("should use fallback when token0.pricePerUSDNew is undefined", async () => {
      const token0WithoutPrice = {
        ...mockToken0,
        pricePerUSDNew: undefined,
      } as unknown as Token;

      updateSwapTokenDataSpy.mockResolvedValue(
        createMockSwapData({ token0: token0WithoutPrice }),
      );

      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.token0Price).toBe(
        mockLiquidityPoolAggregator.token0Price,
      );
    });

    it("should use fallback when token1.pricePerUSDNew is undefined", async () => {
      const token1WithoutPrice = {
        ...mockToken1,
        pricePerUSDNew: undefined,
      } as unknown as Token;

      updateSwapTokenDataSpy.mockResolvedValue(
        createMockSwapData({ token1: token1WithoutPrice }),
      );

      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.token1Price).toBe(
        mockLiquidityPoolAggregator.token1Price,
      );
    });

    it("should use fallback values when both tokens are undefined", async () => {
      updateSwapTokenDataSpy.mockResolvedValue(
        createMockSwapData({
          token0: undefined,
          token1: undefined,
          token0NetAmount: undefined,
          token1NetAmount: undefined,
          volumeInUSD: 0n,
          volumeInUSDWhitelisted: 0n,
        }),
      );

      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.token0Price).toBe(
        mockLiquidityPoolAggregator.token0Price,
      );
      expect(result.liquidityPoolDiff?.token1Price).toBe(
        mockLiquidityPoolAggregator.token1Price,
      );
      expect(result.liquidityPoolDiff?.incrementalTotalVolume0).toBe(0n);
      expect(result.liquidityPoolDiff?.incrementalTotalVolume1).toBe(0n);
    });
  });
});
