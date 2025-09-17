import { expect } from "chai";
import type {
  CLPool_Mint_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { processCLPoolMint } from "../../../src/EventHandlers/CLPool/CLPoolMintLogic";

describe("CLPoolMintLogic", () => {
  // Shared mock event for all tests
  const mockEvent: CLPool_Mint_event = {
    params: {
      sender: "0x1111111111111111111111111111111111111111",
      owner: "0x2222222222222222222222222222222222222222",
      tickLower: 100000n,
      tickUpper: 200000n,
      amount: 1000n,
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

  describe("processCLPoolMint", () => {
    it("should create entity and calculate liquidity updates for successful mint", () => {
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
        totalVolumeUSD: 0n,
        totalVolumeUSDWhitelisted: 0n,
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

      // Mock loader return
      const mockLoaderReturn = {
        _type: "success" as const,
        liquidityPoolAggregator: mockLiquidityPoolAggregator,
        token0Instance: mockToken0,
        token1Instance: mockToken1,
      };

      // Process the mint event
      const result = processCLPoolMint(mockEvent, mockLoaderReturn);

      // Assertions
      expect(result.CLPoolMintEntity).to.deep.include({
        id: "10_123456_1",
        sender: "0x1111111111111111111111111111111111111111",
        transactionHash:
          "0x4444444444444444444444444444444444444444444444444444444444444444",
        owner: "0x2222222222222222222222222222222222222222",
        tickLower: 100000n,
        tickUpper: 200000n,
        amount: 1000n,
        amount0: 750n,
        amount1: 500n,
        sourceAddress: "0x3333333333333333333333333333333333333333",
        blockNumber: 123456,
        logIndex: 1,
        chainId: 10,
      });

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.liquidityPoolDiff?.reserve0).to.equal(1750n); // 1000 + 750
      expect(result.liquidityPoolDiff?.reserve1).to.equal(1500n); // 1000 + 500
      expect(result.liquidityPoolDiff?.totalLiquidityUSD).to.equal(
        7500000000001750n,
      ); // 1750 * (1e18 / 1e18) * (1e18 / 1e18) + 1500 * (1e18 / 1e6) * (5e18 / 1e18)
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

      const result = processCLPoolMint(mockEvent, mockLoaderReturn);

      expect(result.CLPoolMintEntity).to.exist;
      expect(result.error).to.equal("Token not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
    });

    it("should handle LiquidityPoolAggregatorNotFoundError", () => {
      const mockLoaderReturn = {
        _type: "LiquidityPoolAggregatorNotFoundError" as const,
        message: "Liquidity pool aggregator not found",
      };

      const result = processCLPoolMint(mockEvent, mockLoaderReturn);

      expect(result.CLPoolMintEntity).to.exist;
      expect(result.error).to.equal("Liquidity pool aggregator not found");
      expect(result.liquidityPoolDiff).to.be.undefined;
    });

    it("should handle unknown error type", () => {
      const mockLoaderReturn = {
        _type: "UnknownError" as never,
        message: "Some unknown error",
      };

      const result = processCLPoolMint(mockEvent, mockLoaderReturn);

      expect(result.CLPoolMintEntity).to.exist;
      expect(result.error).to.equal("Unknown error type");
      expect(result.liquidityPoolDiff).to.be.undefined;
    });
  });
});
