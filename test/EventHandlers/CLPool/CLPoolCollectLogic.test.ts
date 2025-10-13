import { expect } from "chai";
import type {
  CLPool_Collect_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { processCLPoolCollect } from "../../../src/EventHandlers/CLPool/CLPoolCollectLogic";

describe("CLPoolCollectLogic", () => {
  const mockEvent: CLPool_Collect_event = {
    params: {
      owner: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
      tickLower: 100000n,
      tickUpper: 200000n,
      amount0: 1000000000000000000n, // 1 token
      amount1: 2000000000000000000n, // 2 tokens
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
  } as CLPool_Collect_event;

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

  describe("processCLPoolCollect", () => {
    it("should process collect event successfully with valid data", async () => {
      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolCollect(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff).to.not.be.undefined;
      expect(result.userLiquidityDiff).to.not.be.undefined;

      // Check liquidity pool diff with exact values
      expect(result.liquidityPoolDiff?.reserve0).to.equal(1000000000000000000n); // amount0
      expect(result.liquidityPoolDiff?.reserve1).to.equal(2000000000000000000n); // amount1

      // Calculate exact totalLiquidityUSD: (1 * 1 USD) + (2 * 2 USD) = 1 + 4 = 5 USD
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(
        5000000000000000000n,
      ); // 5 USD in 18 decimals

      // Exact timestamp: 1000000 * 1000 = 1000000000ms
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000000),
      );

      // Check user fee contribution diff with exact values
      expect(result.userLiquidityDiff?.totalFeesContributed0).to.equal(
        1000000000000000000n,
      ); // amount0
      expect(result.userLiquidityDiff?.totalFeesContributed1).to.equal(
        2000000000000000000n,
      ); // amount1
      expect(result.userLiquidityDiff?.totalFeesContributedUSD).to.equal(
        5000000000000000000n,
      ); // 5 USD in 18 decimals
      expect(result.userLiquidityDiff?.timestamp).to.deep.equal(
        new Date(1000000000),
      );
    });

    it("should handle TokenNotFoundError", async () => {
      const loaderReturn = {
        _type: "TokenNotFoundError" as const,
        message: "Token not found",
      };

      const result = await processCLPoolCollect(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.equal("Token not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.userLiquidityDiff).to.be.undefined;
    });

    it("should handle LiquidityPoolAggregatorNotFoundError", async () => {
      const loaderReturn = {
        _type: "LiquidityPoolAggregatorNotFoundError" as const,
        message: "Pool not found",
      };

      const result = await processCLPoolCollect(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.equal("Pool not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.userLiquidityDiff).to.be.undefined;
    });

    it("should calculate correct liquidity values for collect event", async () => {
      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolCollect(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      // The liquidity pool diff should reflect the amounts being collected with exact values
      expect(result.liquidityPoolDiff?.reserve0).to.equal(1000000000000000000n); // amount0
      expect(result.liquidityPoolDiff?.reserve1).to.equal(2000000000000000000n); // amount1
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(
        5000000000000000000n,
      ); // 5 USD in 18 decimals

      // User fee contribution should be calculated based on the collected amounts with exact values
      expect(result.userLiquidityDiff?.totalFeesContributed0).to.equal(
        1000000000000000000n,
      ); // amount0
      expect(result.userLiquidityDiff?.totalFeesContributed1).to.equal(
        2000000000000000000n,
      ); // amount1
      expect(result.userLiquidityDiff?.totalFeesContributedUSD).to.equal(
        5000000000000000000n,
      ); // 5 USD in 18 decimals
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

      const result = await processCLPoolCollect(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff).to.not.be.undefined;
      expect(result.userLiquidityDiff).to.not.be.undefined;
    });

    it("should handle zero amounts correctly", async () => {
      const eventWithZeroAmounts: CLPool_Collect_event = {
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

      const result = await processCLPoolCollect(
        eventWithZeroAmounts,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff?.reserve0).to.equal(0n);
      expect(result.liquidityPoolDiff?.reserve1).to.equal(0n);
      expect(result.userLiquidityDiff?.totalFeesContributed0).to.equal(0n);
      expect(result.userLiquidityDiff?.totalFeesContributed1).to.equal(0n);
      expect(result.userLiquidityDiff?.totalFeesContributedUSD).to.equal(0n);
    });
  });
});
