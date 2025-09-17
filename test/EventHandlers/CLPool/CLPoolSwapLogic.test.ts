import { expect } from "chai";
import type {
  CLPool_Swap_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import sinon from "sinon";
import { processCLPoolSwap } from "../../../src/EventHandlers/CLPool/CLPoolSwapLogic";
import * as PriceOracle from "../../../src/PriceOracle";

describe("CLPoolSwapLogic", () => {
  // Shared mock event for all tests
  const mockEvent: CLPool_Swap_event = {
    params: {
      sender: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
      amount0: 1000n,
      amount1: -500n,
      sqrtPriceX96: 79228162514264337593543950336n, // 1 << 96
      liquidity: 10000n,
      tick: 0n,
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
  const mockLogError = sinon.stub();
  const mockContext = {
    log: {
      error: mockLogError,
    },
  } as unknown as handlerContext;

  // Mock liquidity pool aggregator
  const mockLiquidityPoolAggregator: LiquidityPoolAggregator = {
    id: "0x3333333333333333333333333333333333333333",
    chainId: 10,
    token0_id: "token0_id",
    token1_id: "token1_id",
    token0_address: "0x1111111111111111111111111111111111111111",
    token1_address: "0x2222222222222222222222222222222222222222",
    isStable: false,
    reserve0: 1000n,
    reserve1: 1000n,
    totalLiquidityUSD: 2000n,
    totalVolume0: 0n,
    totalVolume1: 0n,
    totalVolumeUSD: 1200n,
    totalVolumeUSDWhitelisted: 1200n,
    gaugeFees0CurrentEpoch: 0n,
    gaugeFees1CurrentEpoch: 0n,
    totalFees0: 0n,
    totalFees1: 0n,
    totalFeesUSD: 0n,
    totalFeesUSDWhitelisted: 0n,
    numberOfSwaps: 0n,
    token0Price: 1000000000000000000n, // 1 USD in 1e18
    token1Price: 5000000000000000000n, // 5 USD in 1e18
    totalVotesDeposited: 0n,
    totalVotesDepositedUSD: 0n,
    totalEmissions: 0n,
    totalEmissionsUSD: 0n,
    totalBribesUSD: 0n,
    gaugeIsAlive: true,
    isCL: true,
    lastUpdatedTimestamp: new Date(),
    lastSnapshotTimestamp: new Date(),
    token0IsWhitelisted: true,
    token1IsWhitelisted: true,
    name: "Test Pool",
  };

  // Mock token instances
  const mockToken0: Token = {
    id: "token0_id",
    address: "0x1111111111111111111111111111111111111111",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 18n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD
    chainId: 10,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
  };

  const mockToken1: Token = {
    id: "token1_id",
    address: "0x2222222222222222222222222222222222222222",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD
    chainId: 10,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
  };

  let refreshTokenPriceStub: sinon.SinonStub;

  beforeEach(() => {
    refreshTokenPriceStub = sinon
      .stub(PriceOracle, "refreshTokenPrice")
      .callsFake(async (token) => token); // Return the token as-is
    mockLogError.reset();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("processCLPoolSwap", () => {
    it("should create entity and calculate swap updates for successful swap", async () => {
      // Mock loader return
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      // Process the swap event
      const result = await processCLPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      // Assertions
      expect(result.CLPoolSwapEntity).to.deep.include({
        id: "10_123456_1",
        sender: "0x1111111111111111111111111111111111111111",
        recipient: "0x2222222222222222222222222222222222222222",
        amount0: 1000n,
        amount1: -500n,
        sqrtPriceX96: 79228162514264337593543950336n,
        liquidity: 10000n,
        tick: 0n,
        sourceAddress: "0x3333333333333333333333333333333333333333",
        blockNumber: 123456,
        logIndex: 1,
        chainId: 10,
        transactionHash:
          "0x4444444444444444444444444444444444444444444444444444444444444444",
      });

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolAggregator).to.exist;
      expect(result.error).to.be.undefined;

      // Verify liquidity pool diff content - all fields that should be set
      expect(result.liquidityPoolDiff).to.include({
        // From updateToken0SwapData
        totalVolume0: 1000n, // liquidityPoolAggregator.totalVolume0 + tokenUpdateData.netAmount0
        token0Price: 1000000000000000000n, // from mockToken0.pricePerUSDNew
        token0IsWhitelisted: true, // from mockToken0.isWhitelisted

        // From updateToken1SwapData
        totalVolume1: 500n, // liquidityPoolAggregator.totalVolume1 + tokenUpdateData.netAmount1
        token1Price: 1000000000000000000n, // from mockToken1.pricePerUSDNew
        token1IsWhitelisted: true, // from mockToken1.isWhitelisted

        // From updateLiquidityPoolAggregatorDiffSwap
        numberOfSwaps: 1n, // liquidityPoolAggregator.numberOfSwaps + 1n
        reserve0: 2000n, // 1000n + 1000n (existing + event.params.amount0)
        reserve1: 500n, // 1000n + (-500n) (existing + event.params.amount1)
        totalVolumeUSD: 2200n, // liquidityPoolAggregator.totalVolumeUSD + tokenUpdateData.volumeInUSD
        totalVolumeUSDWhitelisted: 2200n, // liquidityPoolAggregator.totalVolumeUSDWhitelisted + tokenUpdateData.volumeInUSDWhitelisted
        totalLiquidityUSD: 2500000000002000n, // from reserveResult.addTotalLiquidityUSD
      });

      // Verify that refreshTokenPrice was called for both tokens
      expect(refreshTokenPriceStub.calledTwice).to.be.true;
      expect(
        refreshTokenPriceStub.firstCall.calledWith(
          mockToken0,
          123456,
          1000000,
          10,
          mockContext,
          1000000n,
        ),
      ).to.be.true;
      expect(
        refreshTokenPriceStub.secondCall.calledWith(
          mockToken1,
          123456,
          1000000,
          10,
          mockContext,
          1000000n,
        ),
      ).to.be.true;
    });

    it("should handle TokenNotFoundError", async () => {
      const mockLoaderReturn = {
        _type: "TokenNotFoundError" as const,
        message: "Token not found",
      };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.CLPoolSwapEntity).to.exist;
      expect(result.error).to.equal("Token not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.liquidityPoolAggregator).to.be.undefined;
    });

    it("should handle LiquidityPoolAggregatorNotFoundError", async () => {
      const mockLoaderReturn = {
        _type: "LiquidityPoolAggregatorNotFoundError" as const,
        message: "Liquidity pool aggregator not found",
      };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.CLPoolSwapEntity).to.exist;
      expect(result.error).to.equal("Liquidity pool aggregator not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.liquidityPoolAggregator).to.be.undefined;
    });

    it("should handle unknown error type", async () => {
      const mockLoaderReturn = {
        _type: "UnknownError" as never,
        message: "Some unknown error",
      };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.CLPoolSwapEntity).to.exist;
      expect(result.error).to.equal("Unknown error type");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.liquidityPoolAggregator).to.be.undefined;
    });

    it("should handle refreshTokenPrice errors gracefully", async () => {
      // Mock refreshTokenPrice to throw an error for token0
      refreshTokenPriceStub
        .onFirstCall()
        .rejects(new Error("Price refresh failed"))
        .onSecondCall()
        .callsFake(async (token) => token);

      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      // Should still create the entity and continue processing
      expect(result.CLPoolSwapEntity).to.exist;
      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolAggregator).to.exist;
      expect(result.error).to.be.undefined;

      // Verify error was logged
      expect(mockLogError.calledOnce).to.be.true;
      expect(mockLogError.firstCall.args[0]).to.include(
        "Error refreshing token price",
      );
    });

    it("should handle missing token0Instance", async () => {
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: undefined,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.CLPoolSwapEntity).to.exist;
      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolAggregator).to.exist;
      expect(result.error).to.be.undefined;

      // Should only call refreshTokenPrice for token1
      expect(refreshTokenPriceStub.calledOnce).to.be.true;
      expect(refreshTokenPriceStub.firstCall.calledWith(
        mockToken1,
        123456,
        1000000,
        10,
        mockContext,
        1000000n,
      )).to.be.true;
    });

    it("should handle missing token1Instance", async () => {
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: undefined,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.CLPoolSwapEntity).to.exist;
      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolAggregator).to.exist;
      expect(result.error).to.be.undefined;

      // Should only call refreshTokenPrice for token0
      expect(refreshTokenPriceStub.calledOnce).to.be.true;
      expect(refreshTokenPriceStub.firstCall.calledWith(
        mockToken0,
        123456,
        1000000,
        10,
        mockContext,
        1000000n,
      )).to.be.true;
    });

    it("should not add to whitelisted volume when tokens are not whitelisted", async () => {
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: { ...mockToken0, isWhitelisted: false },
        token1Instance: { ...mockToken1, isWhitelisted: false },
      };

      const result = await processCLPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.CLPoolSwapEntity).to.exist;
      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolAggregator).to.exist;
      expect(result.error).to.be.undefined;

      // When tokens are not whitelisted, whitelisted volume should remain the same (no new whitelisted volume added)
      expect(result.liquidityPoolDiff?.totalVolumeUSDWhitelisted).to.equal(
        1200n,
      );
      expect(result.liquidityPoolDiff?.totalVolumeUSD).to.equal(2200n); // But total volume should still be calculated
    });
  });
});
