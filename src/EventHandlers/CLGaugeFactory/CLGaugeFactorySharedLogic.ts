import type { CLGaugeConfig, handlerContext } from "generated";

/**
 * Build a fully-populated CLGaugeConfig row for a chain, spreading an existing
 * row if present and supplying zero defaults for any required fields not yet set.
 * Every partial-update helper (applySetDefaultCap, applySetDefaultMinStakeTime,
 * applySetPenaltyRate) routes through this so a first-time write never leaves
 * required fields missing and a subsequent write never stomps sibling fields.
 * @param chainId - Chain ID keying the CLGaugeConfig row
 * @param existing - Current CLGaugeConfig row, if any
 * @param override - Partial fields to apply on top of the existing row
 * @param blockTimestampSeconds - Block timestamp (seconds) used for lastUpdatedTimestamp
 * @returns A complete CLGaugeConfig ready to be passed to context.CLGaugeConfig.set
 */
function mergeCLGaugeConfig(
  chainId: number,
  existing: CLGaugeConfig | undefined,
  override: Partial<CLGaugeConfig>,
  blockTimestampSeconds: number,
): CLGaugeConfig {
  return {
    id: String(chainId),
    defaultEmissionsCap: 0n,
    defaultMinStakeTime: 0n,
    penaltyRate: 0n,
    ...(existing ?? {}),
    ...override,
    lastUpdatedTimestamp: new Date(blockTimestampSeconds * 1000),
  };
}

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
  context.CLGaugeConfig.set(
    mergeCLGaugeConfig(
      chainId,
      existing,
      { defaultEmissionsCap: newDefaultCap },
      blockTimestampSeconds,
    ),
  );
}

/**
 * Upsert the chain-wide CLGaugeConfig default min stake time (LP lockup in seconds).
 * Emitted by CLGaugeFactoryV3.SetDefaultMinStakeTime.
 * @param chainId - Chain ID the event fired on (keys the CLGaugeConfig row)
 * @param newMinStakeTime - New default min stake time (seconds) from the event payload
 * @param blockTimestampSeconds - Block timestamp (seconds) used for lastUpdatedTimestamp
 * @param context - Handler context for entity access
 * @returns Promise that resolves once the upsert is staged
 */
export async function applySetDefaultMinStakeTime(
  chainId: number,
  newMinStakeTime: bigint,
  blockTimestampSeconds: number,
  context: handlerContext,
): Promise<void> {
  const existing = await context.CLGaugeConfig.get(String(chainId));
  context.CLGaugeConfig.set(
    mergeCLGaugeConfig(
      chainId,
      existing,
      { defaultMinStakeTime: newMinStakeTime },
      blockTimestampSeconds,
    ),
  );
}

/**
 * Upsert the chain-wide CLGaugeConfig early-unstake penalty rate (basis points).
 * Emitted by CLGaugeFactoryV3.SetPenaltyRate.
 * @param chainId - Chain ID the event fired on (keys the CLGaugeConfig row)
 * @param newPenaltyRate - New penalty rate (bps) from the event payload
 * @param blockTimestampSeconds - Block timestamp (seconds) used for lastUpdatedTimestamp
 * @param context - Handler context for entity access
 * @returns Promise that resolves once the upsert is staged
 */
export async function applySetPenaltyRate(
  chainId: number,
  newPenaltyRate: bigint,
  blockTimestampSeconds: number,
  context: handlerContext,
): Promise<void> {
  const existing = await context.CLGaugeConfig.get(String(chainId));
  context.CLGaugeConfig.set(
    mergeCLGaugeConfig(
      chainId,
      existing,
      { penaltyRate: newPenaltyRate },
      blockTimestampSeconds,
    ),
  );
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
