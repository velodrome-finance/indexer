import { expect } from "chai";
import type {
  LiquidityPoolAggregator,
  Pool_Swap_event,
  Token,
  handlerContext,
} from "generated";
import sinon from "sinon";
import { processPoolSwap } from "../../../src/EventHandlers/Pool/PoolSwapLogic";
import * as PriceOracle from "../../../src/PriceOracle";

describe("PoolSwapLogic", () => {
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
    totalVolume0: 1n,
    totalVolume1: 1n,
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
    isCL: false,
    lastUpdatedTimestamp: new Date(),
    lastSnapshotTimestamp: new Date(),
    token0IsWhitelisted: true,
    token1IsWhitelisted: true,
    name: "Test Pool",
    // CL Pool specific fields (set to 0 for regular pools)
    feeProtocol0: 0n,
    feeProtocol1: 0n,
    observationCardinalityNext: 0n,
    totalFlashLoanFees0: 0n,
    totalFlashLoanFees1: 0n,
    totalFlashLoanFeesUSD: 0n,
    totalFlashLoanVolumeUSD: 0n,
    numberOfFlashLoans: 0n,
    // Gauge fields
    numberOfGaugeDeposits: 0n,
    numberOfGaugeWithdrawals: 0n,
    numberOfGaugeRewardClaims: 0n,
    totalGaugeRewardsClaimedUSD: 0n,
    currentLiquidityStakedUSD: 0n,
    // Pool Launcher relationship
    poolLauncherPoolId: undefined,
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

  describe("processPoolSwap", () => {
    it("should create entity and calculate swap updates for successful swap", async () => {
      // Mock loader return
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      // Process the swap event
      const result = await processPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      // Assertions
      expect(result.liquidityPoolDiff).to.exist;
      expect(result.userSwapDiff).to.exist;
      expect(result.error).to.be.undefined;

      // Verify user swap diff content
      expect(result.userSwapDiff).to.deep.include({
        userAddress: "0x1111111111111111111111111111111111111111",
        chainId: 10,
        volumeUSD: 1000n, // from swapData.volumeInUSD (token0: 1000 * 1 USD)
        timestamp: new Date(1000000 * 1000),
      });

      // Verify liquidity pool diff content
      expect(result.liquidityPoolDiff).to.include({
        totalVolume0: 1000n, // netAmount0 (diff) - amount0In + amount0Out = 1000 + 0
        totalVolume1: 500n, // netAmount1 (diff) - amount1In + amount1Out = 0 + 500
        numberOfSwaps: 1n, // diff
        token0Price: 1000000000000000000n, // from mockToken0.pricePerUSDNew
        token1Price: 1000000000000000000n, // from mockToken1.pricePerUSDNew
        token0IsWhitelisted: true, // from mockToken0.isWhitelisted
        token1IsWhitelisted: true, // from mockToken1.isWhitelisted
      });

      // Check timestamp separately
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000 * 1000),
      );

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

      const result = await processPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.error).to.equal("Token not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.userSwapDiff).to.be.undefined;
    });

    it("should handle LiquidityPoolAggregatorNotFoundError", async () => {
      const mockLoaderReturn = {
        _type: "LiquidityPoolAggregatorNotFoundError" as const,
        message: "Liquidity pool aggregator not found",
      };

      const result = await processPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.error).to.equal("Liquidity pool aggregator not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.userSwapDiff).to.be.undefined;
    });

    it("should handle unknown error type", async () => {
      const mockLoaderReturn = {
        _type: "UnknownError" as never,
        message: "Some unknown error",
      };

      const result = await processPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.error).to.equal("Unknown error type");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.userSwapDiff).to.be.undefined;
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

      const result = await processPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      // Should still process and continue processing
      expect(result.liquidityPoolDiff).to.exist;
      expect(result.userSwapDiff).to.exist;
      expect(result.error).to.be.undefined;

      // Verify error was logged
      expect(mockLogError.calledOnce).to.be.true;
      expect(mockLogError.firstCall.args[0]).to.include(
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

      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processPoolSwap(
        modifiedEvent,
        mockLoaderReturn,
        mockContext,
      );

      // Token0 has amount0In + amount0Out = 2n + 100n = 102n
      // Token1 has amount1In + amount1Out = 2000n + 5n = 2005n
      // The logic uses the smaller volume for calculation (102n from token0)
      // Expected: 102n (token0 volume diff)
      expect(result.liquidityPoolDiff?.totalVolumeUSD).to.equal(102n);
    });

    it("should not add to whitelisted volume when tokens are not whitelisted", async () => {
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: { ...mockToken0, isWhitelisted: false },
        token1Instance: { ...mockToken1, isWhitelisted: false },
      };

      const result = await processPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.userSwapDiff).to.exist;
      expect(result.error).to.be.undefined;

      // When tokens are not whitelisted, whitelisted volume diff should be 0
      expect(result.liquidityPoolDiff?.totalVolumeUSDWhitelisted).to.equal(0n);
      // But total volume should still be calculated: 1000n USD (1000 USDT * 1 USD, uses token0 value)
      expect(result.liquidityPoolDiff?.totalVolumeUSD).to.equal(1000n);
    });

    it("should add to whitelisted volume when both tokens are whitelisted", async () => {
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: { ...mockToken0, isWhitelisted: true },
        token1Instance: { ...mockToken1, isWhitelisted: true },
      };

      const result = await processPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.userSwapDiff).to.exist;
      expect(result.error).to.be.undefined;

      // When both tokens are whitelisted, whitelisted volume should be added
      // Expected: 1000n USD (1000 USDT * 1 USD, uses token0 value)
      expect(result.liquidityPoolDiff?.totalVolumeUSDWhitelisted).to.equal(
        1000n,
      );
    });

    it("should handle mixed whitelist status correctly", async () => {
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: { ...mockToken0, isWhitelisted: true },
        token1Instance: { ...mockToken1, isWhitelisted: false },
      };

      const result = await processPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.userSwapDiff).to.exist;
      expect(result.error).to.be.undefined;

      // When only one token is whitelisted, whitelisted volume diff should be 0
      expect(result.liquidityPoolDiff?.totalVolumeUSDWhitelisted).to.equal(0n);
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

      refreshTokenPriceStub
        .onFirstCall()
        .resolves(updatedToken0)
        .onSecondCall()
        .resolves(updatedToken1);

      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processPoolSwap(
        mockEvent,
        mockLoaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.token0Price).to.equal(
        2000000000000000000n,
      );
      expect(result.liquidityPoolDiff?.token1Price).to.equal(
        3000000000000000000n,
      );
    });
  });
});
