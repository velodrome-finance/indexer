import {
  DEFAULT_SAMM_FEE_BPS,
  DEFAULT_VAMM_FEE_BPS,
  FeeToTickSpacingMappingId,
  PoolFactoryDefaultFeeId,
  chainIdOf,
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
 *   - 0 → the default: V2 the pool's factory's stable / volatile fee
 *     (`getV2DefaultFee`, the same default PoolCreated stamps); CL the pool's
 *     factory's `FeeToTickSpacingMapping` fee for its tick spacing
 *     (`tickSpacingToFee`).
 *
 * Also used for the V2 CustomFeeModules (leaf PoolFactory `feeModule()` and the
 * Aero stable / volatile modules), whose `ZERO_FEE_INDICATOR()` is 420 too.
 * The Aero CL DynamicSwapFeeHook has different sentinels: see
 * `resolveHookBaseFee` in DynamicSwapFeeHook.ts.
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
    return getV2DefaultFee(
      chainIdOf(pool),
      pool.factoryAddress,
      pool.isStable,
      context,
    );
  }
  return getTickSpacingDefaultFee(pool, context, "resolveCustomSwapFee");
}

/**
 * The default fee of a CL pool's tick spacing on the CLFactory that created it
 * (`tickSpacingToFee`, stored as `FeeToTickSpacingMapping` keyed by factory).
 *
 * @param pool - CL pool (uses `factoryAddress` and `tickSpacing`)
 * @param context - Handler context, used to read the mapping
 * @param caller - Log prefix of the caller
 * @returns The fee in FEE_SCALE, or undefined (with a warning) when the pool
 *   has no factory or the factory never enabled the tick spacing
 */
export async function getTickSpacingDefaultFee(
  pool: Pool,
  context: handlerContext,
  caller: string,
): Promise<bigint | undefined> {
  const mapping = pool.factoryAddress
    ? await getRehydrated(
        context.FeeToTickSpacingMapping,
        "FeeToTickSpacingMapping",
        FeeToTickSpacingMappingId(
          chainIdOf(pool),
          pool.factoryAddress,
          pool.tickSpacing,
        ),
      )
    : undefined;
  if (!mapping) {
    context.log.warn(
      `[${caller}] Fee reset to the tick-spacing default for pool ${pool.poolAddress} on chain ${chainIdOf(pool)}, but factory ${pool.factoryAddress} has no FeeToTickSpacingMapping for tick spacing ${pool.tickSpacing}; keeping the previous fee.`,
    );
    return undefined;
  }
  return mapping.fee;
}

/**
 * Records a V2 factory's default fee for one pool type (SetDefaultFee).
 *
 * @param chainId - Chain of the factory
 * @param factoryAddress - The factory (`event.srcAddress`)
 * @param isStable - Pool type the default applies to
 * @param feeBps - The default fee in basis points, as emitted
 * @param blockTimestamp - Block timestamp in seconds
 * @param context - Handler context
 * @returns void; the PoolFactoryDefaultFee row is staged
 */
export function recordV2DefaultFee(
  chainId: number,
  factoryAddress: string,
  isStable: boolean,
  feeBps: bigint,
  blockTimestamp: number,
  context: handlerContext,
): void {
  context.PoolFactoryDefaultFee.set({
    id: PoolFactoryDefaultFeeId(chainId, factoryAddress, isStable),
    factoryAddress,
    isStable,
    fee: toCanonicalFeeScale(feeBps, false),
    lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
  });
}

/**
 * The fee a V2 pool without a custom fee is charged, in FEE_SCALE: its
 * factory's latest SetDefaultFee for the pool type, else the 5 / 30 bps
 * constants (the Optimism and Base PoolFactory emit no SetDefaultFee; every
 * leaf and Aero factory emitted 5 / 30 at deployment and never changed it,
 * HyperSync scan of 2026-11-13).
 *
 * @param chainId - Chain of the pool
 * @param factoryAddress - The pool's factory (may be undefined on old rows)
 * @param isStable - Pool type
 * @param context - Handler context
 * @returns The default fee in FEE_SCALE
 */
export async function getV2DefaultFee(
  chainId: number,
  factoryAddress: string | undefined,
  isStable: boolean,
  context: handlerContext,
): Promise<bigint> {
  const configured = factoryAddress
    ? await getRehydrated(
        context.PoolFactoryDefaultFee,
        "PoolFactoryDefaultFee",
        PoolFactoryDefaultFeeId(chainId, factoryAddress, isStable),
      )
    : undefined;
  return (
    configured?.fee ??
    toCanonicalFeeScale(
      isStable ? DEFAULT_SAMM_FEE_BPS : DEFAULT_VAMM_FEE_BPS,
      false,
    )
  );
}
