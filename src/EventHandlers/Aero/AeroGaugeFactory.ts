import { indexer } from "envio";
import type { handlerContext } from "../../EntityTypes";
import { AeroGaugeId } from "./AeroConstants";
import {
  createAeroGaugeEntity,
  isAeroGaugeAlive,
  loadAeroGauge,
  loadOrCreateAeroGaugeFactory,
  persistAeroGauge,
  syncAeroPoolGaugeLink,
} from "./AeroGaugeLogic";

/**
 * Aero gauge factories (ADR 0006): the CL gauge factory (same address on
 * every chain, plus Arc's lite launch) and the V2 stable / volatile gauge
 * factories. Their GaugeCreated registers the gauge contract and creates the
 * AeroGauge row; the configuration events maintain AeroGaugeFactory and the
 * per-gauge cap, minimum stake and referral.
 *
 * Deactivation: Aero has no kill. A gauge with an emission cap of 0 earns
 * nothing (its accrual goes to surplus), routes no new allocations and
 * collects no fees; `Pool.gaugeIsAlive` follows it.
 */

type FactoryKind = { isCL: boolean; label: string };
const CL: FactoryKind = { isCL: true, label: "AeroCLGaugeFactory" };
const V2: FactoryKind = { isCL: false, label: "AeroV2GaugeFactory" };

indexer.contractRegister(
  { contract: "AeroCLGaugeFactory", event: "GaugeCreated" },
  async ({ event, context }) => {
    context.chain.AeroCLGauge.add(event.params.gauge);
  },
);

indexer.contractRegister(
  { contract: "AeroV2GaugeFactory", event: "GaugeCreated" },
  async ({ event, context }) => {
    context.chain.AeroV2Gauge.add(event.params.gauge);
  },
);

/**
 * GaugeCreated: creates the AeroGauge (cap = the factory's default when one
 * was emitted, else null = default), counts it on the factory and links it to
 * its Aero pool (`Pool.gaugeAddress`), which turns NFPM transfers to the gauge
 * into stakes (NFPMTransferLogic's gauge check).
 *
 * @param kind - Which factory family emitted it
 * @param params - Event fields
 * @param params.chainId - Chain of the event
 * @param params.factory - Emitting factory
 * @param params.gauge - New gauge
 * @param params.pool - Gauge target
 * @param params.isPool - The factory's isPool flag
 * @param params.blockNumber - Block number
 * @param params.timestamp - Block time (seconds)
 * @param params.transactionHash - Transaction hash
 * @param context - Handler context
 * @returns Promise that resolves once the gauge, factory and pool link are staged
 */
async function processGaugeCreated(
  kind: FactoryKind,
  params: {
    chainId: number;
    factory: string;
    gauge: string;
    pool: string;
    isPool: boolean;
    blockNumber: number;
    timestamp: number;
    transactionHash: string;
  },
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(params.timestamp * 1000);
  const gaugeId = AeroGaugeId(params.chainId, params.gauge);
  const [factory, existing, pendingReferral] = await Promise.all([
    loadOrCreateAeroGaugeFactory(
      params.chainId,
      params.factory,
      kind.isCL,
      timestamp,
      context,
    ),
    loadAeroGauge(params.chainId, params.gauge, context),
    context.AeroGaugePendingReferral.get(gaugeId),
  ]);
  context.AeroGaugeFactory.set({
    ...factory,
    numberOfGauges: factory.numberOfGauges + 1,
    lastUpdatedTimestamp: timestamp,
  });
  let gauge =
    existing ??
    createAeroGaugeEntity({
      chainId: params.chainId,
      gauge: params.gauge,
      pool: params.pool,
      isCL: kind.isCL,
      isPool: params.isPool,
      gaugeFactory: params.factory,
      emissionCap: factory.defaultCap,
      blockNumber: params.blockNumber,
      timestamp,
      transactionHash: params.transactionHash,
    });
  if (pendingReferral) {
    context.AeroGaugePendingReferral.deleteUnsafe(gaugeId);
    gauge = {
      ...gauge,
      referral: pendingReferral.referral,
      referralShare: pendingReferral.referralShare,
    };
  }
  persistAeroGauge(gauge, timestamp, context);
  await syncAeroPoolGaugeLink(
    gauge,
    timestamp,
    params.blockNumber,
    context,
    params.chainId,
  );
}

/**
 * EmissionCapSet: the gauge's per-second cap. A change to or from 0 flips the
 * pool's `gaugeIsAlive`.
 *
 * @param chainId - Chain of the event
 * @param gaugeAddress - Gauge whose cap changed
 * @param cap - New stored cap (reward-token wei per second)
 * @param blockNumber - Block number
 * @param blockTimestamp - Block time (seconds)
 * @param context - Handler context
 * @returns Promise that resolves once the gauge (and pool flag) are staged
 */
