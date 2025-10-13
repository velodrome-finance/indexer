import { expect } from "chai";
import type {
  CLPool_Flash_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { processCLPoolFlash } from "../../../src/EventHandlers/CLPool/CLPoolFlashLogic";

describe("CLPoolFlashLogic", () => {
  const mockEvent: CLPool_Flash_event = {
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
      sender: "0xabcdef1234567890abcdef1234567890abcdef12",
      recipient: "0xabcdef1234567890abcdef1234567890abcdef12",
      amount0: 1000000n,
      amount1: 500000n,
      paid0: 1000n, // Fees paid
      paid1: 500n, // Fees paid
    },
  } as CLPool_Flash_event;

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

  const mockContext = {
    log: {
      error: () => {},
      warn: () => {},
      info: () => {},
    },
    isPreload: false,
  } as unknown as handlerContext;

  describe("processCLPoolFlash", () => {
    it("should process flash event successfully with valid data", async () => {
      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolFlash(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff).to.not.be.undefined;
      expect(result.userFlashLoanDiff).to.not.be.undefined;

      // Check liquidity pool diff with exact values
      expect(result.liquidityPoolDiff?.totalFlashLoanFees0).to.equal(1000n); // paid0
      expect(result.liquidityPoolDiff?.totalFlashLoanFees1).to.equal(500n); // paid1
      expect(result.liquidityPoolDiff?.numberOfFlashLoans).to.equal(1n);

      // Calculate exact flash loan fees USD: (1000 * 1 USD) + (500 * 2 USD) = 1000 + 1000 = 2000 USD
      expect(result.liquidityPoolDiff?.totalFlashLoanFeesUSD).to.equal(2000n);

      // Calculate exact flash loan volume USD: (1000000 * 1 USD) + (500000 * 2 USD) = 1000000 + 1000000 = 2000000 USD
      expect(result.liquidityPoolDiff?.totalFlashLoanVolumeUSD).to.equal(
        2000000n,
      );

      // Exact timestamp: 1000000 * 1000 = 1000000000ms
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000000),
      );

      // Check user flash loan diff with exact values
      expect(result.userFlashLoanDiff?.numberOfFlashLoans).to.equal(1n);
      expect(result.userFlashLoanDiff?.totalFlashLoanVolumeUSD).to.equal(
        2000000n,
      );
      expect(result.userFlashLoanDiff?.timestamp).to.deep.equal(
        new Date(1000000000),
      );
    });

    it("should handle TokenNotFoundError", async () => {
      const loaderReturn = {
        _type: "TokenNotFoundError" as const,
        message: "Token not found",
      };

      const result = await processCLPoolFlash(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.equal("Token not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.userFlashLoanDiff).to.be.undefined;
    });

    it("should handle LiquidityPoolAggregatorNotFoundError", async () => {
      const loaderReturn = {
        _type: "LiquidityPoolAggregatorNotFoundError" as const,
        message: "Pool not found",
      };

      const result = await processCLPoolFlash(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.equal("Pool not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
      expect(result.userFlashLoanDiff).to.be.undefined;
    });

    it("should calculate flash loan fees correctly", async () => {
      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolFlash(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      // Fees should be calculated based on paid amounts and token prices
      expect(result.liquidityPoolDiff?.totalFlashLoanFees0).to.equal(
        mockEvent.params.paid0,
      );
      expect(result.liquidityPoolDiff?.totalFlashLoanFees1).to.equal(
        mockEvent.params.paid1,
      );
      expect(result.liquidityPoolDiff?.totalFlashLoanFeesUSD).to.equal(2000n); // 2000 USD in 18 decimals
    });

    it("should calculate flash loan volume correctly", async () => {
      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolFlash(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      // Volume should be calculated based on borrowed amounts (not fees)
      expect(result.userFlashLoanDiff?.totalFlashLoanVolumeUSD).to.equal(
        2000000n,
      ); // 2M USD in 18 decimals
      expect(result.userFlashLoanDiff?.numberOfFlashLoans).to.equal(1n);
    });

    it("should handle zero amounts correctly", async () => {
      const eventWithZeroAmounts: CLPool_Flash_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 0n,
          amount1: 0n,
          paid0: 0n,
          paid1: 0n,
        },
      };

      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolFlash(
        eventWithZeroAmounts,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff?.totalFlashLoanFees0).to.equal(0n);
      expect(result.liquidityPoolDiff?.totalFlashLoanFees1).to.equal(0n);
      expect(result.liquidityPoolDiff?.totalFlashLoanFeesUSD).to.equal(0n);
      expect(result.userFlashLoanDiff?.totalFlashLoanVolumeUSD).to.equal(0n);
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

      const result = await processCLPoolFlash(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff).to.not.be.undefined;
      expect(result.userFlashLoanDiff).to.not.be.undefined;
    });

    it("should handle existing flash loan data correctly", async () => {
      const poolWithExistingFlashLoans: LiquidityPoolAggregator = {
        ...mockLiquidityPoolAggregator,
        totalFlashLoanFees0: 5000n,
        totalFlashLoanFees1: 3000n,
        totalFlashLoanFeesUSD: 8000n,
        totalFlashLoanVolumeUSD: 100000n,
        numberOfFlashLoans: 5n,
      };

      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: poolWithExistingFlashLoans,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = await processCLPoolFlash(
        mockEvent,
        loaderReturn,
        mockContext,
      );

      expect(result.liquidityPoolDiff?.totalFlashLoanFees0).to.equal(
        mockEvent.params.paid0,
      );
      expect(result.liquidityPoolDiff?.totalFlashLoanFees1).to.equal(
        mockEvent.params.paid1,
      );
      expect(result.liquidityPoolDiff?.numberOfFlashLoans).to.equal(1n); // Just the diff
    });
  });
});
