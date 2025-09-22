import { expect } from "chai";
import type {
  CLPool_Collect_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { processCLPoolCollect } from "../../../src/EventHandlers/CLPool/CLPoolCollectLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolCollectLogic", () => {
  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } =
    setupCommon();

  // Shared mock event for all tests
  const mockEvent: CLPool_Collect_event = {
    params: {
      owner: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
      tickLower: 100000n,
      tickUpper: 200000n,
      amount0: 750n,
      amount1: 500n,
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

  // Shared mock loader return for success case
  const mockSuccessLoaderReturn = {
    _type: "success" as const,
    liquidityPoolAggregator: mockLiquidityPoolData,
    token0Instance: mockToken0Data,
    token1Instance: mockToken1Data,
  };

  describe("processCLPoolCollect", () => {
    it("should create entity and calculate liquidity updates for successful collect", () => {
      // Process the collect event
      const result = processCLPoolCollect(mockEvent, mockSuccessLoaderReturn);

      // Assertions
      expect(result.CLPoolCollectEntity).to.deep.include({
        id: "10_123456_1",
        owner: "0x1111111111111111111111111111111111111111",
        recipient: "0x2222222222222222222222222222222222222222",
        tickLower: 100000n,
        tickUpper: 200000n,
        amount0: 750n,
        amount1: 500n,
        sourceAddress: "0x3333333333333333333333333333333333333333",
        blockNumber: 123456,
        logIndex: 1,
        chainId: 10,
        transactionHash:
          "0x4444444444444444444444444444444444444444444444444444444444444444",
      });

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolDiff?.reserve0).to.equal(
        199999999999999999250n,
      ); // 200e18 - 750
      expect(result.liquidityPoolDiff?.reserve1).to.equal(199999500n); // 200e6 - 500
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(
        399999499999999999250n,
      ); // Calculated from the new reserve values
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000 * 1000),
      );
      expect(result.error).to.be.undefined;
    });

    it("should handle TokenNotFoundError", () => {
      const mockLoaderReturn = {
        _type: "TokenNotFoundError" as const,
        message: "Token not found",
      };

      const result = processCLPoolCollect(mockEvent, mockLoaderReturn);

      expect(result.CLPoolCollectEntity).to.exist;
      expect(result.error).to.equal("Token not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
    });

    it("should handle LiquidityPoolAggregatorNotFoundError", () => {
      const mockLoaderReturn = {
        _type: "LiquidityPoolAggregatorNotFoundError" as const,
        message: "Liquidity pool aggregator not found",
      };

      const result = processCLPoolCollect(mockEvent, mockLoaderReturn);

      expect(result.CLPoolCollectEntity).to.exist;
      expect(result.error).to.equal("Liquidity pool aggregator not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
    });

    it("should handle unknown error type", () => {
      const mockLoaderReturn = {
        _type: "UnknownError" as never,
        message: "Some unknown error",
      };

      const result = processCLPoolCollect(mockEvent, mockLoaderReturn);

      expect(result.CLPoolCollectEntity).to.exist;
      expect(result.error).to.equal("Unknown error type");
      expect(result.liquidityPoolDiff).to.be.undefined;
    });

    it("should handle different token decimals correctly", () => {
      const mockLiquidityPoolAggregatorWithDecimals: LiquidityPoolAggregator = {
        ...mockLiquidityPoolData,
        reserve0: 1000000n, // 1M with 6 decimals
        reserve1: 1000000000000000000n, // 1 with 18 decimals
        totalLiquidityUSD: 2000000000000000000n, // 2 USD
        token1Price: 2000000000000000000n, // 2 USD in 1e18
      };

      const mockToken0WithDecimals: Token = {
        ...mockToken0Data,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6n, // 6 decimals
      };

      const mockToken1WithDecimals: Token = {
        ...mockToken1Data,
        symbol: "WETH",
        name: "Wrapped Ether",
        decimals: 18n, // 18 decimals
        pricePerUSDNew: 2000000000000000000n, // 2 USD
      };

      // Mock event with amounts that will be collected
      const mockEventWithDecimals: CLPool_Collect_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 100000n, // 0.1 USDC (6 decimals)
          amount1: 500000000000000000n, // 0.5 WETH (18 decimals)
        },
      };

      // Mock loader return
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregatorWithDecimals,
        token0Instance: mockToken0WithDecimals,
        token1Instance: mockToken1WithDecimals,
      };

      // Process the collect event
      const result = processCLPoolCollect(
        mockEventWithDecimals,
        mockLoaderReturn,
      );

      // Assertions
      expect(result.CLPoolCollectEntity).to.deep.include({
        amount0: 100000n,
        amount1: 500000000000000000n,
      });

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolDiff?.reserve0).to.equal(900000n); // 1000000 - 100000
      expect(result.liquidityPoolDiff?.reserve1).to.equal(500000000000000000n); // 1000000000000000000 - 500000000000000000

      // The totalLiquidityUSD calculation should account for different decimals
      // 900000 USDC (6 decimals) * 1 USD + 500000000000000000 WETH (18 decimals) * 2 USD
      // = 900000 * (1e18 / 1e6) * 1e18 + 500000000000000000 * (1e18 / 1e18) * 2e18
      // = 900000 * 1e12 * 1e18 + 500000000000000000 * 1 * 2e18
      // = 900000000000000000 + 1000000000000000000 = 1900000000000000000
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(
        1900000000000000000n,
      );
      expect(result.error).to.be.undefined;
    });

    it("should handle zero amounts correctly", () => {
      const mockLiquidityPoolAggregatorWithZero: LiquidityPoolAggregator = {
        ...mockLiquidityPoolData,
        token1Price: 1000000000000000000n, // 1 USD to match token1
      };

      const mockToken1With18Decimals: Token = {
        ...mockToken1Data,
        decimals: 18n, // 18 decimals to match token0
        pricePerUSDNew: 1000000000000000000n, // 1 USD to match token0
      };

      // Mock event with zero amounts
      const mockEventWithZeroAmounts: CLPool_Collect_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 0n,
          amount1: 0n,
        },
      };

      // Mock loader return
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregatorWithZero,
        token0Instance: mockToken0Data,
        token1Instance: mockToken1With18Decimals,
      };

      // Process the collect event
      const result = processCLPoolCollect(
        mockEventWithZeroAmounts,
        mockLoaderReturn,
      );

      // Assertions
      expect(result.CLPoolCollectEntity).to.deep.include({
        amount0: 0n,
        amount1: 0n,
      });

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolDiff?.reserve0).to.equal(
        200000000000000000000n,
      ); // 200e18 - 0
      expect(result.liquidityPoolDiff?.reserve1).to.equal(200000000n); // 200e6 - 0
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(
        200000000000200000000n,
      ); // Should remain the same
      expect(result.error).to.be.undefined;
    });

    it("should handle missing token instances gracefully", () => {
      // Mock loader return with undefined token instances
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolData,
        token0Instance: undefined as Token | undefined,
        token1Instance: undefined as Token | undefined,
      };

      // Process the collect event
      const result = processCLPoolCollect(mockEvent, mockLoaderReturn);

      // Should still create the entity and calculate basic liquidity diff
      expect(result.CLPoolCollectEntity).to.exist;
      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolDiff?.reserve0).to.equal(
        199999999999999999250n,
      ); // 200e18 - 750
      expect(result.liquidityPoolDiff?.reserve1).to.equal(199999500n); // 200e6 - 500
      expect(result.error).to.be.undefined;
    });
  });
});
