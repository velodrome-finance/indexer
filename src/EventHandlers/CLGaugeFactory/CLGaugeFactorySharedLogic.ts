import type { handlerContext } from "generated";

/**
 * Upsert the chain-wide CLGaugeConfig default emissions cap.
 * Shared by CLGaugeFactoryV2 and CLGaugeFactoryV3 — last-writer-wins per chain.
 * @param chainId - Chain ID the event fired on (keys the CLGaugeConfig row)
 * @param newDefaultCap - New default emissions cap from the event payload
 * @param blockTimestampSeconds - Block timestamp (seconds) used for lastUpdatedTimestamp
 * @param context - Handler context for entity access
 * @returns Promise that resolves once the upsert is staged
 */
export async function applySetDefaultCap(
  chainId: number,
  newDefaultCap: bigint,
  blockTimestampSeconds: number,
  context: handlerContext,
): Promise<void> {
  const existing = await context.CLGaugeConfig.get(String(chainId));
  context.CLGaugeConfig.set({
    ...(existing ?? {}),
    id: String(chainId),
    defaultEmissionsCap: newDefaultCap,
    lastUpdatedTimestamp: new Date(blockTimestampSeconds * 1000),
  });
}

/**
 * Apply a per-gauge emission cap to the matching LiquidityPoolAggregator.
 * Shared by CLGaugeFactoryV2 and CLGaugeFactoryV3.
 * @param gauge - Gauge address from the event payload
 * @param newEmissionCap - New emissions cap for the gauge's pool
 * @param blockTimestampSeconds - Block timestamp (seconds) used for lastUpdatedTimestamp
 * @param factoryLogPrefix - Identifier used when warning about duplicate gauge matches (e.g. "CLGaugeFactoryV2")
 * @param context - Handler context for entity access
 * @returns Promise that resolves once the update is staged, or no-ops if no pool matches
 */
export async function applySetEmissionCap(
  gauge: string,
  newEmissionCap: bigint,
  blockTimestampSeconds: number,
  factoryLogPrefix: string,
  context: handlerContext,
): Promise<void> {
  const poolEntityList = await context.LiquidityPoolAggregator.getWhere({
    gaugeAddress: { _eq: gauge },
  });

  if (!poolEntityList || poolEntityList.length === 0) {
    context.log.error(`Pool entity not found for gauge ${gauge}`);
    return;
  }

  if (poolEntityList.length > 1) {
    context.log.warn(
      `[${factoryLogPrefix}] Multiple pools found for gauge ${gauge}, using first match`,
    );
  }

  const poolEntity = poolEntityList[0];

  context.LiquidityPoolAggregator.set({
    ...poolEntity,
    gaugeEmissionsCap: newEmissionCap,
    lastUpdatedTimestamp: new Date(blockTimestampSeconds * 1000),
  });
}