async function processEmissionCapSet(
  chainId: number,
  gaugeAddress: string,
  cap: bigint,
  blockNumber: number,
  blockTimestamp: number,
  context: handlerContext,
): Promise<void> {
  const gauge = await loadAeroGauge(chainId, gaugeAddress, context);
  if (!gauge) {
    context.log.warn(
      `[AeroGaugeFactory.EmissionCapSet] unknown gauge ${gaugeAddress} on chain ${chainId}`,
    );
    return;
  }
  const timestamp = new Date(blockTimestamp * 1000);
  const wasAlive = isAeroGaugeAlive(gauge);
  const updated = {
    ...gauge,
    emissionCap: cap,
    emissionCapUpdatedTimestamp: timestamp,
  };
  persistAeroGauge(updated, timestamp, context);
  if (wasAlive !== isAeroGaugeAlive(updated)) {
    await syncAeroPoolGaugeLink(
      updated,
      timestamp,
      blockNumber,
      context,
      chainId,
    );
  }
}

/**
 * Applies a partial update to a gauge factory's configuration row.
 *
 * @param kind - Which factory family emitted it
 * @param chainId - Chain of the event
 * @param factoryAddress - Emitting factory
 * @param blockTimestamp - Block time (seconds)
 * @param patch - Fields to set
 * @param context - Handler context
 * @returns Promise that resolves once the factory row is staged
 */
async function patchFactory(
  kind: FactoryKind,
  chainId: number,
  factoryAddress: string,
  blockTimestamp: number,
  patch: Partial<{
    defaultCap: bigint;
    operatorMinCap: bigint;
    operatorMaxCap: bigint;
    minStakeBlocks: bigint;
    penaltyRate: bigint;
    maxShareCap: bigint;
    emergencyWithdrawEnabled: boolean;
  }>,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(blockTimestamp * 1000);
  const factory = await loadOrCreateAeroGaugeFactory(
    chainId,
    factoryAddress,
    kind.isCL,
    timestamp,
    context,
  );
  context.AeroGaugeFactory.set({
    ...factory,
    ...patch,
    lastUpdatedTimestamp: timestamp,
  });
}

/**
 * Applies a partial update to one gauge (per-gauge factory settings).
 *
 * @param label - Handler label for the warning on an unknown gauge
 * @param chainId - Chain of the event
 * @param gaugeAddress - Gauge
 * @param blockTimestamp - Block time (seconds)
 * @param patch - Fields to set
 * @param context - Handler context
 * @returns Promise that resolves once the gauge is staged
 */
async function patchGauge(
  label: string,
  chainId: number,
  gaugeAddress: string,
  blockTimestamp: number,
  patch: Partial<{
    minStakeBlocks: bigint;
    referral: string | undefined;
    referralShare: bigint | undefined;
  }>,
  context: handlerContext,
): Promise<void> {
  const gauge = await loadAeroGauge(chainId, gaugeAddress, context);
  if (!gauge) {
    context.log.warn(
      `[${label}] unknown gauge ${gaugeAddress} on chain ${chainId}`,
    );
    return;
  }
  persistAeroGauge(
    { ...gauge, ...patch },
    new Date(blockTimestamp * 1000),
    context,
  );
}

// ---------------------------------------------------------------------------
// Handler registration. The two factory families share the logic; envio's
// typed `onEvent` needs a literal contract name, hence the duplication.
// ---------------------------------------------------------------------------

