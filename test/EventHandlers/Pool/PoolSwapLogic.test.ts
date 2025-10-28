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
import { setupCommon } from "./common";

describe("PoolSwapLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
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
    ...mockLiquidityPoolData,
    id: "0x3333333333333333333333333333333333333333",
    token0_id: mockToken0Data.id,
    token1_id: mockToken1Data.id,
    token0_address: mockToken0Data.address,
    token1_address: mockToken1Data.address,
    reserve0: 1000n,
    reserve1: 1000n,
    totalLiquidityUSD: 2000n,
    totalVolume0: 1n,
    totalVolume1: 1n,
    totalVolumeUSD: 1200n,
    totalVolumeUSDWhitelisted: 1200n,
    token0Price: 1000000000000000000n,
    token1Price: 5000000000000000000n,
    gaugeIsAlive: true,
    name: "Test Pool",
  };

  // Mock token instances
  const mockToken0: Token = {
    ...mockToken0Data,
    id: "token0_id",
    address: "0x1111111111111111111111111111111111111111",
    symbol: "USDT",
  };

  const mockToken1: Token = {
    ...mockToken1Data,
    id: "token1_id",
    address: "0x2222222222222222222222222222222222222222",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6n,
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
      // Process the swap event
      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Assertions
      expect(result.liquidityPoolDiff).to.exist;
      expect(result.userSwapDiff).to.exist;

      // Verify user swap diff content
      expect(result.userSwapDiff).to.deep.include({
        numberOfSwaps: 1n,
        totalSwapVolumeUSD: 1000n, // from swapData.volumeInUSD (token0: 1000 * 1 USD)
        lastActivityTimestamp: new Date(1000000 * 1000),
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

    it("should handle refreshTokenPrice errors gracefully", async () => {
      // Mock refreshTokenPrice to throw an error for token0
      refreshTokenPriceStub
        .onFirstCall()
        .rejects(new Error("Price refresh failed"))
        .onSecondCall()
        .callsFake(async (token) => token);

      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Should still process and continue processing
      expect(result.liquidityPoolDiff).to.exist;
      expect(result.userSwapDiff).to.exist;

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

      const result = await processPoolSwap(
        modifiedEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // Token0 has amount0In + amount0Out = 2n + 100n = 102n
      // Token1 has amount1In + amount1Out = 2000n + 5n = 2005n
      // The logic uses the smaller volume for calculation (102n from token0)
      // Expected: 102n (token0 volume diff)
      expect(result.liquidityPoolDiff?.totalVolumeUSD).to.equal(102n);
    });

    it("should not add to whitelisted volume when tokens are not whitelisted", async () => {
      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        { ...mockToken0, isWhitelisted: false },
        { ...mockToken1, isWhitelisted: false },
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.userSwapDiff).to.exist;

      // When tokens are not whitelisted, whitelisted volume diff should be 0
      expect(result.liquidityPoolDiff?.totalVolumeUSDWhitelisted).to.equal(0n);
      // But total volume should still be calculated: 1000n USD (1000 USDT * 1 USD, uses token0 value)
      expect(result.liquidityPoolDiff?.totalVolumeUSD).to.equal(1000n);
    });

    it("should add to whitelisted volume when both tokens are whitelisted", async () => {
      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        { ...mockToken0, isWhitelisted: true },
        { ...mockToken1, isWhitelisted: true },
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.userSwapDiff).to.exist;

      // When both tokens are whitelisted, whitelisted volume should be added
      // Expected: 1000n USD (1000 USDT * 1 USD, uses token0 value)
      expect(result.liquidityPoolDiff?.totalVolumeUSDWhitelisted).to.equal(
        1000n,
      );
    });

    it("should handle mixed whitelist status correctly", async () => {
      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        { ...mockToken0, isWhitelisted: true },
        { ...mockToken1, isWhitelisted: false },
        mockContext,
      );

      expect(result.liquidityPoolDiff).to.exist;
      expect(result.userSwapDiff).to.exist;

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

      const result = await processPoolSwap(
        mockEvent,
        mockLiquidityPoolAggregator,
        mockToken0,
        mockToken1,
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
