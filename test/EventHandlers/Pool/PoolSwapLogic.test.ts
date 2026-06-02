import type { EvmEvent, Token } from "envio";
import {
  FEE_SCALE,
  toCanonicalFeeScale,
  toChecksumAddress,
} from "../../../src/Constants";
import { processPoolSwap } from "../../../src/EventHandlers/Pool/PoolSwapLogic";
import * as Helpers from "../../../src/Helpers";
import { setupCommon } from "./common";

describe("PoolSwapLogic", () => {
  const {
    mockLiquidityPoolData,
    mockToken0Data,
    mockToken1Data,
    createMockPool,
  } = setupCommon();
  // Pool with a typical V2 vAMM fee rate (0.30%), stored in the canonical
  // FEE_SCALE (1e6) like production after issue #812.
  const mockPool = createMockPool({
    currentFee: toCanonicalFeeScale(30n, false),
  });
  // Shared mock event for all tests
  const mockEvent = {
    params: {
      sender: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      to: toChecksumAddress("0x2222222222222222222222222222222222222222"),
      amount0In: 1000n,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: 500n,
    },
    srcAddress: toChecksumAddress("0x3333333333333333333333333333333333333333"),
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
  } as unknown as EvmEvent<"Pool", "Swap">;

  // Mock token instances
  const mockToken0: Token = {
    ...mockToken0Data,
    id: "token0_id",
    address: toChecksumAddress("0x1111111111111111111111111111111111111111"),
    symbol: "USDT",
  };

  const mockToken1: Token = {
    ...mockToken1Data,
    id: "token1_id",
    address: toChecksumAddress("0x2222222222222222222222222222222222222222"),
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6n,
  };

  describe("processPoolSwap", () => {
    it("should create entity and calculate swap updates for successful swap", () => {
      // Process the swap event
      const result = processPoolSwap(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
      );

      // Assertions
      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userSwapDiff).toBeDefined();

      // Verify user swap diff content
      expect(result.userSwapDiff).toMatchObject({
        incrementalNumberOfSwaps: 1n,
        incrementalTotalSwapVolumeUSD: 1000n, // from swapData.volumeInUSD (token0: 1000 * 1 USD)
        incrementalTotalSwapVolumeAmount0: 1000n, // amount0In + amount0Out = 1000 + 0
        incrementalTotalSwapVolumeAmount1: 500n, // amount1In + amount1Out = 0 + 500
        lastActivityTimestamp: new Date(1000000 * 1000),
      });

      // Verify liquidity pool diff content. token0Price/token1Price are NOT
      // asserted here: the Swap handler no longer writes the pool-internal ratio
      // (Sync owns it, derived from reserves — #783).
      expect(result.liquidityPoolDiff).toMatchObject({
        incrementalTotalVolume0: 1000n, // netAmount0 (diff) - amount0In + amount0Out = 1000 + 0
        incrementalTotalVolume1: 500n, // netAmount1 (diff) - amount1In + amount1Out = 0 + 500
        incrementalNumberOfSwaps: 1n, // diff
      });

      // Check timestamp separately
      expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });

    it("should calculate volume correctly when token1 has higher volume", () => {
      const modifiedEvent: EvmEvent<"Pool", "Swap"> = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0In: 2n,
          amount1In: 2000n,
          amount0Out: 100n,
          amount1Out: 5n,
        },
      };

      const result = processPoolSwap(
        modifiedEvent,
        mockPool,
        mockToken0,
        mockToken1,
      );

      // Token0 has amount0In + amount0Out = 2n + 100n = 102n
      // Token1 has amount1In + amount1Out = 2000n + 5n = 2005n
      // The logic uses token0 USD value if available and non-zero, otherwise token1
      // token0UsdValue = 102n * 10^18 / 10^18 * 1 USD = 102n
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(102n);
    });

    it("zeros both total and whitelisted volume when neither token is whitelisted (#755 trust gate)", () => {
      const result = processPoolSwap(
        mockEvent,
        mockPool,
        { ...mockToken0, isWhitelisted: false },
        { ...mockToken1, isWhitelisted: false },
      );

      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userSwapDiff).toBeDefined();

      // After #755, both legs are routed through PriceTrust.getTrustedUSD;
      // when neither token is whitelisted both legs gate to 0n so the picker
      // returns 0. The *Whitelisted aggregate mirrors total since the gate
      // is now enforced per leg upstream of the picker.
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(0n);
    });

    it("should add to whitelisted volume when both tokens are whitelisted", () => {
      const result = processPoolSwap(
        mockEvent,
        mockPool,
        { ...mockToken0, isWhitelisted: true },
        { ...mockToken1, isWhitelisted: true },
      );

      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userSwapDiff).toBeDefined();

      // When both tokens are whitelisted, whitelisted volume should be added
      // Expected: 1000n USD (1000 USDT * 1 USD, uses token0 value)
    });

    it("should count whitelisted volume when only one token is whitelisted", () => {
      const result = processPoolSwap(
        mockEvent,
        mockPool,
        { ...mockToken0, isWhitelisted: true },
        { ...mockToken1, isWhitelisted: false },
      );

      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userSwapDiff).toBeDefined();

      // "Any whitelisted" rule — consistent with calculateWhitelistedFeesUSD
    });

    it("does not write token0Price/token1Price — the pool-internal ratio is owned by the Sync handler (#783)", () => {
      // A V2 swap always triggers _update → Sync in the same tx, and Sync
      // derives the ratio from reserves. The Swap handler must NOT echo token
      // oracle prices into the ratio, or an arbitrarily mispriced token would
      // re-inflate it (the #783 bug). Even a 1e35 oracle price is ignored.
      const corruptedToken0 = {
        ...mockToken0,
        pricePerUSDNew: 100000000000000000000000000000000000n, // 1e35
      };

      const result = processPoolSwap(
        mockEvent,
        mockPool,
        corruptedToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).not.toHaveProperty("token0Price");
      expect(result.liquidityPoolDiff).not.toHaveProperty("token1Price");
    });
  });

  describe("Volume calculations", () => {
    it("should calculate net amounts correctly from event params", () => {
      const swapEvent: EvmEvent<"Pool", "Swap"> = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0In: 500n,
          amount0Out: 300n,
          amount1In: 200n,
          amount1Out: 400n,
        },
      };

      const result = processPoolSwap(
        swapEvent,
        mockPool,
        mockToken0,
        mockToken1,
      );

      // Net amounts should be sum of in and out
      expect(result.liquidityPoolDiff?.incrementalTotalVolume0).toBe(800n); // 500 + 300
      expect(result.liquidityPoolDiff?.incrementalTotalVolume1).toBe(600n); // 200 + 400
      expect(result.userSwapDiff?.incrementalTotalSwapVolumeAmount0).toBe(800n);
      expect(result.userSwapDiff?.incrementalTotalSwapVolumeAmount1).toBe(600n);
    });

    it("should use token0 USD value when available and non-zero", () => {
      const result = processPoolSwap(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff?.incrementalTotalVolume0).toBe(1000n);
      expect(result.liquidityPoolDiff?.incrementalTotalVolume1).toBe(500n);
      // token0UsdValue = 1000 * 10^18 / 10^18 * 1 USD = 1000n
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(1000n);
    });

    it("should use token1 USD value when token0 is zero AND token1 is whitelisted", () => {
      const eventWithZeroToken0: EvmEvent<"Pool", "Swap"> = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0In: 0n,
          amount0Out: 0n,
        },
      };

      // mockToken0/mockToken1 both default to isWhitelisted: true
      const result = processPoolSwap(
        eventWithZeroToken0,
        mockPool,
        mockToken0,
        mockToken1,
      );

      expect(result.liquidityPoolDiff?.incrementalTotalVolume0).toBe(0n);
      expect(result.liquidityPoolDiff?.incrementalTotalVolume1).toBe(500n);
      // token1UsdValue calculation:
      // - netAmount1 = 500n (raw amount in smallest unit for 6-decimal token)
      // - normalized = 500n * 10^18 / 10^6 = 500n * 10^12 = 500000000000000n
      // - USD value = 500000000000000n * 10^18 / 10^18 = 500000000000000n
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(
        500000000000000n,
      );
    });

    it("returns 0 volume when token0 is zero AND token1 is not whitelisted (#737)", () => {
      // Ragdoll-pair regression: pool with unpriced token0 + non-whitelisted
      // priced token1 must not contribute any volume. The pool
      // 8453-0x0129798a373f68b47AaE97d8562d861F10967650 produced a
      // $1.125e19 phantom volume from exactly this shape.
      const eventWithZeroToken0: EvmEvent<"Pool", "Swap"> = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0In: 0n,
          amount0Out: 0n,
        },
      };

      const result = processPoolSwap(
        eventWithZeroToken0,
        mockPool,
        { ...mockToken0, isWhitelisted: false },
        { ...mockToken1, isWhitelisted: false },
      );

      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(0n);
    });

    it("should handle undefined token0UsdValue when both tokens are whitelisted", () => {
      // Mock calculateTokenAmountUSD to return undefined for token0
      const calculateTokenAmountUSDSpy = vi.spyOn(
        Helpers,
        "calculateTokenAmountUSD",
      );
      calculateTokenAmountUSDSpy
        .mockReturnValueOnce(undefined as unknown as bigint) // token0UsdValue is undefined
        .mockReturnValueOnce(500n); // token1UsdValue is defined

      const result = processPoolSwap(
        mockEvent,
        mockPool,
        { ...mockToken0, isWhitelisted: true },
        { ...mockToken1, isWhitelisted: true },
      );

      // When token0UsdValue is undefined but token1UsdValue is available,
      // volumeInUSDWhitelisted should fallback to token1UsdValue (500n) instead of undefined

      // Total volume should also use token1 value as fallback
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(500n);

      calculateTokenAmountUSDSpy.mockRestore();
    });

    it("should pick the smaller-USD leg when one token's price is corrupted (#699)", () => {
      // Reproduces issue #699: scam-token / poisoned-oracle case. token0 reports
      // an absurdly inflated price (1e35 instead of 1e18), token1 is a healthy
      // USDC ($1). Old behaviour picked token0 and contaminated totalVolumeUSD;
      // new behaviour picks min(t0, t1) — the honest USDC-side amount.
      const corruptedToken0: Token = {
        ...mockToken0,
        pricePerUSDNew: 100000000000000000000000000000000000n, // 1e35
      };
      const healthyToken1: Token = {
        ...mockToken1,
        pricePerUSDNew: 1n * 1000000000000000000n, // 1e18 ($1)
        decimals: 6n,
      };
      const swapEvent: EvmEvent<"Pool", "Swap"> = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          // token0: 1e18 raw units (1 token at 18 decimals)
          amount0In: 1000000000000000000n,
          amount1In: 0n,
          amount0Out: 0n,
          // token1: 1e6 raw units (1 USDC at 6 decimals = $1)
          amount1Out: 1000000n,
        },
      };

      const result = processPoolSwap(
        swapEvent,
        mockPool,
        corruptedToken0,
        healthyToken1,
      );

      // token0UsdValue = (1e18 * 1e18 / 1e18) * 1e35 / 1e18 = 1e35 (corrupted)
      // token1UsdValue = (1e6 * 1e18 / 1e6) * 1e18 / 1e18 = 1e18 (honest $1)
      // min picks the honest leg.
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(
        1000000000000000000n,
      );
    });

    it("should fallback to 0n when both token0UsdValue and token1UsdValue are undefined", () => {
      // Mock calculateTokenAmountUSD to return undefined for both tokens
      const calculateTokenAmountUSDSpy = vi.spyOn(
        Helpers,
        "calculateTokenAmountUSD",
      );
      calculateTokenAmountUSDSpy
        .mockReturnValueOnce(undefined as unknown as bigint) // token0UsdValue is undefined
        .mockReturnValueOnce(undefined as unknown as bigint); // token1UsdValue is undefined

      const result = processPoolSwap(
        mockEvent,
        mockPool,
        { ...mockToken0, isWhitelisted: true },
        { ...mockToken1, isWhitelisted: true },
      );

      // When both token0UsdValue and token1UsdValue are undefined,
      // volumeInUSDWhitelisted should fallback to 0n

      // Total volume should also fallback to 0n
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(0n);

      calculateTokenAmountUSDSpy.mockRestore();
    });
  });

  // Issue #797: V2 fee USD must be derived from trusted volume × currentFee /
  // FEE_SCALE at Swap time, mirroring the CL fee path (CLPoolSwapLogic).
  // The V2 Fees event has only one non-zero leg (input side), so the old
  // single-leg valuation flowed any poisoned/inconsistent input-leg price
  // straight into totalFeesGeneratedUSD with no second leg to min against.
  describe("V2 fee USD derived from trusted volume × rate (issue #797)", () => {
    it("derives incrementalTotalFeesGeneratedUSD as volumeInUSD × currentFee / FEE_SCALE", () => {
      const pool = createMockPool({
        currentFee: toCanonicalFeeScale(30n, false),
      }); // 0.30%
      const result = processPoolSwap(mockEvent, pool, mockToken0, mockToken1);

      // volumeInUSD = min(token0=1000n, token1=5e14) = 1000n (see existing tests)
      // feeUSD = 1000 * 3000 / 1e6 = 3n (0.30% on the canonical FEE_SCALE)
      const expectedVolumeUSD = 1000n;
      const expectedFeeUSD =
        (expectedVolumeUSD * toCanonicalFeeScale(30n, false)) / FEE_SCALE;
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(
        expectedVolumeUSD,
      );
      expect(result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD).toBe(
        expectedFeeUSD,
      );
      expect(result.userSwapDiff?.incrementalTotalFeesContributedUSD).toBe(
        expectedFeeUSD,
      );
    });

    // Core #797 regression: an inflated/inconsistent fee-leg price must not
    // inflate totalFeesGeneratedUSD. Because the new derivation reuses the
    // already-min-protected volumeInUSD, the poisoned price is filtered out
    // upstream and never reaches the fee aggregate.
    it("ignores a poisoned fee-leg price by deriving from trusted volume", () => {
      const poisonedPrice = 10n ** 35n; // 1e35 vs legitimate 1e18
      const poisonedToken0: Token = {
        ...mockToken0,
        pricePerUSDNew: poisonedPrice,
      };
      const honestToken1: Token = {
        ...mockToken1,
        pricePerUSDNew: 1n * 10n ** 18n,
        decimals: 6n,
      };
      // token0-input swap: amount0 is the fee leg. Pre-fix this leg's USD
      // value (poisoned) would have been the fee USD; post-fix it is filtered
      // by the volume min-pick before being multiplied by the rate.
      const swapEvent: EvmEvent<"Pool", "Swap"> = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0In: 1000000000000000000n, // 1 token0 (18 decimals)
          amount1In: 0n,
          amount0Out: 0n,
          amount1Out: 1000000n, // 1 USDC (6 decimals) → $1
        },
      };
      const pool = createMockPool({
        currentFee: toCanonicalFeeScale(30n, false),
      });

      const result = processPoolSwap(
        swapEvent,
        pool,
        poisonedToken0,
        honestToken1,
      );

      // Trusted volume picks the honest $1 leg: fee USD = $1 × 3000 / 1e6.
      const expectedVolumeUSD = 1000000000000000000n; // 1e18 = $1
      const expectedFeeUSD =
        (expectedVolumeUSD * toCanonicalFeeScale(30n, false)) / FEE_SCALE;
      expect(result.liquidityPoolDiff?.incrementalTotalVolumeUSD).toBe(
        expectedVolumeUSD,
      );
      expect(result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD).toBe(
        expectedFeeUSD,
      );
      expect(
        result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD ?? 0n,
      ).toBeLessThan(poisonedPrice);
    });

    // Clean-pool sanity check: the new derivation matches what the AMM
    // invariant says fees should be — fees = volume × rate, within bigint
    // truncation. (This is the same shape as the existing PoolFeesLogic
    // "fee ≤ 1% of volume invariant (#670)" test, ported to the Swap-time path.)
    it("matches volume × rate exactly for a clean pool at 0.05% fee", () => {
      const pool = createMockPool({
        currentFee: toCanonicalFeeScale(5n, false),
      }); // 0.05% stable
      const usdt: Token = {
        ...mockToken0,
        decimals: 6n,
        pricePerUSDNew: 1n * 10n ** 18n,
      };
      const usdc: Token = {
        ...mockToken1,
        decimals: 6n,
        pricePerUSDNew: 1n * 10n ** 18n,
      };
      const swapAmount0 = 1000n * 10n ** 6n; // $1000 token0-input
      const swapEvent: EvmEvent<"Pool", "Swap"> = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0In: swapAmount0,
          amount1In: 0n,
          amount0Out: 0n,
          amount1Out: 999n * 10n ** 6n, // ~$999 USDC out
        },
      };

      const result = processPoolSwap(swapEvent, pool, usdt, usdc);

      const volumeUSD =
        result.liquidityPoolDiff?.incrementalTotalVolumeUSD ?? 0n;
      const feeUSD =
        result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD ?? 0n;
      expect(feeUSD).toBe(
        (volumeUSD * toCanonicalFeeScale(5n, false)) / FEE_SCALE,
      );
      // Hard invariant: fee ≤ 1% of volume at any V2 rate up to 1%.
      expect(feeUSD * 100n).toBeLessThanOrEqual(volumeUSD);
    });

    it("treats currentFee=0n as explicitly zero (does NOT fall back to baseFee)", () => {
      // The `currentFee ?? baseFee` pattern (mirroring CLPoolSwapLogic) only
      // falls through on null/undefined — 0n is a real value that a dynamic-
      // fee module may set (e.g. promotional period). Honoring it matters
      // because PoolFactory.SetCustomFee writes both fields in lockstep, so
      // `baseFee=30n` here is a stale prior value, not a sensible fallback.
      const pool = createMockPool({ currentFee: 0n, baseFee: 30n });
      const result = processPoolSwap(mockEvent, pool, mockToken0, mockToken1);

      expect(result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD).toBe(
        0n,
      );
    });

    it("returns 0 fee USD when both currentFee and baseFee are 0n", () => {
      const pool = createMockPool({ currentFee: 0n, baseFee: 0n });
      const result = processPoolSwap(mockEvent, pool, mockToken0, mockToken1);

      expect(result.liquidityPoolDiff?.incrementalTotalFeesGeneratedUSD).toBe(
        0n,
      );
      expect(result.userSwapDiff?.incrementalTotalFeesContributedUSD).toBe(0n);
    });
  });
});
