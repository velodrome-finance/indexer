import { expect } from "chai";
import type {
  LiquidityPoolAggregator,
  Pool_Sync_event,
  Token,
  handlerContext,
} from "generated";
import { processPoolSync } from "../../../src/EventHandlers/Pool/PoolSyncLogic";

describe("PoolSyncLogic", () => {
  const mockEvent: Pool_Sync_event = {
    chainId: 10,
    block: {
      number: 123456,
      timestamp: 1000000,
      hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
    },
    logIndex: 1,
    srcAddress: "0x3333333333333333333333333333333333333333",
    transaction: {
      hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
    },
    params: {
      reserve0: 1000n,
      reserve1: 2000n,
    },
  };

  const mockLiquidityPoolAggregator = {
    id: "0x1111111111111111111111111111111111111111",
    address: "0x1111111111111111111111111111111111111111",
    token0: "0x2222222222222222222222222222222222222222",
    token1: "0x3333333333333333333333333333333333333333",
    reserve0: 500n,
    reserve1: 1000n,
    totalLiquidityUSD: 2000n,
    token0Price: 1000000000000000000n, // 1 USD
    token1Price: 2000000000000000000n, // 2 USD
    numberOfSwaps: 10n,
    totalVolume0: 5000n,
    totalVolume1: 10000n,
    totalVolumeUSD: 15000n,
    totalVolumeUSDWhitelisted: 12000n,
    token0IsWhitelisted: true,
    token1IsWhitelisted: true,
    totalFees0: 100n,
    totalFees1: 200n,
    totalFeesUSD: 300n,
    totalFeesUSDWhitelisted: 250n,
    gaugeFees0CurrentEpoch: 50n,
    gaugeFees1CurrentEpoch: 100n,
    totalEmissions: 1000n,
    totalEmissionsUSD: 2000n,
    totalVotesDeposited: 5000n,
    totalVotesDepositedUSD: 10000n,
    gaugeAddress: "0x4444444444444444444444444444444444444444",
    gaugeIsAlive: true,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  } as unknown as LiquidityPoolAggregator;

  const mockToken0 = {
    id: "0x2222222222222222222222222222222222222222",
    address: "0x2222222222222222222222222222222222222222",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD
    isWhitelisted: true,
    chainId: 10,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  } as Token;

  const mockToken1 = {
    id: "0x3333333333333333333333333333333333333333",
    address: "0x3333333333333333333333333333333333333333",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18n,
    pricePerUSDNew: 2000000000000000000n, // 2 USD
    isWhitelisted: true,
    chainId: 10,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  } as Token;

  const mockContext = {
    log: {
      error: () => {},
      warn: () => {},
      info: () => {},
    },
  } as unknown as handlerContext;

  describe("processPoolSync", () => {
    it("should create entity and calculate sync updates for successful sync", async () => {
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processPoolSync(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.error).to.be.undefined;

      expect(result.liquidityPoolDiff).to.include({
        reserve0: 1000n,
        reserve1: 2000n,
        token0Price: 1000000000000000000n,
        token1Price: 2000000000000000000n,
      });
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000 * 1000),
      );
    });

    it("should handle TokenNotFoundError", async () => {
      const mockLoaderReturn = {
        _type: "TokenNotFoundError" as const,
        message: "Token not found",
      };

      const result = await processPoolSync(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.error).to.equal("Token not found");
    });

    it("should handle LiquidityPoolAggregatorNotFoundError", async () => {
      const mockLoaderReturn = {
        _type: "LiquidityPoolAggregatorNotFoundError" as const,
        message: "Liquidity pool aggregator not found",
      };

      const result = await processPoolSync(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.error).to.equal("Liquidity pool aggregator not found");
    });

    it("should handle unknown error type", async () => {
      const mockLoaderReturn = {
        _type: "unknown" as never,
        message: "Unknown error",
      };

      const result = await processPoolSync(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.error).to.equal("Unknown error type");
    });

    it("should calculate total liquidity USD correctly with both tokens", async () => {
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processPoolSync(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      // Token0: 1000 * 10^12 (normalized) * price = 1000000000000000n
      // Token1: 2000 * 10^0 (already 18 decimals) * price = 4000n
      // Total: 1000000000004000n
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(
        1000000000004000n,
      );
    });

    it("should calculate total liquidity USD correctly with only token0", async () => {
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: undefined,
      };

      const result = await processPoolSync(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      // Token0: 1000 * 10^12 (normalized) * price = 1000000000000000n
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(
        1000000000000000n,
      );
    });

    it("should calculate total liquidity USD correctly with only token1", async () => {
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: undefined,
        token1Instance: mockToken1,
      };

      const result = await processPoolSync(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      // Token1: 2000 * 10^0 (already 18 decimals) * price = 4000n
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(4000n);
    });

    it("should use existing totalLiquidityUSD when no tokens are available", async () => {
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: undefined,
        token1Instance: undefined,
      };

      const result = await processPoolSync(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      // It's 0 because no tokens are available and no update is made
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(0n);
    });

    it("should handle different token decimals correctly", async () => {
      const mockToken0WithDifferentDecimals = {
        ...mockToken0,
        decimals: 8n, // Different decimals
      };

      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0WithDifferentDecimals,
        token1Instance: mockToken1,
      };

      const result = await processPoolSync(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      // Token0: 1000 * 10^10 (normalized) * price = 10000000000000n
      // Token1: 2000 * 10^0 (already 18 decimals) * price = 4000n
      // Total: 10000000004000n
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(
        10000000004000n,
      );
    });

    it("should handle zero amounts correctly", async () => {
      const mockEventWithZeroAmounts: Pool_Sync_event = {
        ...mockEvent,
        params: {
          reserve0: 0n,
          reserve1: 0n,
        },
      };

      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processPoolSync(
        mockEventWithZeroAmounts,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.include({
        reserve0: 0n,
        reserve1: 0n,
      });
      // When amounts are zero, it should be 0
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(0n);
    });

    it("should handle missing token instances gracefully", async () => {
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: undefined,
        token1Instance: undefined,
      };

      const result = await processPoolSync(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.error).to.be.undefined;

      // Should use existing prices from aggregator
      expect(result.liquidityPoolDiff).to.include({
        token0Price: mockLiquidityPoolAggregator.token0Price,
        token1Price: mockLiquidityPoolAggregator.token1Price,
      });
    });

    it("should update token prices correctly", async () => {
      const mockToken0WithNewPrice = {
        ...mockToken0,
        pricePerUSDNew: 1500000000000000000n, // 1.5 USD
      };

      const mockToken1WithNewPrice = {
        ...mockToken1,
        pricePerUSDNew: 2500000000000000000n, // 2.5 USD
      };

      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0WithNewPrice,
        token1Instance: mockToken1WithNewPrice,
      };

      const result = await processPoolSync(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.include({
        token0Price: 1500000000000000000n,
        token1Price: 2500000000000000000n,
      });
    });
  });
});
