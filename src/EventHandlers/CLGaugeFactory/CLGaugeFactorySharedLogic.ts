import type { CLGaugeConfig } from "envio";
import { findPoolByGaugeAddress } from "../../Aggregators/Pool";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";

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
  const existing = await getRehydrated(
    context.CLGaugeConfig,
    "CLGaugeConfig",
    String(chainId),
  );
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
  const existing = await getRehydrated(
    context.CLGaugeConfig,
    "CLGaugeConfig",
    String(chainId),
  );
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
  const existing = await getRehydrated(
    context.CLGaugeConfig,
    "CLGaugeConfig",
    String(chainId),
  );
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
 * Apply a per-gauge emission cap to the Pool on the event's chain whose gauge it is.
 * Shared by CLGaugeFactoryV2 and CLGaugeFactoryV3.
 *
 * The CL gauge factory sits at one address on every superchain leaf chain and
 * deploys gauges deterministically, so the same gauge address can belong to
 * pools on several chains. The pool is therefore looked up on the event's
 * chain only; a gauge with no pool on that chain is logged and skipped.
 * @param chainId - Chain the SetEmissionCap event fired on
 * @param gauge - Gauge address from the event payload
 * @param newEmissionCap - New emissions cap for the gauge's pool
 * @param blockTimestampSeconds - Block timestamp (seconds) used for lastUpdatedTimestamp
 * @param factoryLogPrefix - Identifier used in the not-found log line (e.g. "CLGaugeFactoryV2")
 * @param context - Handler context for entity access
 * @returns Promise that resolves once the update is staged, or no-ops if no pool on the chain matches
 */
export async function applySetEmissionCap(
  chainId: number,
  gauge: string,
  newEmissionCap: bigint,
  blockTimestampSeconds: number,
  factoryLogPrefix: string,
  context: handlerContext,
): Promise<void> {
  const poolEntity = await findPoolByGaugeAddress(gauge, chainId, context);

  if (!poolEntity) {
    context.log.error(
      `[${factoryLogPrefix}] Pool entity not found for gauge ${gauge} on chain ${chainId}`,
    );
    return;
  }

  context.Pool.set({
    ...poolEntity,
    gaugeEmissionsCap: newEmissionCap,
    lastUpdatedTimestamp: new Date(blockTimestampSeconds * 1000),
  });
}
