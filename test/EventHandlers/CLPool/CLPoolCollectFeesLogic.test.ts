import { expect } from "chai";
import type {
  CLPool_CollectFees_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { processCLPoolCollectFees } from "../../../src/EventHandlers/CLPool/CLPoolCollectFeesLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolCollectFeesLogic", () => {
  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } =
    setupCommon();

  // Shared mock event for all tests
  const mockEvent: CLPool_CollectFees_event = {
    params: {
      recipient: "0x2222222222222222222222222222222222222222",
      amount0: 100n,
      amount1: 50n,
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

  describe("processCLPoolCollectFees", () => {
    it("should create entity and calculate liquidity and fee updates for successful collect fees", () => {
      // Process the collect fees event
      const result = processCLPoolCollectFees(
        mockEvent,
        mockSuccessLoaderReturn,
      );

      // Assertions
      expect(result.CLPoolCollectFeesEntity).to.deep.include({
        id: "10_123456_1",
        recipient: "0x2222222222222222222222222222222222222222",
        amount0: 100n,
        amount1: 50n,
        sourceAddress: "0x3333333333333333333333333333333333333333",
        blockNumber: 123456,
        logIndex: 1,
        chainId: 10,
        transactionHash:
          "0x4444444444444444444444444444444444444444444444444444444444444444",
      });

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolDiff?.reserve0).to.equal(
        199999999999999999900n,
      ); // 200e18 - 100
      expect(result.liquidityPoolDiff?.reserve1).to.equal(199999950n); // 200e6 - 50
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(
        399999949999999999900n,
      ); // Calculated from the new reserve values
      expect(result.liquidityPoolDiff?.totalFees0).to.equal(
        100000000000000000100n,
      ); // 100e18 + 100
      expect(result.liquidityPoolDiff?.totalFees1).to.equal(200000050n); // 200e6 + 50
      expect(result.liquidityPoolDiff?.totalFeesUSD).to.equal(
        300000050000000000100n,
      ); // 300e18 + fees from both tokens (100 + 50)
      expect(result.liquidityPoolDiff?.totalFeesUSDWhitelisted).to.equal(
        300000050000000000100n,
      ); // Same as totalFeesUSD since both tokens are whitelisted
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

      const result = processCLPoolCollectFees(mockEvent, mockLoaderReturn);

      expect(result.CLPoolCollectFeesEntity).to.exist;
      expect(result.error).to.equal("Token not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
    });

    it("should handle LiquidityPoolAggregatorNotFoundError", () => {
      const mockLoaderReturn = {
        _type: "LiquidityPoolAggregatorNotFoundError" as const,
        message: "Liquidity pool aggregator not found",
      };

      const result = processCLPoolCollectFees(mockEvent, mockLoaderReturn);

      expect(result.CLPoolCollectFeesEntity).to.exist;
      expect(result.error).to.equal("Liquidity pool aggregator not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
    });

    it("should handle unknown error type", () => {
      const mockLoaderReturn = {
        _type: "UnknownError" as never,
        message: "Some unknown error",
      };

      const result = processCLPoolCollectFees(mockEvent, mockLoaderReturn);

      expect(result.CLPoolCollectFeesEntity).to.exist;
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
        totalFees0: 500000n, // 0.5 USDC (6 decimals)
        totalFees1: 250000000000000000n, // 0.25 WETH (18 decimals)
        totalFeesUSD: 750000000000000000n, // 0.75 USD
        totalFeesUSDWhitelisted: 750000000000000000n,
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

      // Mock event with amounts that will be collected as fees
      const mockEventWithDecimals: CLPool_CollectFees_event = {
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

      // Process the collect fees event
      const result = processCLPoolCollectFees(
        mockEventWithDecimals,
        mockLoaderReturn,
      );

      // Assertions
      expect(result.CLPoolCollectFeesEntity).to.deep.include({
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

      // Fee calculations
      expect(result.liquidityPoolDiff?.totalFees0).to.equal(600000n); // 500000 + 100000
      expect(result.liquidityPoolDiff?.totalFees1).to.equal(
        750000000000000000n,
      ); // 250000000000000000 + 500000000000000000

      // Fee USD calculations
      // 100000 USDC (6 decimals) * 1 USD + 500000000000000000 WETH (18 decimals) * 2 USD
      // = 100000 * (1e18 / 1e6) * 1e18 + 500000000000000000 * (1e18 / 1e18) * 2e18
      // = 100000 * 1e12 * 1e18 + 500000000000000000 * 1 * 2e18
      // = 100000000000000000 + 1000000000000000000 = 1100000000000000000
      expect(result.liquidityPoolDiff?.totalFeesUSD).to.equal(
        1850000000000000000n, // 750000000000000000 + 1100000000000000000
      );
      expect(result.liquidityPoolDiff?.totalFeesUSDWhitelisted).to.equal(
        1850000000000000000n,
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
      const mockEventWithZeroAmounts: CLPool_CollectFees_event = {
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

      // Process the collect fees event
      const result = processCLPoolCollectFees(
        mockEventWithZeroAmounts,
        mockLoaderReturn,
      );

      // Assertions
      expect(result.CLPoolCollectFeesEntity).to.deep.include({
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
      expect(result.liquidityPoolDiff?.totalFees0).to.equal(
        100000000000000000000n,
      ); // 100e18 + 0
      expect(result.liquidityPoolDiff?.totalFees1).to.equal(200000000n); // 200e6 + 0
      expect(result.liquidityPoolDiff?.totalFeesUSD).to.equal(
        300000000000000000000n,
      ); // 300e18 + 0
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

      // Process the collect fees event
      const result = processCLPoolCollectFees(mockEvent, mockLoaderReturn);

      // Should still create the entity and calculate basic liquidity diff
      expect(result.CLPoolCollectFeesEntity).to.exist;
      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolDiff?.reserve0).to.equal(
        199999999999999999900n,
      ); // 200e18 - 100
      expect(result.liquidityPoolDiff?.reserve1).to.equal(199999950n); // 200e6 - 50
      expect(result.liquidityPoolDiff?.totalFees0).to.equal(
        100000000000000000100n,
      ); // 100e18 + 100
      expect(result.liquidityPoolDiff?.totalFees1).to.equal(200000050n); // 200e6 + 50
      expect(result.liquidityPoolDiff?.totalFeesUSD).to.equal(
        300000000000000000000n,
      ); // 300e18 (base amount, no additional USD calculation without token instances)
      expect(result.liquidityPoolDiff?.totalFeesUSDWhitelisted).to.equal(
        300000000000000000000n,
      ); // Same as totalFeesUSD
      expect(result.error).to.be.undefined;
    });

    it("should handle non-whitelisted tokens correctly", () => {
      const mockToken0NonWhitelisted: Token = {
        ...mockToken0Data,
        isWhitelisted: false,
      };

      const mockToken1NonWhitelisted: Token = {
        ...mockToken1Data,
        isWhitelisted: false,
      };

      // Mock loader return with non-whitelisted tokens
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolData,
        token0Instance: mockToken0NonWhitelisted,
        token1Instance: mockToken1NonWhitelisted,
      };

      // Process the collect fees event
      const result = processCLPoolCollectFees(mockEvent, mockLoaderReturn);

      // Assertions
      expect(result.CLPoolCollectFeesEntity).to.exist;
      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolDiff?.totalFeesUSD).to.equal(
        300000050000000000100n,
      ); // 300e18 + fees from both tokens
      expect(result.liquidityPoolDiff?.totalFeesUSDWhitelisted).to.equal(
        300000000000000000000n,
      ); // Only base amount, no additional fees since tokens are not whitelisted
      expect(result.error).to.be.undefined;
    });
  });
});
