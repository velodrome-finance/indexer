import type { handlerContext } from "generated";
import {
  type LiquidityPoolAggregatorDiff,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import { PoolId } from "../../Constants";

export interface UnstakedFeeEventData {
  poolAddress: string;
  fee: bigint;
  chainId: number;
  blockNumber: number;
  blockTimestamp: number;
  logContext: string;
}

/**
 * Applies a raw customFee value emitted by an UnstakedFeeModule (or CustomUnstakedFeeModule)
 * to the target pool aggregator. Last-writer-wins across all unstaked-fee module deployments
 * (Initial, Gauge Caps, Gauges V3) registered for the same chain.
 *
 * The value stored is the raw event parameter. Contract semantics of the underlying
 * customFee[pool] mapping:
 *   - 0   = no override, factory default applies
 *   - 420 = ZERO_FEE_INDICATOR (explicit 0% fee)
 *   - X in (0, 500_000] = X/1_000_000 fee rate
 *
 * @param data - Pool address, raw fee value, and event coordinates for the upsert.
 * @param context - Envio handler context used to read/write the pool aggregator.
 * @returns Promise that resolves once the pool diff has been staged; no-op if the pool
 *   aggregator does not yet exist (warning logged).
 */
export async function applyUnstakedFee(
  data: UnstakedFeeEventData,
  context: handlerContext,
): Promise<void> {
  const poolId = PoolId(data.chainId, data.poolAddress);
  const pool = await context.LiquidityPoolAggregator.get(poolId);

  if (!pool) {
    context.log.warn(`Pool ${poolId} not found for ${data.logContext} event`);
    return;
  }

  const diff: Partial<LiquidityPoolAggregatorDiff> = {
    unstakedFee: data.fee,
  };

  await updateLiquidityPoolAggregator(
    diff,
    pool,
    new Date(data.blockTimestamp * 1000),
    context,
    data.chainId,
    data.blockNumber,
  );
}
