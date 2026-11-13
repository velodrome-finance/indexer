import {
  DEFAULT_SAMM_FEE_BPS,
  DEFAULT_VAMM_FEE_BPS,
  FeeToTickSpacingMappingId,
  toCanonicalFeeScale,
} from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { Pool, handlerContext } from "../../EntityTypes";

/**
 * Custom-fee value meaning "this pool pays no fee" on the V2 `PoolFactory`,
 * the CL `CustomSwapFeeModule` and the CL `DynamicSwapFeeModule`
 * (`ZERO_FEE_INDICATOR()` returns 420 on all of them). A stored custom fee of
 * 0 means "no override, use the default". Confirmed on Base and Optimism by
 * `scripts/verify-fee-sentinels.ts`: with the pool's `customFee` slot
 * overridden, `getFee` returns 0 for 420 and the factory default for 0.
 */
export const ZERO_FEE_INDICATOR = 420n;

/**
 * Resolves a raw custom swap fee, as emitted by `PoolFactory.SetCustomFee`,
 * `CustomSwapFeeModule.SetCustomFee` or `DynamicSwapFeeModule.CustomFeeSet`,
 * into the fee the contract actually charges, in FEE_SCALE (1e6).
 *
 *   - 420 (`ZERO_FEE_INDICATOR`) → 0.
 *   - 0 → the default: V2 the factory's stable / volatile fee
 *     (`DEFAULT_SAMM_FEE_BPS` / `DEFAULT_VAMM_FEE_BPS`, the same defaults
 *     PoolCreated stamps); CL the chain's `FeeToTickSpacingMapping` fee for the
 *     pool's tick spacing (`tickSpacingToFee`).
 *   - anything else → the value, lifted to FEE_SCALE (`toCanonicalFeeScale`).
 *
 * For a dynamic-fee pool the result is the base fee; the module adds a
 * TWAP-volatility part on top, which the CL Swap handler measures per swap.
 *
 * @param rawFee - Fee value from the event (V2 basis points, CL 1e6)
 * @param pool - Pool the fee applies to (stability, tick spacing)
 * @param isCLFee - Whether the emitter is a CL fee module (raw value already in
 *   1e6, default = tick-spacing fee) rather than the V2 factory (basis points,
 *   default = stable/volatile fee). `PoolFactory` passes false,
 *   `CustomSwapFeeModule` passes `pool.isCL`, `DynamicSwapFeeModule` (CL-only)
 *   passes true
 * @param context - Handler context, used to read the tick-spacing default
 * @returns The charged fee in FEE_SCALE, or undefined when the CL default for
 *   0 cannot be resolved (no `FeeToTickSpacingMapping`); the caller then keeps
 *   the pool's previous fee
 */
export async function resolveCustomSwapFee(
  rawFee: bigint,
  pool: Pool,
  isCLFee: boolean,
  context: handlerContext,
): Promise<bigint | undefined> {
  if (rawFee === ZERO_FEE_INDICATOR) {
    return 0n;
  }
  if (rawFee !== 0n) {
    return toCanonicalFeeScale(rawFee, isCLFee);
  }
  if (!isCLFee) {
    return toCanonicalFeeScale(
      pool.isStable ? DEFAULT_SAMM_FEE_BPS : DEFAULT_VAMM_FEE_BPS,
      false,
    );
  }
  const mapping = await getRehydrated(
    context.FeeToTickSpacingMapping,
    "FeeToTickSpacingMapping",
    FeeToTickSpacingMappingId(pool.chainId, pool.tickSpacing),
  );
  if (!mapping) {
    context.log.warn(
      `[resolveCustomSwapFee] Custom fee reset to default for pool ${pool.poolAddress} on chain ${pool.chainId}, but no FeeToTickSpacingMapping exists for tick spacing ${pool.tickSpacing}; keeping the previous fee.`,
    );
    return undefined;
  }
  return mapping.fee;
}
