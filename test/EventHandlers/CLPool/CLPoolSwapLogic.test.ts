import { expect } from "chai";
import type {
  CLPool_Swap_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { processCLPoolSwap } from "../../../src/EventHandlers/CLPool/CLPoolSwapLogic";

describe("CLPoolSwapLogic", () => {
  const mockEvent: CLPool_Swap_event = {
    params: {
      sender: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
      amount0: 1000000000000000000n, // 1 token
      amount1: -2000000000000000000n, // -2 tokens (negative means token1 out)
      sqrtPriceX96: 2000000000000000000000000000000n, // sqrt price
      liquidity: 1000000000000000000000n,
      tick: 1000n,
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
  } as CLPool_Swap_event;

  const mockLiquidityPoolAggregator: LiquidityPoolAggregator = {
    id: "0x1234567890123456789012345678901234567890",
    chainId: 10,
    name: "Test Pool",
    token0_id: "token0_id",
    token1_id: "token1_id",
    token0_address: "0xtoken0",
    token1_address: "0xtoken1",
    isStable: false,
    isCL: true,
    reserve0: 10000000n,
    reserve1: 6000000n,
    totalLiquidityUSD: 10000000n,
    totalVolume0: 0n,
    totalVolume1: 0n,
    totalVolumeUSD: 0n,
    totalVolumeUSDWhitelisted: 0n,
    totalFees0: 0n,
    totalFees1: 0n,
    gaugeFees0CurrentEpoch: 0n,
    gaugeFees1CurrentEpoch: 0n,
    totalFeesUSD: 0n,
    totalFeesUSDWhitelisted: 0n,
    numberOfSwaps: 0n,
    token0Price: 1000000000000000000n, // 1 USD
    token1Price: 2000000000000000000n, // 2 USD
    totalVotesDeposited: 0n,
    totalVotesDepositedUSD: 0n,
    totalEmissions: 0n,
    totalEmissionsUSD: 0n,
    totalBribesUSD: 0n,
    gaugeIsAlive: false,
    token0IsWhitelisted: false,
    token1IsWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
    lastSnapshotTimestamp: new Date(1000000 * 1000),
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
  };

  const mockToken0: Token = {
    id: "token0_id",
    address: "0xtoken0",
    symbol: "TOKEN0",
    name: "Token 0",
    decimals: 18n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD
    chainId: 10,
    isWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  const mockToken1: Token = {
    id: "token1_id",
    address: "0xtoken1",
    symbol: "TOKEN1",
    name: "Token 1",
    decimals: 18n,
    pricePerUSDNew: 2000000000000000000n, // 2 USD
    chainId: 10,
    isWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  const mockContext: handlerContext = {
    log: {
      error: () => {},
      warn: () => {},
      info: () => {},
    },
  } as unknown as handlerContext;

  describe("processCLPoolSwap", () => {
    it("should process swap event successfully with valid data", async () => {
      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff).to.not.be.undefined;
      expect(result.userSwapDiff).to.not.be.undefined;

      // Check liquidity pool diff with exact values
      expect(result.liquidityPoolDiff?.totalVolume0).to.equal(
        1000000000000000000n,
      ); // amount0 (1 token)
      expect(result.liquidityPoolDiff?.totalVolume1).to.equal(
        2000000000000000000n,
      ); // |amount1| (2 tokens, absolute value)
      expect(result.liquidityPoolDiff?.numberOfSwaps).to.equal(1n);

      expect(result.liquidityPoolDiff?.totalVolumeUSD).to.equal(
        1000000000000000000n,
      );

      // Exact timestamp: 1000000 * 1000 = 1000000000ms
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000000),
      );

      // Check user swap diff with exact values
      expect(result.userSwapDiff?.numberOfSwaps).to.equal(1n);
      expect(result.userSwapDiff?.totalSwapVolumeUSD).to.equal(
        1000000000000000000n,
      ); // 5 USD in 18 decimals
      expect(result.userSwapDiff?.timestamp).to.deep.equal(
        new Date(1000000000),
      );
    });

    it("should handle TokenNotFoundError", async () => {
      const loaderReturn = {
        _type: "TokenNotFoundError" as const,
        message: "Token not found",
      };

      const result = await processCLPoolSwap(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.equal("Token not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.userSwapDiff).to.be.undefined;
    });

    it("should handle LiquidityPoolAggregatorNotFoundError", async () => {
      const loaderReturn = {
        _type: "LiquidityPoolAggregatorNotFoundError" as const,
        message: "Pool not found",
      };

      const result = await processCLPoolSwap(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.equal("Pool not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.userSwapDiff).to.be.undefined;
    });

    it("should calculate correct volume values for swap event", async () => {
      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      // The liquidity pool diff should reflect the swap volumes with exact values
      expect(result.liquidityPoolDiff?.totalVolume0).to.equal(
        1000000000000000000n,
      ); // amount0
      expect(result.liquidityPoolDiff?.totalVolume1).to.equal(
        2000000000000000000n,
      ); // |amount1|
      expect(result.liquidityPoolDiff?.totalVolumeUSD).to.equal(
        1000000000000000000n,
      );
      expect(result.liquidityPoolDiff?.numberOfSwaps).to.equal(1n);

      // User swap diff should track individual user activity with exact values
      expect(result.userSwapDiff?.numberOfSwaps).to.equal(1n);
      expect(result.userSwapDiff?.totalSwapVolumeUSD).to.equal(
        1000000000000000000n,
      );
    });

    it("should handle different token decimals correctly", async () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n, // USDC-like token
      };

      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: tokenWithDifferentDecimals,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff).to.not.be.undefined;
      expect(result.userSwapDiff).to.not.be.undefined;
    });

    it("should handle zero amounts correctly", async () => {
      const eventWithZeroAmounts: CLPool_Swap_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 0n,
          amount1: 0n,
        },
      };

      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolSwap(
        eventWithZeroAmounts,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff?.totalVolume0).to.equal(0n);
      expect(result.liquidityPoolDiff?.totalVolume1).to.equal(0n);
      expect(result.liquidityPoolDiff?.totalVolumeUSD).to.equal(0n);
      expect(result.userSwapDiff?.totalSwapVolumeUSD).to.equal(0n);
    });

    it("should handle existing swap data correctly", async () => {
      const poolWithExistingSwaps: LiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        totalVolume0: 5000n,
        totalVolume1: 3000n,
        totalVolumeUSD: 8000n,
        numberOfSwaps: 5n,
      };

      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: poolWithExistingSwaps,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.numberOfSwaps).to.equal(1n); // Only the diff, not cumulative
      expect(result.liquidityPoolDiff?.totalVolume0).to.equal(
        1000000000000000000n,
      ); // amount0
      expect(result.liquidityPoolDiff?.totalVolume1).to.equal(
        2000000000000000000n,
      ); // |amount1|
      expect(result.liquidityPoolDiff?.totalVolumeUSD).to.equal(
        1000000000000000000n,
      ); // Only the diff, not cumulative
    });
  });
});
