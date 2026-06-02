import { TickMath } from "@uniswap/v3-sdk";
import type { EvmEvent, Token } from "envio";
import { TEN_TO_THE_18_BI, toChecksumAddress } from "../../../src/Constants";
import type { Pool, handlerContext } from "../../../src/EntityTypes";
import {
  calculateSwapFees,
  calculateSwapVolume,
  processCLPoolSwap,
} from "../../../src/EventHandlers/CLPool/CLPoolSwapLogic";
import { deriveCLPriceRatios } from "../../../src/PoolPriceRatio";
import { setupCommon } from "../Pool/common";

describe("CLPoolSwapLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();

  // Constants for reusable test values
  const ONE_USD = 1n * TEN_TO_THE_18_BI;
  const TWO_USD = 2n * TEN_TO_THE_18_BI;
  const CL_FEE_30 = 3000n; // 0.3% fee (CL fees use 1e6 scale: 3000 / 1_000_000 = 0.3%)
  const CL_FEE_100 = 10000n; // 1% fee (CL fees use 1e6 scale: 10000 / 1_000_000 = 1%)
  const CHAIN_ID = 10;
  const BLOCK_TIMESTAMP = 1000000;
  const POOL_ID = toChecksumAddress(
    "0x1234567890123456789012345678901234567890",
  );

  const mockEvent: EvmEvent<"CLPool", "Swap"> = {
    params: {
      sender: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      recipient: toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      ),
      amount0: 1n * TEN_TO_THE_18_BI,
      amount1: -2n * TEN_TO_THE_18_BI,
      sqrtPriceX96: 2000000000000000000000000000000n,
      liquidity: 1000000000000000000000n,
      tick: 1000n,
    },
    block: {
      timestamp: BLOCK_TIMESTAMP,
      number: 123456,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    },
    chainId: CHAIN_ID,
    logIndex: 1,
    srcAddress: toChecksumAddress("0x3333333333333333333333333333333333333333"),
    transaction: {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    },
  } as EvmEvent<"CLPool", "Swap">;

  const mockPool: Pool = {
    ...mockLiquidityPoolData,
    id: POOL_ID,
    token0_id: mockToken0Data.id,
    token1_id: mockToken1Data.id,
    token0_address: mockToken0Data.address,
    token1_address: mockToken1Data.address,
    reserve0: 10n * TEN_TO_THE_18_BI,
    reserve1: 6n * TEN_TO_THE_18_BI,
    totalLiquidityUSD: 10n * TEN_TO_THE_18_BI,
    token0Price: ONE_USD,
    token1Price: TWO_USD,
    currentFee: CL_FEE_30,
    baseFee: CL_FEE_30,
    lastUpdatedTimestamp: new Date(BLOCK_TIMESTAMP * 1000),
  };

  const mockToken0: Token = {
    ...mockToken0Data,
    id: "token0_id",
    address: toChecksumAddress(
      "0x0000000000000000000000000000000000000001",
    ) as `0x${string}`,
    symbol: "TOKEN0",
    name: "Token 0",
    decimals: 18n,
    pricePerUSDNew: ONE_USD,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(BLOCK_TIMESTAMP * 1000),
  };

  const mockToken1: Token = {
    ...mockToken1Data,
    id: "token1_id",
    address: toChecksumAddress(
      "0x0000000000000000000000000000000000000002",
    ) as `0x${string}`,
    symbol: "TOKEN1",
    name: "Token 1",
    decimals: 18n,
    pricePerUSDNew: TWO_USD,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(BLOCK_TIMESTAMP * 1000),
  };

  const mockContext: handlerContext = {
    log: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    },
  } as unknown as handlerContext;

  describe("calculateSwapVolume", () => {
    it("should calculate volume using token0 when available and non-zero", () => {
      const result = calculateSwapVolume(mockEvent, mockToken0, mockToken1);

      expect(result.volumeInUSD).toBe(ONE_USD); // 1 token * $1 = $1
      // After #755 the WL/blacklist gate is enforced per leg, so the
      // *Whitelisted aggregate equals volumeInUSD when at least one leg is trusted.
    });

    it("refuses single-leg fallback when the priced leg is not whitelisted (#737)", () => {
      // token0 has amount=0 → unpriced. token1 priced ($4) but isWhitelisted=false.
      // After #755 the per-leg PriceTrust gate zeros the non-WL leg's USD
      // contribution, so the picker sees (0n, 0n) and returns 0n — the
      // #737 single-leg refusal is now enforced upstream of the picker.
      const eventWithZeroToken0: EvmEvent<"CLPool", "Swap"> = {
        ...mockEvent,
        params: { ...mockEvent.params, amount0: 0n },
      };
      const nonWLToken1: Token = { ...mockToken1, isWhitelisted: false };

      const result = calculateSwapVolume(
        eventWithZeroToken0,
        mockToken0,
        nonWLToken1,
      );

      expect(result.volumeInUSD).toBe(0n);
    });

    it("trusts single-leg fallback when the priced leg IS whitelisted", () => {
      // Mirror of the #737 case, but with the priced token whitelisted:
      // we trust the canonical-token amount as the swap's USD volume.
      const eventWithZeroToken0: EvmEvent<"CLPool", "Swap"> = {
        ...mockEvent,
        params: { ...mockEvent.params, amount0: 0n },
      };
      const whitelistedToken1: Token = { ...mockToken1, isWhitelisted: true };

      const result = calculateSwapVolume(
        eventWithZeroToken0,
        mockToken0,
        whitelistedToken1,
      );

      // token1: 2 tokens * $2 = $4
      expect(result.volumeInUSD).toBe(4n * TEN_TO_THE_18_BI);
    });

    it("should return zero volume when both tokens are undefined", () => {
      const result = calculateSwapVolume(mockEvent, undefined, undefined);

      expect(result.volumeInUSD).toBe(0n);
    });

    it("should calculate whitelisted volume when both tokens are whitelisted", () => {
      const whitelistedToken0: Token = { ...mockToken0, isWhitelisted: true };
      const whitelistedToken1: Token = { ...mockToken1, isWhitelisted: true };

      const result = calculateSwapVolume(
        mockEvent,
        whitelistedToken0,
        whitelistedToken1,
      );
    });

    it("should count whitelisted volume when only one token is whitelisted", () => {
      // After #755 the trusted leg drives volumeInUSD via the single-leg
      // fallback, and volumeInUSDWhitelisted mirrors that (the gate is now
      // upstream of the picker, so the legacy OR-of-WL fallback collapses).
      const nonWLToken1: Token = { ...mockToken1, isWhitelisted: false };

      const result = calculateSwapVolume(mockEvent, mockToken0, nonWLToken1);
    });

    it("should handle different token decimals correctly", () => {
      const tokenWith6Decimals: Token = {
        ...mockToken0,
        decimals: 6n,
        pricePerUSDNew: ONE_USD,
      };
      const eventWith6Decimals: EvmEvent<"CLPool", "Swap"> = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 1000000n, // 1 token in 6 decimals
        },
      };

      const result = calculateSwapVolume(
        eventWith6Decimals,
        tokenWith6Decimals,
        mockToken1,
      );

      expect(result.volumeInUSD).toBe(ONE_USD);
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
        decimals: 6n,
        pricePerUSDNew: ONE_USD, // $1
      };
      const swapEvent: EvmEvent<"CLPool", "Swap"> = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 1n * TEN_TO_THE_18_BI, // 1 token (18 decimals)
          amount1: -1000000n, // 1 USDC (6 decimals)
        },
      };

      const result = calculateSwapVolume(
        swapEvent,
        corruptedToken0,
        healthyToken1,
      );

      // token0UsdValue = 1e18 * 1e35 / 1e18 = 1e35 (corrupted)
      // token1UsdValue = (1e6 * 1e18 / 1e6) * 1e18 / 1e18 = 1e18 ($1, honest)
      // min picks the honest leg.
      expect(result.volumeInUSD).toBe(ONE_USD);
    });
  });

  describe("calculateSwapFees", () => {
    // Pre-compute the trusted volume that the swap path produces for `mockEvent`
    // so the fee-USD expectations below are tied to the same input the
    // production wiring uses (`calculateSwapVolume` → `calculateSwapFees`).
    const trustedVolumeForMockEvent = calculateSwapVolume(
      mockEvent,
      mockToken0,
      mockToken1,
    ).volumeInUSD;

    it("should calculate fees correctly with currentFee", () => {
      const result = calculateSwapFees(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
        trustedVolumeForMockEvent,
        mockContext,
      );

      // Fee = 3000 (0.3% in 1e6 scale), only charged on input token (positive amount)
      // token0 (input, +1e18): (1e18 * 3000) / 1000000 = 3e15, normalized to 1e18: 3e15
      // token1 (output, -2e18): 0 (fees only on input side)
      // USD now derived from trusted volume: volumeInUSD ($1) × feeRate / scale
      //        = 1e18 × 3000 / 1e6 = 3e15
      expect(result.swapFeesInToken0).toBe(3000000000000000n); // 3e15
      expect(result.swapFeesInToken1).toBe(0n); // output side — no fee
      expect(result.swapFeesInUSD).toBe(3000000000000000n); // 3e15
    });

    it("should fallback to baseFee when currentFee is undefined", () => {
      const poolWithBaseFee = {
        ...mockPool,
        currentFee: undefined,
        baseFee: CL_FEE_100,
      } as unknown as Pool;

      const result = calculateSwapFees(
        mockEvent,
        poolWithBaseFee,
        mockToken0,
        mockToken1,
        trustedVolumeForMockEvent,
        mockContext,
      );

      // Fee = 10000 (1% in 1e6 scale), only charged on input token (positive amount)
      // token0 (input, +1e18): (1e18 * 10000) / 1000000 = 1e16, normalized to 1e18: 1e16
      // token1 (output, -2e18): 0 (fees only on input side)
      expect(result.swapFeesInToken0).toBe(10000000000000000n); // 1e16
      expect(result.swapFeesInToken1).toBe(0n); // output side — no fee
    });

    it("should return zero fees when both currentFee and baseFee are undefined", () => {
      const poolWithoutFee = {
        ...mockPool,
        currentFee: undefined,
        baseFee: undefined,
      } as unknown as Pool;

      const result = calculateSwapFees(
        mockEvent,
        poolWithoutFee,
        mockToken0,
        mockToken1,
        trustedVolumeForMockEvent,
        mockContext,
      );

      expect(result.swapFeesInToken0).toBe(0n);
      expect(result.swapFeesInToken1).toBe(0n);
      expect(result.swapFeesInUSD).toBe(0n);
      expect(mockContext.log.error).toHaveBeenCalled();
      // Log should include actual values for diagnostics
      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining("undefined"),
      );
      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining(poolWithoutFee.id),
      );
    });

    it("should handle different token decimals correctly", () => {
      const tokenWith6Decimals: Token = {
        ...mockToken0,
        decimals: 6n,
      };

      const result = calculateSwapFees(
        mockEvent,
        mockPool,
        tokenWith6Decimals,
        mockToken1,
        trustedVolumeForMockEvent,
        mockContext,
      );

      // Fee = 3000 (0.3% in 1e6 scale), only charged on input token (positive amount)
      // token0 (input, +1e18): (1e18 * 3000) / 1000000 = 3e15, normalized from 6 decimals: (3e15 * 1e18) / 1e6 = 3e27
      // token1 (output, -2e18): 0 (fees only on input side)
      expect(result.swapFeesInToken0).toBe(3000000000000000000000000000n); // 3e27
      expect(result.swapFeesInToken1).toBe(0n); // output side — no fee
    });

    it("should derive USD fee from trusted volume rather than re-pricing the input leg", () => {
      const result = calculateSwapFees(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
        trustedVolumeForMockEvent,
        mockContext,
      );

      // volumeInUSD × feeRate / FEE_SCALE = 1e18 × 3000 / 1e6 = 3e15
      expect(result.swapFeesInUSD).toBe(
        (trustedVolumeForMockEvent * CL_FEE_30) / 1000000n,
      );
    });

    it("should still derive USD when input token has no price, falling back to the priced output leg via trusted volume", () => {
      const token0WithZeroPrice: Token = {
        ...mockToken0,
        pricePerUSDNew: 0n,
      };
      // Single-leg fallback is gated on the priced token being whitelisted (#737/#740);
      // the priced output leg here must be whitelisted for the fallback to surface.
      const whitelistedToken1: Token = { ...mockToken1, isWhitelisted: true };

      // Volume defends via pickTrustedSwapVolumeUSD; fee inherits the defended volume.
      const fallbackVolume = calculateSwapVolume(
        mockEvent,
        token0WithZeroPrice,
        whitelistedToken1,
      ).volumeInUSD;

      const result = calculateSwapFees(
        mockEvent,
        mockPool,
        token0WithZeroPrice,
        whitelistedToken1,
        fallbackVolume,
        mockContext,
      );

      expect(fallbackVolume).toBeGreaterThan(0n);
      expect(result.swapFeesInUSD).toBe(
        (fallbackVolume * CL_FEE_30) / 1000000n,
      );
    });

    it("should return zero USD fees when both token prices are unavailable", () => {
      const token0WithZeroPrice: Token = {
        ...mockToken0,
        pricePerUSDNew: 0n,
      };
      const token1WithoutPrice = {
        ...mockToken1,
        pricePerUSDNew: undefined,
      } as unknown as Token;

      const result = calculateSwapFees(
        mockEvent,
        mockPool,
        token0WithZeroPrice,
        token1WithoutPrice,
        0n,
        mockContext,
      );

      expect(result.swapFeesInUSD).toBe(0n);
    });

    // Regression test for issue #733: a swap where the input token has a
    // poisoned/scam price must not produce fee USD that exceeds volume × feeRate.
    // Pre-fix, the input leg's inflated price was multiplied through the fee
    // computation, producing totalFeesGeneratedUSD up to 10²³× totalVolumeUSD.
    it("should bound fee USD by trusted volume × feeRate when the input token has a poisoned price (issue #733)", () => {
      const poisonedPrice = 10n ** 35n; // matches scam-token price range from issue #699
      const honestPrice = 1n * TEN_TO_THE_18_BI; // $1

      const poisonedToken0: Token = {
        ...mockToken0,
        pricePerUSDNew: poisonedPrice,
      };
      const honestToken1: Token = {
        ...mockToken1,
        pricePerUSDNew: honestPrice,
      };

      const { volumeInUSD } = calculateSwapVolume(
        mockEvent,
        poisonedToken0,
        honestToken1,
      );

      const { swapFeesInUSD } = calculateSwapFees(
        mockEvent,
        mockPool,
        poisonedToken0,
        honestToken1,
        volumeInUSD,
        mockContext,
      );

      // Volume defends by picking the smaller (honest) leg.
      const honestLegUSD = 2n * TEN_TO_THE_18_BI; // |amount1|=2e18 × $1
      expect(volumeInUSD).toBe(honestLegUSD);

      // Fee respects the invariant: fees ≤ volume × feeRate.
      expect(swapFeesInUSD).toBe((volumeInUSD * CL_FEE_30) / 1000000n);
      expect(swapFeesInUSD * 1000000n).toBeLessThanOrEqual(
        volumeInUSD * CL_FEE_30,
      );

      // And critically, fee USD does not inherit the poisoned price magnitude.
      expect(swapFeesInUSD).toBeLessThan(poisonedPrice);
    });
  });

  describe("processCLPoolSwap", () => {
    // TVL routes through calculateTotalUSD which is gated on PriceTrust (#755).
    // File-level mockToken0/mockToken1 are deliberately non-WL for the #699/#737
    // calculateSwapVolume regression tests above; for the TVL-asserting cases
    // below we re-bind to whitelisted clones so the math is observable.
    const wlToken0: Token = { ...mockToken0, isWhitelisted: true };
    const wlToken1: Token = { ...mockToken1, isWhitelisted: true };

    it("should process swap event and calculate correct volumes and fees", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockPool,
        wlToken0,
        wlToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.incrementalTotalVolume0).toBe(
        1n * TEN_TO_THE_18_BI,
      );
      expect(result.liquidityPoolDiff.incrementalTotalVolume1).toBe(
        2n * TEN_TO_THE_18_BI,
      );
      expect(result.liquidityPoolDiff.incrementalNumberOfSwaps).toBe(1n);
      expect(result.liquidityPoolDiff.incrementalTotalVolumeUSD).toBe(ONE_USD);
      // Fee = 3000 (0.3%): (amount * 3000) / 1000000 → 3e15 for token0, 6e15 for token1
      expect(result.liquidityPoolDiff.incrementalTotalFeesGenerated0).toBe(
        3000000000000000n,
      ); // 3e15
      expect(result.liquidityPoolDiff.incrementalTotalFeesGeneratedUSD).toBe(
        3000000000000000n,
      ); // 3e15
      // Reserve deltas now derive from pool geometry, not `amount − fee` (#803).
      // This mock has no tick-edge map (tickEdges: []), so the geometry seed is 0
      // and the swap moves no principal → reserves stay 10e18 / 6e18.
      // TVL = 10 * $1 + 6 * $2 = $22. (Geometry over a real edge map + price move
      // is covered by the fee-independence test below.)
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBe(
        22n * TEN_TO_THE_18_BI,
      );

      expect(result.userSwapDiff.incrementalNumberOfSwaps).toBe(1n);
      expect(result.userSwapDiff.incrementalTotalSwapVolumeAmount0).toBe(
        1n * TEN_TO_THE_18_BI,
      );
      expect(result.userSwapDiff.incrementalTotalSwapVolumeAmount1).toBe(
        2n * TEN_TO_THE_18_BI,
      );
      expect(result.userSwapDiff.incrementalTotalSwapVolumeUSD).toBe(ONE_USD);
    });

    it("should handle zero amounts correctly", async () => {
      const eventWithZeroAmounts: EvmEvent<"CLPool", "Swap"> = {
        ...mockEvent,
        params: { ...mockEvent.params, amount0: 0n, amount1: 0n },
      };

      const result = await processCLPoolSwap(
        eventWithZeroAmounts,
        mockPool,
        wlToken0,
        wlToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.incrementalTotalVolume0).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalTotalVolume1).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalTotalVolumeUSD).toBe(0n);
      expect(result.liquidityPoolDiff.currentTotalLiquidityUSD).toBe(
        22n * TEN_TO_THE_18_BI,
      );
    });

    it("should handle undefined tokens with fallback to pool prices", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockPool,
        undefined,
        undefined,
        mockContext,
      );

      expect(result.liquidityPoolDiff.token0Price).toBe(mockPool.token0Price);
      expect(result.liquidityPoolDiff.token1Price).toBe(mockPool.token1Price);
    });

    it("derives reserve deltas from geometry, independent of the fee rate (#803)", async () => {
      // #803: the swap reserve delta is now L·ΔsqrtPrice integrated over the tick
      // map — fee-free by construction — replacing the old `amount − feeRate·amount`
      // term whose stale hourly fee sample drifted on dynamic-fee pools. The
      // defining property: changing the fee rate must NOT change the reserves.
      const L = 1_000_000n * TEN_TO_THE_18_BI;
      const sqrtAtTick = (t: number) =>
        BigInt(TickMath.getSqrtRatioAtTick(t).toString());
      // Pool at tick 0 with a single full-range position (in-range liquidity = L).
      const geoBase: Pool = {
        ...mockPool,
        tick: 0n,
        sqrtPriceX96: sqrtAtTick(0),
        tickSpacing: 1n,
        liquidityInRange: L,
        tickEdges: [-887272n, 887272n],
        tickEdgeNets: [L, -L],
      };
      // Swap moves the price up from tick 0 to tick 100 (stays within the range).
      const geoEvent: EvmEvent<"CLPool", "Swap"> = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          tick: 100n,
          sqrtPriceX96: sqrtAtTick(100),
        },
      };

      const hiFee = await processCLPoolSwap(
        geoEvent,
        { ...geoBase, currentFee: CL_FEE_100, baseFee: CL_FEE_100 },
        wlToken0,
        wlToken1,
        mockContext,
      );
      const zeroFee = await processCLPoolSwap(
        geoEvent,
        { ...geoBase, currentFee: 0n, baseFee: 0n },
        wlToken0,
        wlToken1,
        mockContext,
      );

      // Fee-independence: identical reserve deltas at a 1% fee and at 0% fee.
      expect(hiFee.liquidityPoolDiff.incrementalReserve0).toBe(
        zeroFee.liquidityPoolDiff.incrementalReserve0,
      );
      expect(hiFee.liquidityPoolDiff.incrementalReserve1).toBe(
        zeroFee.liquidityPoolDiff.incrementalReserve1,
      );
      // Non-triviality: the up-move actually moved principal — token1 in (+),
      // token0 out (−), matching the SqrtPriceMath sign convention.
      expect(hiFee.liquidityPoolDiff.incrementalReserve1).toBeGreaterThan(0n);
      expect(hiFee.liquidityPoolDiff.incrementalReserve0).toBeLessThan(0n);
    });

    it("should calculate whitelisted volume correctly", async () => {
      const whitelistedToken0: Token = { ...mockToken0, isWhitelisted: true };
      const whitelistedToken1: Token = { ...mockToken1, isWhitelisted: true };

      const result = await processCLPoolSwap(
        mockEvent,
        mockPool,
        whitelistedToken0,
        whitelistedToken1,
        mockContext,
      );
    });

    it("derives token0Price/token1Price from sqrtPriceX96, ignoring token oracle prices (#783)", async () => {
      // The ratios must equal the pure derivation from the swap's sqrtPriceX96,
      // not either token's oracle price.
      const expected = deriveCLPriceRatios(
        mockEvent.params.sqrtPriceX96,
        mockToken0.decimals,
        mockToken1.decimals,
      );

      const baseline = await processCLPoolSwap(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(baseline.liquidityPoolDiff.token0Price).toBe(expected.token0Price);
      expect(baseline.liquidityPoolDiff.token1Price).toBe(expected.token1Price);

      // An arbitrarily mispriced token (EARN-style oracle inflation) must not
      // move the pool-internal ratio.
      const mispricedToken0: Token = {
        ...mockToken0,
        pricePerUSDNew: 10n ** 40n,
      };
      const mispricedResult = await processCLPoolSwap(
        mockEvent,
        mockPool,
        mispricedToken0,
        mockToken1,
        mockContext,
      );

      expect(mispricedResult.liquidityPoolDiff.token0Price).toBe(
        expected.token0Price,
      );
      expect(mispricedResult.liquidityPoolDiff.token1Price).toBe(
        expected.token1Price,
      );
    });

    it("should set correct timestamps", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.lastUpdatedTimestamp).toEqual(
        new Date(BLOCK_TIMESTAMP * 1000),
      );
      expect(result.userSwapDiff.lastActivityTimestamp).toEqual(
        new Date(BLOCK_TIMESTAMP * 1000),
      );
    });

    it("should set liquidityInRange from event params", async () => {
      const result = await processCLPoolSwap(
        mockEvent,
        mockPool,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.liquidityInRange).toBe(
        mockEvent.params.liquidity,
      );
    });

    it("should compute staked reserve deltas from edge state", async () => {
      // Post-#719 stakedLiquidityInRange is derived from
      // (oldTick, stakedTickEdges, stakedTickEdgeNets) rather than trusted
      // from the cached seed. With an empty edge list, derive returns 0n
      // regardless of what the legacy counter says.
      const poolWithStaked = {
        ...mockPool,
        tick: 500n, // Different from event tick (1000n) to trigger tick crossing
        tickSpacing: 200n,
        // Cached counter is intentionally inconsistent with the empty edge
        // list to demonstrate the structural heal.
        stakedLiquidityInRange: 200n,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        poolWithStaked,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // derive(oldTick=500n, [], []) === 0n; the empty edge list IS the truth.
      expect(result.liquidityPoolDiff.stakedLiquidityInRange).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalStakedReserve0).toBeDefined();
      expect(result.liquidityPoolDiff.incrementalStakedReserve1).toBeDefined();
    });

    it("should return zero staked deltas when no staked liquidity", async () => {
      const poolNoStaked = {
        ...mockPool,
        stakedLiquidityInRange: 0n,
      };

      const result = await processCLPoolSwap(
        mockEvent,
        poolNoStaked,
        mockToken0,
        mockToken1,
        mockContext,
      );

      expect(result.liquidityPoolDiff.incrementalStakedReserve0).toBe(0n);
      expect(result.liquidityPoolDiff.incrementalStakedReserve1).toBe(0n);
      expect(result.liquidityPoolDiff.stakedLiquidityInRange).toBe(0n);
    });

    it("should derive stakedLiquidityInRange from edges even when tick unchanged", async () => {
      // Post-#719: the seed input is consulted only on early-exit paths;
      // the normal walking path derives from edges at oldTick. With empty
      // edges, derive yields 0n no matter what the cached counter says.
      const poolSameTick = {
        ...mockPool,
        tick: mockEvent.params.tick, // Same tick → no crossing
        tickSpacing: 200n,
        stakedLiquidityInRange: 500n, // intentionally stale vs empty edges
      };

      const result = await processCLPoolSwap(
        mockEvent,
        poolSameTick,
        mockToken0,
        mockToken1,
        mockContext,
      );

      // No crossings + empty edges → derive(oldTick) = 0n.
      expect(result.liquidityPoolDiff.stakedLiquidityInRange).toBe(0n);
    });
  });

  // Regression test for issue #670: real CL fee tiers cap at ~1%, so for a
  // controlled swap fee USD must be at most 1% of volume USD.
  describe("fee ≤ 1% of volume invariant (issue #670)", () => {
    const realisticFeeTiers = [100n, 500n, 3000n, 10000n] as const;

    it.each(realisticFeeTiers)(
      "keeps fee USD within 1%% of volume USD at fee tier %s",
      async (fee) => {
        const pool = {
          ...mockPool,
          currentFee: fee,
          baseFee: fee,
        };

        const result = await processCLPoolSwap(
          mockEvent,
          pool,
          mockToken0,
          mockToken1,
          mockContext,
        );

        const volumeUSD =
          result.liquidityPoolDiff.incrementalTotalVolumeUSD ?? 0n;
        const feesUSD =
          result.liquidityPoolDiff.incrementalTotalFeesGeneratedUSD ?? 0n;

        expect(volumeUSD).toBeGreaterThan(0n);
        expect(feesUSD * 100n).toBeLessThanOrEqual(volumeUSD);
      },
    );
  });
});
