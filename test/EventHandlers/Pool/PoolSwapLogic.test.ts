import type {
  LiquidityPoolAggregator,
  Pool_Swap_event,
  Token,
} from "generated";
import { processPoolSwap } from "../../../src/EventHandlers/Pool/PoolSwapLogic";
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

  describe("processPoolSwap", () => {
    it("should create entity and calculate swap updates for successful swap", async () => {
      // Process the swap event
      const result = processPoolSwap(mockEvent, mockToken0, mockToken1);

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

      const result = processPoolSwap(modifiedEvent, mockToken0, mockToken1);

      // Token0 has amount0In + amount0Out = 2n + 100n = 102n
      // Token1 has amount1In + amount1Out = 2000n + 5n = 2005n
      // The logic uses token0 USD value if available and non-zero, otherwise token1
      // token0UsdValue = 102n * 10^18 / 10^18 * 1 USD = 102n
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(102n);
    });

    it("should not add to whitelisted volume when tokens are not whitelisted", async () => {
      const result = processPoolSwap(
        mockEvent,
        { ...mockToken0, isWhitelisted: false },
        { ...mockToken1, isWhitelisted: false },
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
      const result = processPoolSwap(
        mockEvent,
        { ...mockToken0, isWhitelisted: true },
        { ...mockToken1, isWhitelisted: true },
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
      const result = processPoolSwap(
        mockEvent,
        { ...mockToken0, isWhitelisted: true },
        { ...mockToken1, isWhitelisted: false },
      );

      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userSwapDiff).toBeDefined();

      // When only one token is whitelisted, whitelisted volume diff should be 0
      expect(
        result.liquidityPoolDiff?.incrementalTotalVolumeUSDWhitelisted,
      ).toBe(0n);
    });

    it("should update token prices correctly", () => {
      const updatedToken0 = {
        ...mockToken0,
        pricePerUSDNew: 2000000000000000000n,
      }; // 2 USD
      const updatedToken1 = {
        ...mockToken1,
        pricePerUSDNew: 3000000000000000000n,
      }; // 3 USD

      const result = processPoolSwap(mockEvent, updatedToken0, updatedToken1);

      expect(result.liquidityPoolDiff?.token0Price).toBe(2000000000000000000n);
      expect(result.liquidityPoolDiff?.token1Price).toBe(3000000000000000000n);
    });
  });

  describe("Volume calculations", () => {
    it("should calculate net amounts correctly from event params", () => {
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

      const result = processPoolSwap(swapEvent, mockToken0, mockToken1);

      // Net amounts should be sum of in and out
      expect(result.liquidityPoolDiff?.incrementalTotalVolume0).toBe(800n); // 500 + 300
      expect(result.liquidityPoolDiff?.incrementalTotalVolume1).toBe(600n); // 200 + 400
      expect(result.userSwapDiff?.incrementalTotalSwapVolumeAmount0).toBe(800n);
      expect(result.userSwapDiff?.incrementalTotalSwapVolumeAmount1).toBe(600n);
    });

    it("should use token0 USD value when available and non-zero", () => {
      const result = processPoolSwap(mockEvent, mockToken0, mockToken1);

      expect(result.liquidityPoolDiff?.incrementalTotalVolume0).toBe(1000n);
      expect(result.liquidityPoolDiff?.incrementalTotalVolume1).toBe(500n);
      // token0UsdValue = 1000 * 10^18 / 10^18 * 1 USD = 1000n
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(1000n);
    });

    it("should use token1 USD value when token0 is zero", () => {
      const eventWithZeroToken0: Pool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0In: 0n,
          amount0Out: 0n,
        },
      };

      const result = processPoolSwap(
        eventWithZeroToken0,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff?.incrementalTotalVolume0).toBe(0n);
      expect(result.liquidityPoolDiff?.incrementalTotalVolume1).toBe(500n);
      // token1UsdValue calculation:
      // - netAmount1 = 500n (raw amount in smallest unit for 6-decimal token)
      // - normalized = 500n * 10^18 / 10^6 = 500n * 10^12 = 500000000000000n
      // - USD value = 500000000000000n * 10^18 / 10^18 = 500000000000000n
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(
        500000000000000n,
      );
    });
  });
});
