import { expect } from "chai";
import type {
  CLPool_CollectFees_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { processCLPoolCollectFees } from "../../../src/EventHandlers/CLPool/CLPoolCollectFeesLogic";

describe("CLPoolCollectFeesLogic", () => {
  const mockEvent: CLPool_CollectFees_event = {
    params: {
      owner: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
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
  } as CLPool_CollectFees_event;

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
    // Pool Launcher relationship$5    // Voting Reward fields
    bribeVotingRewardAddress: "",
    totalBribeClaimed: 0n,
    totalBribeClaimedUSD: 0n,
    feeVotingRewardAddress: "",
    totalFeeRewardClaimed: 0n,
    totalFeeRewardClaimedUSD: 0n,
    veNFTamountStaked: 0n,
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

  describe("processCLPoolCollectFees", () => {
    it("should process collect fees event successfully with valid data", () => {
      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = processCLPoolCollectFees(mockEvent, loaderReturn);

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff).to.not.be.undefined;

      // Check liquidity pool diff with exact values
      expect(result.liquidityPoolDiff?.totalFees0).to.equal(
        1000000000000000000n,
      );
      expect(result.liquidityPoolDiff?.totalFees1).to.equal(
        2000000000000000000n,
      );

      // Exact USD calculation: 1 USD + 4 USD = 5 USD
      expect(result.liquidityPoolDiff?.totalFeesUSD).to.equal(
        5000000000000000000n,
      );

      // Exact timestamp: 1000000 * 1000 = 1000000000ms
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000000),
      );
    });

    it("should handle TokenNotFoundError", () => {
      const loaderReturn = {
        _type: "TokenNotFoundError" as const,
        message: "Token not found",
      };

      const result = processCLPoolCollectFees(mockEvent, loaderReturn);

      expect(result.error).to.equal("Token not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
    });

    it("should handle LiquidityPoolAggregatorNotFoundError", () => {
      const loaderReturn = {
        _type: "LiquidityPoolAggregatorNotFoundError" as const,
        message: "Pool not found",
      };

      const result = processCLPoolCollectFees(mockEvent, loaderReturn);

      expect(result.error).to.equal("Pool not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
    });

    it("should calculate correct fee values for collect fees event", () => {
      const loaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      const result = processCLPoolCollectFees(mockEvent, loaderReturn);

      // The liquidity pool diff should reflect the fees being collected with exact values
      expect(result.liquidityPoolDiff?.totalFees0).to.equal(
        1000000000000000000n,
      );
      expect(result.liquidityPoolDiff?.totalFees1).to.equal(
        2000000000000000000n,
      );
      expect(result.liquidityPoolDiff?.totalFeesUSD).to.equal(
        5000000000000000000n,
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

      const result = processCLPoolCollectFees(mockEvent, loaderReturn);

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff).to.not.be.undefined;
    });

    it("should handle zero amounts correctly", () => {
      const eventWithZeroAmounts: CLPool_CollectFees_event = {
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

      const result = processCLPoolCollectFees(
        eventWithZeroAmounts,
        loaderReturn,
      );

      expect(result.error).to.be.undefined;
      expect(result.liquidityPoolDiff?.totalFees0).to.equal(0n);
      expect(result.liquidityPoolDiff?.totalFees1).to.equal(0n);
      expect(result.liquidityPoolDiff?.totalFeesUSD).to.equal(0n);
    });
  });
});
