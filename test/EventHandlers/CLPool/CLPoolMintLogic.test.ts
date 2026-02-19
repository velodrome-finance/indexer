import type { Token } from "generated";
import { CLPool } from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { processCLPoolMint } from "../../../src/EventHandlers/CLPool/CLPoolMintLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolMintLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();

  const mockEvent = CLPool.Mint.createMockEvent({
    owner: toChecksumAddress("0x1111111111111111111111111111111111111111"),
    tickLower: 100000n,
    tickUpper: 200000n,
    amount: 1000000000000000000n, // 1 token
    amount0: 500000000000000000n, // 0.5 token
    amount1: 300000000000000000n, // 0.3 token
    mockEventData: {
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      chainId: 10,
      logIndex: 1,
      srcAddress: toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      ),
      transaction: {
        hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      },
    },
  });

  const mockToken0: Token = {
    ...mockToken0Data,
    id: "token0_id",
    address: "0xtoken0",
    symbol: "TOKEN0",
    name: "Token 0",
    isWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  const mockToken1: Token = {
    ...mockToken1Data,
    id: "token1_id",
    address: "0xtoken1",
    symbol: "TOKEN1",
    name: "Token 1",
    decimals: 18n,
    pricePerUSDNew: 2000000000000000000n,
    isWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  describe("processCLPoolMint", () => {
    it("should process mint event successfully with valid data", () => {
      const result = processCLPoolMint(mockEvent, mockToken0, mockToken1);

      // Check liquidity pool diff with exact values
      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(
        500000000000000000n,
      ); // amount0 (0.5 token)
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(
        300000000000000000n,
      ); // amount1 (0.3 token)

      // Calculate exact totalLiquidityUSD: (0.5 * 1 USD) + (0.3 * 2 USD) = 0.5 + 0.6 = 1.1 USD
      expect(result.liquidityPoolDiff.incrementalCurrentLiquidityUSD).toBe(
        1100000000000000000n,
      ); // 1.1 USD in 18 decimals
    });

    it("should calculate correct liquidity values for mint event", () => {
      const result = processCLPoolMint(mockEvent, mockToken0, mockToken1);

      // The liquidity pool diff should reflect the amounts being added with exact values
      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(
        500000000000000000n,
      ); // amount0
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(
        300000000000000000n,
      ); // amount1
      expect(result.liquidityPoolDiff.incrementalCurrentLiquidityUSD).toBe(
        1100000000000000000n,
      ); // 1.1 USD in 18 decimals
    });

    it("should handle different token decimals correctly", () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n, // USDC-like token
      };

      const result = processCLPoolMint(
        mockEvent,
        tokenWithDifferentDecimals,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).toBeDefined();
    });

    it("should handle zero amounts correctly", () => {
      const eventWithZeroAmounts = CLPool.Mint.createMockEvent({
        owner: mockEvent.params.owner,
        tickLower: mockEvent.params.tickLower,
        tickUpper: mockEvent.params.tickUpper,
        amount: mockEvent.params.amount,
        amount0: 0n,
        amount1: 0n,
        mockEventData: {
          block: mockEvent.block,
          chainId: mockEvent.chainId,
          logIndex: mockEvent.logIndex,
          srcAddress: mockEvent.srcAddress,
          transaction: mockEvent.transaction,
        },
      });

      const result = processCLPoolMint(
        eventWithZeroAmounts,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalCurrentLiquidityUSD).toBe(0n);
    });
  });
});
