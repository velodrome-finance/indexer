import type { EvmEvent, Token } from "envio";
import {
  TEN_TO_THE_18_BI,
  TokenId,
  toChecksumAddress,
} from "../../../src/Constants";
import type { Pool } from "../../../src/EntityTypes";
import { processCLPoolMint } from "../../../src/EventHandlers/CLPool/CLPoolMintLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolMintLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();

  const mockEvent = {
    params: {
      sender: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      owner: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      tickLower: 100000n,
      tickUpper: 200000n,
      amount: 1000000000000000000n, // 1 token
      amount0: 500000000000000000n, // 0.5 token
      amount1: 300000000000000000n, // 0.3 token
    },
    block: {
      timestamp: 1000000,
      number: 123456,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    },
    chainId: 10,
    logIndex: 1,
    srcAddress: toChecksumAddress("0x3333333333333333333333333333333333333333"),
    transaction: {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    },
  } as unknown as EvmEvent<"CLPool", "Mint">;

  const mockToken0: Token = {
    ...mockToken0Data,
    id: "token0_id",
    address: "0xtoken0",
    symbol: "TOKEN0",
    name: "Token 0",
    isWhitelisted: true,
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
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  const mockPool = {
    ...mockLiquidityPoolData,
    reserve0: 1000000000000000000n,
    reserve1: 2000000000000000000n,
    totalLiquidityUSD: 5000000000000000000n,
  } as Pool;

  describe("processCLPoolMint", () => {
    it("should process mint event successfully with valid data", () => {
      const result = processCLPoolMint(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
      );

      // Check liquidity pool diff with exact values
      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(
        500000000000000000n,
      ); // amount0 (0.5 token)
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(
        300000000000000000n,
      ); // amount1 (0.3 token)

      // Post-mint reserves: token0 = 1.5, token1 = 2.3 -> TVL = 1.5 + 4.6 = 6.1 USD
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBe(
        6100000000000000000n,
      );
    });

    it("should calculate correct liquidity values for mint event", () => {
      const result = processCLPoolMint(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
      );

      // The liquidity pool diff should reflect the amounts being added with exact values
      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(
        500000000000000000n,
      ); // amount0
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(
        300000000000000000n,
      ); // amount1
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBe(
        6100000000000000000n,
      );
    });

    it("should handle different token decimals correctly", () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n, // USDC-like token
      };

      const result = processCLPoolMint(
        mockEvent,
        mockPool,
        tokenWithDifferentDecimals,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).toBeDefined();
    });

    it("should handle zero amounts correctly", () => {
      const eventWithZeroAmounts = {
        params: {
          sender: mockEvent.params.sender,
          owner: mockEvent.params.owner,
          tickLower: mockEvent.params.tickLower,
          tickUpper: mockEvent.params.tickUpper,
          amount: mockEvent.params.amount,
          amount0: 0n,
          amount1: 0n,
        },
        block: mockEvent.block,
        chainId: mockEvent.chainId,
        logIndex: mockEvent.logIndex,
        srcAddress: mockEvent.srcAddress,
        transaction: mockEvent.transaction,
      } as unknown as EvmEvent<"CLPool", "Mint">;

      const result = processCLPoolMint(
        eventWithZeroAmounts,
        mockPool,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff.incrementalReserve0).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalReserve1).toBe(0n);
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBe(
        5000000000000000000n,
      );
    });

    it("should increment liquidityInRange when tickLower <= aggregator.tick < tickUpper (in-range)", () => {
      // mockEvent uses tickLower=100000, tickUpper=200000.
      // Place aggregator.tick mid-range so the position contributes its full L.
      const inRangeAggregator = {
        ...mockPool,
        tick: 150000n,
        liquidityInRange: 7_000_000_000n,
      } as Pool;

      const result = processCLPoolMint(
        mockEvent,
        inRangeAggregator,
        mockToken0,
        mockToken1,
      );

      // event.params.amount = 1e18 — full L contribution
      expect(result.liquidityPoolDiff.incrementalLiquidityInRange).toBe(
        1000000000000000000n,
      );
      // Swap-authoritative replace must NOT be set on Mint
      expect(result.liquidityPoolDiff.liquidityInRange).toBeUndefined();
    });

    it("should not touch liquidityInRange when position is out of range (tick below tickLower)", () => {
      // Default mockPool.tick = 0n, tickLower = 100000n → below.
      const result = processCLPoolMint(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
      );

      expect(
        result.liquidityPoolDiff.incrementalLiquidityInRange,
      ).toBeUndefined();
      expect(result.liquidityPoolDiff.liquidityInRange).toBeUndefined();
    });

    it("should not touch liquidityInRange when position is out of range (tick at or above tickUpper)", () => {
      // tickUpper is exclusive: tick === tickUpper means out-of-range above.
      const aboveAggregator = {
        ...mockPool,
        tick: 200000n,
      } as Pool;

      const result = processCLPoolMint(
        mockEvent,
        aboveAggregator,
        mockToken0,
        mockToken1,
      );

      expect(
        result.liquidityPoolDiff.incrementalLiquidityInRange,
      ).toBeUndefined();
    });

    it("should include the boundary at tickLower (inclusive)", () => {
      const atLowerAggregator = {
        ...mockPool,
        tick: 100000n,
      } as Pool;

      const result = processCLPoolMint(
        mockEvent,
        atLowerAggregator,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff.incrementalLiquidityInRange).toBe(
        1000000000000000000n,
      );
    });

    it("caps TVL against a stablecoin anchor on a Base LFI/USDC pool (issue #892)", () => {
      const BASE = 8453;
      const LFI = toChecksumAddress(
        "0x3722264aB15a1dfCe5a5af89e6547F7949A8ABA3",
      );
      const USDC = toChecksumAddress(
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      );

      const lfiToken: Token = {
        ...mockToken0Data,
        id: TokenId(BASE, LFI),
        address: LFI as `0x${string}`,
        symbol: "LFI",
        name: "LFI",
        chainId: BASE,
        decimals: 18n,
        pricePerUSDNew: 24n * TEN_TO_THE_18_BI, // poisoned oracle ~$24
        isWhitelisted: true,
      };
      const usdcToken: Token = {
        ...mockToken1Data,
        id: TokenId(BASE, USDC),
        address: USDC as `0x${string}`,
        symbol: "USDC",
        name: "USD Coin",
        chainId: BASE,
        decimals: 6n,
        pricePerUSDNew: 1n * TEN_TO_THE_18_BI,
        isWhitelisted: true,
      };

      // CL pool carries the stored ratio (Mint does not move the price); the
      // ratio implies LFI ≈ $0.00006 against the $1 USDC anchor.
      const basePool = {
        ...mockLiquidityPoolData,
        chainId: BASE,
        isCL: true,
        token0_id: TokenId(BASE, LFI),
        token1_id: TokenId(BASE, USDC),
        reserve0: 1_000_000_000n * TEN_TO_THE_18_BI, // 1e9 LFI
        reserve1: 4_000n * 1_000_000n, // $4,000 USDC (≥ floor)
        token0Price: 60_000_000_000_000n, // 6e13 → implies LFI = $0.00006
        token1Price: 16_000_000_000_000_000_000_000n,
      } as Pool;

      // Zero-amount mint: reserves stay put so the assertion targets the cap.
      const zeroMint = {
        params: {
          sender: toChecksumAddress(
            "0x1111111111111111111111111111111111111111",
          ),
          owner: toChecksumAddress(
            "0x1111111111111111111111111111111111111111",
          ),
          tickLower: -100n,
          tickUpper: 100n,
          amount: 0n,
          amount0: 0n,
          amount1: 0n,
        },
        block: { timestamp: 1000000, number: 123456, hash: "0xfeed" },
        chainId: BASE,
        logIndex: 1,
        srcAddress: toChecksumAddress(
          "0x8343C68279587498526114e6385F0a87f248E0D9",
        ),
        transaction: { hash: "0xbeef" },
      } as unknown as EvmEvent<"CLPool", "Mint">;

      const result = processCLPoolMint(zeroMint, basePool, lfiToken, usdcToken);

      // LFI leg capped to implied $60,000; USDC leg $4,000 → $64,000 total.
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBe(
        64_000n * TEN_TO_THE_18_BI,
      );
    });
  });
});
