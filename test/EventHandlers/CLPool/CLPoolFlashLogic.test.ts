import type { CLPool_Flash_event, Token } from "generated";
import { TEN_TO_THE_18_BI, toChecksumAddress } from "../../../src/Constants";
import { processCLPoolFlash } from "../../../src/EventHandlers/CLPool/CLPoolFlashLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolFlashLogic", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  const mockEvent = {
    chainId: 10,
    block: {
      number: 12345,
      timestamp: 1000000,
      hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
    },
    logIndex: 1,
    srcAddress: toChecksumAddress("0x1234567890123456789012345678901234567890"),
    transaction: {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    },
    params: {
      sender: toChecksumAddress("0xabcdef1234567890abcdef1234567890abcdef12"),
      recipient: toChecksumAddress(
        "0xabcdef1234567890abcdef1234567890abcdef12",
      ),
      amount0: 1000000n,
      amount1: 500000n,
      paid0: 1000n, // Fees paid
      paid1: 500n, // Fees paid
    },
  } satisfies Partial<CLPool_Flash_event> as unknown as CLPool_Flash_event;

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
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFees0).toBe(
        1000n,
      ); // paid0
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFees1).toBe(
        500n,
      ); // paid1
      expect(result.liquidityPoolDiff.incrementalNumberOfFlashLoans).toBe(1n);

      // Calculate exact flash loan fees USD: (1000 * 1 USD) + (500 * 2 USD) = 1000 + 1000 = 2000 USD
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFeesUSD).toBe(
        2000n,
      );

      // Calculate exact flash loan volume USD: (1000000 * 1 USD) + (500000 * 2 USD) = 1000000 + 1000000 = 2000000 USD
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanVolumeUSD).toBe(
        2000000n,
      );

      // Check user flash loan diff with exact values
      expect(result.userFlashLoanDiff.incrementalNumberOfFlashLoans).toBe(1n);
      expect(result.userFlashLoanDiff.incrementalTotalFlashLoanVolumeUSD).toBe(
        2000000n,
      );
    });

    it("should calculate flash loan fees correctly", () => {
      const result = processCLPoolFlash(mockEvent, mockToken0, mockToken1);

      // Fees should be calculated based on paid amounts and token prices
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFees0).toBe(
        mockEvent.params.paid0,
      );
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFees1).toBe(
        mockEvent.params.paid1,
      );
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFeesUSD).toBe(
        2000n,
      ); // 2000 USD in 18 decimals
    });

    it("should calculate flash loan volume correctly", () => {
      const result = processCLPoolFlash(mockEvent, mockToken0, mockToken1);

      // Volume should be calculated based on borrowed amounts (not fees)
      expect(result.userFlashLoanDiff.incrementalTotalFlashLoanVolumeUSD).toBe(
        2000000n,
      ); // 2M USD in 18 decimals
      expect(result.userFlashLoanDiff.incrementalNumberOfFlashLoans).toBe(1n);
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

      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFees0).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFees1).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFeesUSD).toBe(
        0n,
      );
      expect(result.userFlashLoanDiff.incrementalTotalFlashLoanVolumeUSD).toBe(
        0n,
      );
    });

    it("should handle different token decimals correctly", () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n, // USDC-like token (6 decimals vs token1 at 18)
      };

      const result = processCLPoolFlash(
        mockEvent,
        tokenWithDifferentDecimals,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userFlashLoanDiff).toBeDefined();

      // Raw fee amounts are passed through unchanged
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFees0).toBe(
        mockEvent.params.paid0,
      );
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFees1).toBe(
        mockEvent.params.paid1,
      );
      expect(result.liquidityPoolDiff.incrementalNumberOfFlashLoans).toBe(1n);

      // USD amounts use token decimals via calculateTotalUSD (normalize to 1e18 then multiply by price).
      // Token0 (6 dec): paid0=1000 → normalized 1000*1e18/1e6 = 1e15 → USD 1e15*1e18/1e18 = 1e15 (0.001 USD in fixed-point).
      // Token1 (18 dec): paid1=500 @ 2 USD → 500*2e18/1e18 = 1000.
      // Fees USD = 1e15 + 1000
      const expectedFeesUSD = 1000000000001000n;
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFeesUSD).toBe(
        expectedFeesUSD,
      );

      // Volume: token0 amount0=1000000 (6 dec) = 1 unit → 1e18 USD; token1 amount1=500000 (18 dec) @ 2 USD = 1000000
      // Total volume = 1e18 + 1000000
      const expectedVolumeUSD = TEN_TO_THE_18_BI + 1000000n;
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanVolumeUSD).toBe(
        expectedVolumeUSD,
      );
      expect(result.userFlashLoanDiff.incrementalTotalFlashLoanVolumeUSD).toBe(
        expectedVolumeUSD,
      );
      expect(result.userFlashLoanDiff.incrementalNumberOfFlashLoans).toBe(1n);
    });

    it("should handle existing flash loan data correctly", () => {
      const result = processCLPoolFlash(mockEvent, mockToken0, mockToken1);

      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFees0).toBe(
        mockEvent.params.paid0,
      );
      expect(result.liquidityPoolDiff.incrementalTotalFlashLoanFees1).toBe(
        mockEvent.params.paid1,
      );
      expect(result.liquidityPoolDiff.incrementalNumberOfFlashLoans).toBe(1n); // Just the diff
    });
  });
});
