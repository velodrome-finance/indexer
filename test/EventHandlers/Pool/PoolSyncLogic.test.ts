import type { EvmEvent, Token } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import type { Pool, handlerContext } from "../../../src/EntityTypes";
import { processPoolSync } from "../../../src/EventHandlers/Pool/PoolSyncLogic";
import { deriveV2PriceRatios } from "../../../src/PoolPriceRatio";
import { setupCommon } from "./common";

describe("PoolSyncLogic", () => {
  const { mockLiquidityPoolData } = setupCommon();

  const mockEvent = {
    chainId: 10,
    block: {
      number: 123456,
      timestamp: 1000000,
      hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
    },
    logIndex: 1,
    srcAddress: toChecksumAddress("0x3333333333333333333333333333333333333333"),
    transaction: {
      hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
    },
    params: {
      reserve0: 1000n,
      reserve1: 2000n,
    },
  } as unknown as EvmEvent<"Pool", "Sync">;

  const mockPool = {
    ...mockLiquidityPoolData,
    reserve0: 500n,
    reserve1: 1000n,
    totalLiquidityUSD: 2000n,
    token0Price: 1000000000000000000n, // 1 USD
    token1Price: 2000000000000000000n, // 2 USD
    numberOfSwaps: 10n,
    totalVolume0: 5000n,
    totalVolume1: 10000n,
    totalVolumeUSD: 15000n,
    totalUnstakedFeesCollected0: 100n,
    totalUnstakedFeesCollected1: 200n,
    totalUnstakedFeesCollectedUSD: 300n,
    totalEmissions: 1000n,
    totalEmissionsUSD: 2000n,
    totalVotesDeposited: 5000n,
    totalVotesDepositedUSD: 10000n,
    gaugeAddress: toChecksumAddress(
      "0x4444444444444444444444444444444444444444",
    ),
    gaugeIsAlive: true,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  } as Pool;

  const mockToken0 = {
    id: toChecksumAddress("0x2222222222222222222222222222222222222222"),
    address: toChecksumAddress("0x2222222222222222222222222222222222222222"),
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6n,
    pricePerUSDNew: 1000000000000000000n, // 1 USD
    isWhitelisted: true,
    chainId: 10,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  } as Token;

  const mockToken1 = {
    id: toChecksumAddress("0x3333333333333333333333333333333333333333"),
    address: toChecksumAddress("0x3333333333333333333333333333333333333333"),
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18n,
    pricePerUSDNew: 2000000000000000000n, // 2 USD
    isWhitelisted: true,
    chainId: 10,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  } as Token;

  const mockContext = {
    log: {
      error: () => {},
      warn: () => {},
      info: () => {},
    },
  } as unknown as handlerContext;

  describe("processPoolSync", () => {
    it("should create entity and calculate sync updates for successful sync", () => {
      const result = processPoolSync(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).toBeDefined();

      expect(result.liquidityPoolDiff).toMatchObject({
        incrementalReserve0: 500n, // 1000n - 500n (incremental change)
        incrementalReserve1: 1000n, // 2000n - 1000n (incremental change)
        // Derived from reserves (reserve0=1000 @6dp, reserve1=2000 @18dp), #783.
        token0Price: 2000000n,
        token1Price: 500000000000000000000000000000n,
      });
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });

    it("should calculate total liquidity USD correctly with both tokens", () => {
      const result = processPoolSync(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff?.currentTotalLiquidityUSD).toBe(
        1000000000004000n,
      );
    });

    it("should calculate total liquidity USD correctly with only token0", () => {
      const result = processPoolSync(
        mockEvent,
        mockPool,
        mockToken0,
        undefined,
      );

      expect(result.liquidityPoolDiff?.currentTotalLiquidityUSD).toBe(
        1000000000000000n,
      );
    });

    it("should calculate total liquidity USD correctly with only token1", () => {
      const result = processPoolSync(
        mockEvent,
        mockPool,
        undefined,
        mockToken1,
      );

      expect(result.liquidityPoolDiff?.currentTotalLiquidityUSD).toBe(4000n);
    });

    it("should leave totalLiquidityUSD unchanged when no tokens are available", () => {
      const result = processPoolSync(mockEvent, mockPool, undefined, undefined);

      // No tokens available: keep existing values (no change)
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBeUndefined();
    });

    it("should handle different token decimals correctly", () => {
      const mockToken0WithDifferentDecimals = {
        ...mockToken0,
        decimals: 8n, // Different decimals
      };

      const result = processPoolSync(
        mockEvent,
        mockPool,
        mockToken0WithDifferentDecimals,
        mockToken1,
      );

      expect(result.liquidityPoolDiff?.currentTotalLiquidityUSD).toBe(
        10000000004000n,
      );
    });

    it("should handle zero amounts correctly", () => {
      const mockEventWithZeroAmounts = {
        ...mockEvent,
        params: {
          reserve0: 0n,
          reserve1: 0n,
        },
      } as unknown as EvmEvent<"Pool", "Sync">;

      const result = processPoolSync(
        mockEventWithZeroAmounts,
        mockPool,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).toMatchObject({
        incrementalReserve0: -500n, // Set to zero: subtract current reserves
        incrementalReserve1: -1000n, // Set to zero: subtract current reserves
      });
      expect(result.liquidityPoolDiff?.currentTotalLiquidityUSD).toBe(0n);
    });

    it("should handle missing token instances gracefully", () => {
      const result = processPoolSync(mockEvent, mockPool, undefined, undefined);

      expect(result.liquidityPoolDiff).toBeDefined();

      // Should use existing prices from aggregator
      expect(result.liquidityPoolDiff).toMatchObject({
        token0Price: mockPool.token0Price,
        token1Price: mockPool.token1Price,
      });
    });

    it("derives token0Price/token1Price from reserves, ignoring token oracle prices (#783)", () => {
      // The ratios must equal the pure derivation from the synced reserves,
      // not either token's oracle price.
      const expected = deriveV2PriceRatios(
        mockEvent.params.reserve0,
        mockEvent.params.reserve1,
        mockToken0.decimals,
        mockToken1.decimals,
      );

      const baseline = processPoolSync(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
      );
      expect(baseline.liquidityPoolDiff.token0Price).toBe(expected.token0Price);
      expect(baseline.liquidityPoolDiff.token1Price).toBe(expected.token1Price);

      // An arbitrarily mispriced token (EARN-style oracle inflation) must not
      // move the pool-internal ratio.
      const mispricedResult = processPoolSync(
        mockEvent,
        mockPool,
        { ...mockToken0, pricePerUSDNew: 10n ** 40n },
        mockToken1,
      );
      expect(mispricedResult.liquidityPoolDiff.token0Price).toBe(
        expected.token0Price,
      );
      expect(mispricedResult.liquidityPoolDiff.token1Price).toBe(
        expected.token1Price,
      );
    });
  });
});
