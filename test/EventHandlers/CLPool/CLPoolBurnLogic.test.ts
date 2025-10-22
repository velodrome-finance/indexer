import { expect } from "chai";
import type {
  CLPool_Burn_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { processCLPoolBurn } from "../../../src/EventHandlers/CLPool/CLPoolBurnLogic";

describe("CLPoolBurnLogic", () => {
  const mockEvent: CLPool_Burn_event = {
    chainId: 10,
    block: {
      number: 12345,
      timestamp: 1000000,
    },
    logIndex: 1,
    srcAddress: "0x1234567890123456789012345678901234567890",
    transaction: {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    },
    params: {
      owner: "0xabcdef1234567890abcdef1234567890abcdef12",
      tickLower: -1000n,
      tickUpper: 1000n,
      amount: 1000000n,
      amount0: 500000n,
      amount1: 300000n,
    },
  } as CLPool_Burn_event;

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
    totalGaugeRewardsClaimed: 0n,
    currentLiquidityStakedUSD: 0n,
    // Pool Launcher relationship
    poolLauncherPoolId: undefined,
    // Voting fields
    gaugeAddress: "",
    numberOfVotes: 0n,
    currentVotingPower: 0n,
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

  describe("processCLPoolBurn", () => {
    it("should process burn event successfully with valid data", async () => {
      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolBurn(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff).to.not.be.undefined;
      expect(result.userLiquidityDiff).to.not.be.undefined;

      // Check liquidity pool diff with exact values
      expect(result.liquidityPoolDiff?.reserve0).to.equal(500000n); // New reserve0 value
      expect(result.liquidityPoolDiff?.reserve1).to.equal(300000n); // New reserve1 value

      // Calculate exact totalLiquidityUSD: (500000 * 1 USD) + (300000 * 2 USD) = 500000 + 600000 = 1100000 USD
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(1100000n); // 1.1M USD in 18 decimals

      // Exact timestamp: 1000000 * 1000 = 1000000000ms
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000000),
      );

      // Check user liquidity diff with exact values
      // netLiquidityAddedUSD should be negative for burn (removal): -1100000n
      expect(result.userLiquidityDiff?.netLiquidityAddedUSD).to.equal(
        -1100000n,
      );
      expect(result.userLiquidityDiff?.currentLiquidityToken0).to.equal(
        -500000n,
      ); // Negative amount of token0 removed
      expect(result.userLiquidityDiff?.currentLiquidityToken1).to.equal(
        -300000n,
      ); // Negative amount of token1 removed
      expect(result.userLiquidityDiff?.timestamp).to.deep.equal(
        new Date(1000000000),
      );
    });

    it("should handle TokenNotFoundError", async () => {
      const loaderReturn = {
        _type: "TokenNotFoundError" as const,
        message: "Token not found",
      };

      const result = await processCLPoolBurn(
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

      const result = await processCLPoolBurn(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.equal("Pool not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.userLiquidityDiff).to.be.undefined;
    });

    it("should calculate correct liquidity values for burn event", async () => {
      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolBurn(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      // For burn events, we expect negative liquidity change with exact values
      expect(result.userLiquidityDiff?.netLiquidityAddedUSD).to.equal(
        -1100000n,
      );
      expect(result.userLiquidityDiff?.currentLiquidityToken0).to.equal(
        -500000n,
      );
      expect(result.userLiquidityDiff?.currentLiquidityToken1).to.equal(
        -300000n,
      );

      // The liquidity pool diff should reflect the new reserve values
      expect(result.liquidityPoolDiff?.reserve0).to.equal(500000n); // New reserve0 value
      expect(result.liquidityPoolDiff?.reserve1).to.equal(300000n); // New reserve1 value
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(1100000n);
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

      const result = await processCLPoolBurn(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff).to.not.be.undefined;
      expect(result.userLiquidityDiff).to.not.be.undefined;
    });
  });
});
