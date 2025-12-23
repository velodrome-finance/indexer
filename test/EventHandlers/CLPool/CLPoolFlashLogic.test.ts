import type {
  CLPool_Flash_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { processCLPoolFlash } from "../../../src/EventHandlers/CLPool/CLPoolFlashLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolFlashLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
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
    ...mockLiquidityPoolData,
    id: "0x1234567890123456789012345678901234567890",
    token0_id: mockToken0Data.id,
    token1_id: mockToken1Data.id,
    token0_address: mockToken0Data.address,
    token1_address: mockToken1Data.address,
    isCL: true,
    reserve0: 10000000n,
    reserve1: 6000000n,
    totalLiquidityUSD: 10000000n,
    token0Price: 1000000000000000000n,
    token1Price: 2000000000000000000n,
    gaugeIsAlive: false,
    token0IsWhitelisted: false,
    token1IsWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
    lastSnapshotTimestamp: new Date(1000000 * 1000),
  };

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

  describe("processCLPoolFlash", () => {
    it("should process flash event successfully with valid data", () => {
      const result = processCLPoolFlash(mockEvent, mockToken0, mockToken1);

      // Check liquidity pool diff with exact values
      expect(result.liquidityPoolDiff.totalFlashLoanFees0).toBe(1000n); // paid0
      expect(result.liquidityPoolDiff.totalFlashLoanFees1).toBe(500n); // paid1
      expect(result.liquidityPoolDiff.numberOfFlashLoans).toBe(1n);

      // Calculate exact flash loan fees USD: (1000 * 1 USD) + (500 * 2 USD) = 1000 + 1000 = 2000 USD
      expect(result.liquidityPoolDiff.totalFlashLoanFeesUSD).toBe(2000n);

      // Calculate exact flash loan volume USD: (1000000 * 1 USD) + (500000 * 2 USD) = 1000000 + 1000000 = 2000000 USD
      expect(result.liquidityPoolDiff.totalFlashLoanVolumeUSD).toBe(2000000n);

      // Check user flash loan diff with exact values
      expect(result.userFlashLoanDiff.numberOfFlashLoans).toBe(1n);
      expect(result.userFlashLoanDiff.totalFlashLoanVolumeUSD).toBe(2000000n);
    });

    it("should calculate flash loan fees correctly", () => {
      const result = processCLPoolFlash(mockEvent, mockToken0, mockToken1);

      // Fees should be calculated based on paid amounts and token prices
      expect(result.liquidityPoolDiff.totalFlashLoanFees0).toBe(
        mockEvent.params.paid0,
      );
      expect(result.liquidityPoolDiff.totalFlashLoanFees1).toBe(
        mockEvent.params.paid1,
      );
      expect(result.liquidityPoolDiff.totalFlashLoanFeesUSD).toBe(2000n); // 2000 USD in 18 decimals
    });

    it("should calculate flash loan volume correctly", () => {
      const result = processCLPoolFlash(mockEvent, mockToken0, mockToken1);

      // Volume should be calculated based on borrowed amounts (not fees)
      expect(result.userFlashLoanDiff.totalFlashLoanVolumeUSD).toBe(2000000n); // 2M USD in 18 decimals
      expect(result.userFlashLoanDiff.numberOfFlashLoans).toBe(1n);
    });

    it("should handle zero amounts correctly", () => {
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

      const result = processCLPoolFlash(
        eventWithZeroAmounts,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff.totalFlashLoanFees0).toBe(0n);
      expect(result.liquidityPoolDiff.totalFlashLoanFees1).toBe(0n);
      expect(result.liquidityPoolDiff.totalFlashLoanFeesUSD).toBe(0n);
      expect(result.userFlashLoanDiff.totalFlashLoanVolumeUSD).toBe(0n);
    });

    it("should handle different token decimals correctly", () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n, // USDC-like token
      };

      const result = processCLPoolFlash(
        mockEvent,
        tokenWithDifferentDecimals,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).not.toBeUndefined();
      expect(result.userFlashLoanDiff).not.toBeUndefined();
    });

    it("should handle existing flash loan data correctly", () => {
      const result = processCLPoolFlash(mockEvent, mockToken0, mockToken1);

      expect(result.liquidityPoolDiff.totalFlashLoanFees0).toBe(
        mockEvent.params.paid0,
      );
      expect(result.liquidityPoolDiff.totalFlashLoanFees1).toBe(
        mockEvent.params.paid1,
      );
      expect(result.liquidityPoolDiff.numberOfFlashLoans).toBe(1n); // Just the diff
    });
  });
});