indexer.onEvent(
  { contract: "AeroCLGaugeFactory", event: "GaugeCreated" },
  async ({ event, context }) => {
    await processGaugeCreated(
      CL,
      {
        chainId: event.chainId,
        factory: event.srcAddress,
        gauge: event.params.gauge,
        pool: event.params.pool,
        isPool: event.params.isPool,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2GaugeFactory", event: "GaugeCreated" },
  async ({ event, context }) => {
    await processGaugeCreated(
      V2,
      {
        chainId: event.chainId,
        factory: event.srcAddress,
        gauge: event.params.gauge,
        pool: event.params.pool,
        isPool: event.params.isPool,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGaugeFactory", event: "EmissionCapSet" },
  async ({ event, context }) => {
    await processEmissionCapSet(
      event.chainId,
      event.params.gauge,
      event.params.cap,
      event.block.number,
      event.block.timestamp,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2GaugeFactory", event: "EmissionCapSet" },
  async ({ event, context }) => {
    await processEmissionCapSet(
      event.chainId,
      event.params.gauge,
      event.params.cap,
      event.block.number,
      event.block.timestamp,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGaugeFactory", event: "DefaultCapSet" },
  async ({ event, context }) => {
    await patchFactory(
      CL,
      event.chainId,
      event.srcAddress,
      event.block.timestamp,
      { defaultCap: event.params.cap },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2GaugeFactory", event: "DefaultCapSet" },
  async ({ event, context }) => {
    await patchFactory(
      V2,
      event.chainId,
      event.srcAddress,
      event.block.timestamp,
      { defaultCap: event.params.cap },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGaugeFactory", event: "OperatorCapRangeSet" },
  async ({ event, context }) => {
    await patchFactory(
      CL,
      event.chainId,
      event.srcAddress,
      event.block.timestamp,
      {
        operatorMinCap: event.params.minCap,
        operatorMaxCap: event.params.maxCap,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2GaugeFactory", event: "OperatorCapRangeSet" },
  async ({ event, context }) => {
    await patchFactory(
      V2,
      event.chainId,
      event.srcAddress,
      event.block.timestamp,
      {
        operatorMinCap: event.params.minCap,
        operatorMaxCap: event.params.maxCap,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGaugeFactory", event: "MaxShareCapSet" },
  async ({ event, context }) => {
    await patchFactory(
      CL,
      event.chainId,
      event.srcAddress,
      event.block.timestamp,
      { maxShareCap: event.params.cap },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2GaugeFactory", event: "MaxShareCapSet" },
  async ({ event, context }) => {
    await patchFactory(
      V2,
      event.chainId,
      event.srcAddress,
      event.block.timestamp,
      { maxShareCap: event.params.cap },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGaugeFactory", event: "PenaltyConfigSet" },
  async ({ event, context }) => {
    await patchFactory(
      CL,
      event.chainId,
      event.srcAddress,
      event.block.timestamp,
      {
        minStakeBlocks: event.params.minStakeBlocks,
        penaltyRate: event.params.penaltyRate,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2GaugeFactory", event: "PenaltyConfigSet" },
  async ({ event, context }) => {
    await patchFactory(
      V2,
      event.chainId,
      event.srcAddress,
      event.block.timestamp,
      {
        minStakeBlocks: event.params.minStakeBlocks,
        penaltyRate: event.params.penaltyRate,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGaugeFactory", event: "EmergencyWithdrawEnabledSet" },
  async ({ event, context }) => {
    await patchFactory(
      CL,
      event.chainId,
      event.srcAddress,
      event.block.timestamp,
      { emergencyWithdrawEnabled: event.params.enabled },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2GaugeFactory", event: "EmergencyWithdrawEnabledSet" },
  async ({ event, context }) => {
    await patchFactory(
      V2,
      event.chainId,
      event.srcAddress,
      event.block.timestamp,
      { emergencyWithdrawEnabled: event.params.enabled },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLGaugeFactory", event: "MinStakeBlocksSet" },
  async ({ event, context }) => {
    await patchGauge(
      CL.label,
      event.chainId,
      event.params.gauge,
      event.block.timestamp,
      { minStakeBlocks: event.params.minStakeBlocks },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2GaugeFactory", event: "MinStakeBlocksSet" },
  async ({ event, context }) => {
    await patchGauge(
      V2.label,
      event.chainId,
      event.params.gauge,
      event.block.timestamp,
      { minStakeBlocks: event.params.minStakeBlocks },
      context,
    );
  },
);

/**
 * ReferralConfigSet: the gauge's referral and share; a zero referral or share
 * clears it. A referral configured inside createGauge is emitted before the
 * factory's GaugeCreated, so when the gauge does not exist yet the config is
 * parked (AeroGaugePendingReferral) for GaugeCreated to pick up.
 *
 * @param label - Handler label
 * @param chainId - Chain of the event
 * @param gaugeAddress - Gauge
 * @param referral - Referral address from the event
 * @param share - Referral share (pips) from the event
 * @param blockTimestamp - Block time (seconds)
 * @param context - Handler context
 * @returns Promise that resolves once the gauge or the pending referral is staged
 */
async function processReferralConfigSet(
  label: string,
  chainId: number,
  gaugeAddress: string,
  referral: string,
  share: bigint,
  blockTimestamp: number,
  context: handlerContext,
): Promise<void> {
  const cleared = share === 0n || /^0x0{40}$/i.test(referral);
  const gauge = await loadAeroGauge(chainId, gaugeAddress, context);
  if (!gauge) {
    const id = AeroGaugeId(chainId, gaugeAddress);
    if (cleared) {
      context.AeroGaugePendingReferral.deleteUnsafe(id);
    } else {
      context.AeroGaugePendingReferral.set({
        id,
        referral,
        referralShare: share,
      });
    }
    return;
  }
  await patchGauge(
    label,
    chainId,
    gaugeAddress,
    blockTimestamp,
    cleared
      ? { referral: undefined, referralShare: undefined }
      : { referral, referralShare: share },
    context,
  );
}

indexer.onEvent(
  { contract: "AeroCLGaugeFactory", event: "ReferralConfigSet" },
  async ({ event, context }) => {
    await processReferralConfigSet(
      CL.label,
      event.chainId,
      event.params.gauge,
      event.params.referral,
      event.params.share,
      event.block.timestamp,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroV2GaugeFactory", event: "ReferralConfigSet" },
  async ({ event, context }) => {
    await processReferralConfigSet(
      V2.label,
      event.chainId,
      event.params.gauge,
      event.params.referral,
      event.params.share,
      event.block.timestamp,
      context,
    );
  },
);
