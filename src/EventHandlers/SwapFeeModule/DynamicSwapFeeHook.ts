import { indexer } from "envio";
import { updatePool } from "../../Aggregators/Pool";
import { PoolId, toChecksumAddress } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { Pool, handlerContext } from "../../EntityTypes";
import { getTickSpacingDefaultFee } from "./CustomSwapFeeSharedLogic";

/**
 * `ZERO_FEE_INDICATOR()` of each Aero DynamicSwapFeeHook, read on-chain on
 * 2026-11-13. Unlike the legacy fee modules (420) the hook uses
 * `type(uint24).max`; the earlier Arc lite-launch hook uses 55555.
 */
export const HOOK_ZERO_FEE_INDICATOR: ReadonlyMap<string, bigint> = new Map([
  [toChecksumAddress("0xC0ed888AfE87ed1AcF01D9f19bB850159e3ce434"), 16777215n], // every Aero chain
  [toChecksumAddress("0xaAf164008441F112eB2858d9F7A2dB1B84b1E415"), 55555n], // Arc lite launch
]);

/**
 * Resolves a DynamicSwapFeeHook `CustomFeeSet` value into the pool's
 * configured base fee (FEE_SCALE 1e6, the same scale the hook uses).
 *
 * The hook's rules (DynamicSwapFeeHook `_getFirstSwapFee`): a base fee of 0
 * means "use the tick-spacing fee, plus the dynamic part"; the hook's zero-fee
 * indicator means "charge the static tick-spacing fee" (it is 0% only for
 * flash loans). Either way the configured nominal fee is the factory's
 * tick-spacing fee; any other value is the base fee itself. What a swap
 * actually pays (base + volatility part + MEV tax, capped) is measured per
 * swap into `currentFee` by the CL Swap handler.
 *
 * @param rawFee - `fee` from CustomFeeSet
 * @param pool - The pool the fee applies to
 * @param hookAddress - The hook that emitted the event
 * @param context - Handler context, used to read the tick-spacing default
 * @returns The base fee, or undefined when the tick-spacing default cannot be
 *   resolved (the caller then keeps the previous fee)
 */
export async function resolveHookBaseFee(
  rawFee: bigint,
  pool: Pool,
  hookAddress: string,
  context: handlerContext,
): Promise<bigint | undefined> {
  const zeroFeeIndicator = HOOK_ZERO_FEE_INDICATOR.get(hookAddress);
  if (rawFee !== 0n && rawFee !== zeroFeeIndicator) return rawFee;
  return getTickSpacingDefaultFee(pool, context, "resolveHookBaseFee");
}

/**
 * Loads the pool a hook event names and applies `diff` to it.
 *
 * @param chainId - Chain of the event
 * @param poolAddress - Pool from the event
 * @param timestamp - Block timestamp in seconds
 * @param blockNumber - Block number
 * @param context - Handler context
 * @param buildDiff - Builds the diff from the loaded pool, or returns
 *   undefined to leave the pool unchanged
 * @param clearDynamicConfig - Unset `feeCap` and `scalingFactor` first
 *   (updatePool's diff can set a field but not unset it)
 * @returns Promise that resolves once the update is staged (or skipped)
 */
async function updateHookPool(
  chainId: number,
  poolAddress: string,
  timestamp: number,
  blockNumber: number,
  context: handlerContext,
  buildDiff: (pool: Pool) => Promise<Partial<Pool> | undefined>,
  clearDynamicConfig = false,
): Promise<void> {
  const poolId = PoolId(chainId, poolAddress);
  const pool = await getRehydrated(context.Pool, "Pool", poolId);
  if (!pool) {
    context.log.warn(`[DynamicSwapFeeHook] Pool ${poolId} not found`);
    return;
  }
  const diff = await buildDiff(pool);
  if (!diff) return;
  await updatePool(
    diff,
    clearDynamicConfig
      ? { ...pool, feeCap: undefined, scalingFactor: undefined }
      : pool,
    new Date(timestamp * 1000),
    context,
    chainId,
    blockNumber,
  );
}

// Aero CL pools take their swap fee from the DynamicSwapFeeHook, which replaces
// the legacy DynamicSwapFeeModule / CustomSwapFeeModule. Only the per-pool
// configuration is indexed here; the fee each swap pays is derived from the
// swap itself (ADR 0001 amendment).

indexer.onEvent(
  { contract: "DynamicSwapFeeHook", event: "CustomFeeSet" },
  async ({ event, context }) => {
    await updateHookPool(
      event.chainId,
      event.params.pool,
      event.block.timestamp,
      event.block.number,
      context,
      async (pool) => {
        const baseFee = await resolveHookBaseFee(
          BigInt(event.params.fee),
          pool,
          event.srcAddress,
          context,
        );
        return baseFee === undefined ? undefined : { baseFee };
      },
    );
  },
);

indexer.onEvent(
  { contract: "DynamicSwapFeeHook", event: "FeeCapSet" },
  async ({ event, context }) => {
    await updateHookPool(
      event.chainId,
      event.params.pool,
      event.block.timestamp,
      event.block.number,
      context,
      async () => ({ feeCap: event.params.feeCap }),
    );
  },
);

indexer.onEvent(
  { contract: "DynamicSwapFeeHook", event: "ScalingFactorSet" },
  async ({ event, context }) => {
    await updateHookPool(
      event.chainId,
      event.params.pool,
      event.block.timestamp,
      event.block.number,
      context,
      async () => ({ scalingFactor: event.params.scalingFactor }),
    );
  },
);

// resetDynamicFee deletes the pool's fee cap and scaling factor (the hook's
// defaults apply again); the base fee is kept.
indexer.onEvent(
  { contract: "DynamicSwapFeeHook", event: "DynamicFeeReset" },
  async ({ event, context }) => {
    await updateHookPool(
      event.chainId,
      event.params.pool,
      event.block.timestamp,
      event.block.number,
      context,
      async () => ({}),
      true,
    );
  },
);
