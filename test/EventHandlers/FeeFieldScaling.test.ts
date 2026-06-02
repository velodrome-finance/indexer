import type { EvmEvent, Token } from "envio";
import {
  FEE_SCALE,
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  toCanonicalFeeScale,
  toChecksumAddress,
} from "../../src/Constants";
import type { Pool, handlerContext } from "../../src/EntityTypes";
import { calculateSwapFees } from "../../src/EventHandlers/CLPool/CLPoolSwapLogic";
import { processPoolFees } from "../../src/EventHandlers/Pool/PoolFeesLogic";
import { setupCommon } from "./Pool/common";

/**
 * Issue #812: the same schema fields carried different scales depending on pool
 * type (V2 raw / bps vs CL 1e18-normalized / 1e6). These tests pin the unified
 * conventions so an equivalent fee reads identically across V2 and CL:
 *   - token-amount fee fields are 1e18-normalized on both paths
 *   - baseFee / currentFee share a single FEE_SCALE (1e6) divisor on both paths
 */
describe("Issue #812: fee-field scaling parity across V2 and CL", () => {
  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } =
    setupCommon();

  // token0 = 18 decimals, token1 = 6 decimals. Using the 6-decimal leg makes
  // the 1e18 normalization observable (raw 1e6 base != 1e18 base).
  const token18 = mockToken0Data as Token;
  const token6 = mockToken1Data as Token;

  const ctx = {
    log: { error: () => undefined, warn: () => undefined },
  } as unknown as handlerContext;

  // An economically identical fee: 0.50 of the 6-decimal token.
  const HALF_TOKEN6_RAW = 5n * (TEN_TO_THE_6_BI / 10n); // 0.50 * 1e6 = 500_000
  const EXPECTED_1E18 = 5n * 10n ** 17n; // 0.50 normalized to a 1e18 base

  const v2FeesEvent = {
    params: { amount0: 0n, amount1: HALF_TOKEN6_RAW },
    block: {
      timestamp: 1_000_000,
      number: 1,
      hash: `0x${"0".repeat(64)}`,
    },
    chainId: 10,
    srcAddress: toChecksumAddress("0x3333333333333333333333333333333333333333"),
  } as unknown as EvmEvent<"Pool", "Fees">;

  // 1000 of the 6-decimal token swapped IN at 0.05% (500 / 1e6) => 0.50 fee.
  const clPool: Pool = {
    ...mockLiquidityPoolData,
    currentFee: 500n,
    baseFee: 500n,
  };
  const clSwapEvent = {
    params: {
      amount0: -1n * TEN_TO_THE_18_BI, // output leg — not fee-charged
      amount1: 1000n * TEN_TO_THE_6_BI, // input leg — 1000 of the 6-decimal token
      sqrtPriceX96: 0n,
      liquidity: 0n,
      tick: 0n,
      sender: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      recipient: toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      ),
    },
    block: {
      timestamp: 1_000_000,
      number: 1,
      hash: `0x${"0".repeat(64)}`,
    },
    chainId: 10,
    srcAddress: toChecksumAddress("0x3333333333333333333333333333333333333333"),
  } as unknown as EvmEvent<"CLPool", "Swap">;

  describe("token-amount fee fields are 1e18-normalized on both paths", () => {
    it("V2 processPoolFees normalizes the 6-decimal leg to a 1e18 base", () => {
      const { liquidityPoolDiff, userDiff } = processPoolFees(
        v2FeesEvent,
        token18,
        token6,
      );
      expect(liquidityPoolDiff?.incrementalTotalFeesGenerated1).toBe(
        EXPECTED_1E18,
      );
      expect(userDiff?.incrementalTotalFeesContributed1).toBe(EXPECTED_1E18);
    });

    it("CL calculateSwapFees normalizes the 6-decimal leg to a 1e18 base", () => {
      const { swapFeesInToken1 } = calculateSwapFees(
        clSwapEvent,
        clPool,
        token18,
        token6,
        0n,
        ctx,
      );
      expect(swapFeesInToken1).toBe(EXPECTED_1E18);
    });

    it("V2 and CL store the SAME amount for an equivalent fee", () => {
      const v2 = processPoolFees(v2FeesEvent, token18, token6).liquidityPoolDiff
        ?.incrementalTotalFeesGenerated1;
      const cl = calculateSwapFees(
        clSwapEvent,
        clPool,
        token18,
        token6,
        0n,
        ctx,
      ).swapFeesInToken1;
      expect(v2).toBe(cl);
    });
  });

  describe("baseFee/currentFee share a single FEE_SCALE divisor", () => {
    it("FEE_SCALE is the 1e6 (hundredths-of-a-bp) scale", () => {
      expect(FEE_SCALE).toBe(1_000_000n);
    });

    it("V2 bps and CL 1e6 representations of 0.30% canonicalize equally", () => {
      const v2_030 = toCanonicalFeeScale(30n, false); // V2 on-chain basis points
      const cl_030 = toCanonicalFeeScale(3000n, true); // CL on-chain 1e6
      expect(v2_030).toBe(3000n);
      expect(cl_030).toBe(3000n);
      expect(v2_030).toBe(cl_030);
    });

    it("the single FEE_SCALE divisor recovers identical fractions", () => {
      // 0.30% on both => identical (value * 1e6 / FEE_SCALE) integer ratio
      const v2 = toCanonicalFeeScale(30n, false);
      const cl = toCanonicalFeeScale(3000n, true);
      expect((v2 * 1_000_000n) / FEE_SCALE).toBe((cl * 1_000_000n) / FEE_SCALE);
    });
  });
});
