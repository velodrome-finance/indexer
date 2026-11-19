import { indexer } from "envio";
import type { EvmEvent } from "envio";
import type { handlerContext } from "../../EntityTypes";
import {
  AERO_REDEMPTION_EVENT_KIND,
  AERO_ROOT_CHAIN_ID,
  AERO_ROOT_EMISSIONS_HANDLER,
  AERO_ZERO_GAUGE,
  AeroEventId,
} from "./AeroConstants";
import {
  isAeroGaugeAlive,
  loadAeroGauge,
  loadAeroRewardToken,
  loadOrCreateLeafVoterState,
  persistAeroGauge,
  persistLeafVoterState,
  rewardTokenUSD,
  syncAeroPoolGaugeLink,
} from "./AeroGaugeLogic";
import {
  type LeafEventContext,
  patchLeafTokenState,
  processLeafChainAllocated,
  processLeafDeallocated,
  processLeafEmergencyDeallocationApplied,
  processLeafGaugesAllocated,
} from "./AeroLeafAllocationLogic";

/**
 * Aero LeafVoter (same address on every chain, Base included), phase 2:
 * gauge lifecycle (GaugeRegistered / GaugeActivated), the per-gauge emission
 * ledger (GaugeCapSettled credits, EmissionsMinted on claim,
 * EmissionsForfeited), xAERO redemptions (Redeemed) and the chain status.
 *
 * The LeafVoter keeps, per gauge, `ceiling` (credited), `claimed` (minted)
 * and `surplus` (forfeited); AeroGauge mirrors the three from these events.
 * Settlements and mints are very frequent (hundreds of thousands a day on
 * Base), so they only update the gauge and chain totals and their hourly
 * snapshots, and write no per-event rows.
 */

/**
 * GaugeCapSettled: emissions credited to a gauge since its last settlement,
 * the cap excess sent to the chain surplus, the cap in force and the gauge's
 * weight. The zero gauge (idle allocations) only adds to the chain's idle
 * surplus.
 *
 * @param event - AeroLeafVoter.GaugeCapSettled
 * @param context - Handler context
 * @returns Promise that resolves once the gauge and chain totals are staged
 */
export async function processGaugeCapSettled(
  event: EvmEvent<"AeroLeafVoter", "GaugeCapSettled">,
  context: handlerContext,
): Promise<void> {
  const {
    gauge: gaugeAddress,
    effectiveShare,
    surplusDelta,
    cap,
  } = event.params;
  const timestamp = new Date(event.block.timestamp * 1000);
  const isZeroGauge = gaugeAddress === AERO_ZERO_GAUGE;
  const [state, gauge] = await Promise.all([
    loadOrCreateLeafVoterState(event.chainId, timestamp, context),
    isZeroGauge
      ? undefined
      : loadAeroGauge(event.chainId, gaugeAddress, context),
  ]);

  persistLeafVoterState(
    {
      ...state,
      totalEmissionsCredited: state.totalEmissionsCredited + effectiveShare,
      totalCapSurplus: state.totalCapSurplus + surplusDelta,
      totalIdleSurplus: isZeroGauge
        ? state.totalIdleSurplus + surplusDelta
        : state.totalIdleSurplus,
    },
    timestamp,
    context,
  );

  if (isZeroGauge) return;
  if (!gauge) {
    context.log.warn(
      `[AeroLeafVoter.GaugeCapSettled] unknown gauge ${gaugeAddress} on chain ${event.chainId}`,
    );
    return;
  }
  const capChanged = gauge.emissionCap !== cap;
  const wasAlive = isAeroGaugeAlive(gauge);
  const updated = {
    ...gauge,
    totalEmissionsCredited: gauge.totalEmissionsCredited + effectiveShare,
    totalCapSurplus: gauge.totalCapSurplus + surplusDelta,
    emissionCap: cap,
    emissionCapUpdatedTimestamp: capChanged
      ? timestamp
      : gauge.emissionCapUpdatedTimestamp,
    lastGaugeWeight: event.params.gaugeWeight,
    lastSettlementTimestamp: timestamp,
  };
  persistAeroGauge(updated, timestamp, context);
  if (wasAlive !== isAeroGaugeAlive(updated)) {
    await syncAeroPoolGaugeLink(
      updated,
      timestamp,
      event.block.number,
      context,
      event.chainId,
    );
  }
}

/**
 * EmissionsMinted: a gauge's claim minted (the sum of `amounts`, normally one
 * leg) receipt tokens; on Base the RootEmissionsHandler redeems them to AERO
 * in the same transaction. Adds to the gauge's and the chain's minted totals
 * and to the outstanding receipt supply.
 *
 * @param event - AeroLeafVoter.EmissionsMinted
 * @param context - Handler context
 * @returns Promise that resolves once the gauge and chain totals are staged
 */
export async function processEmissionsMinted(
  event: EvmEvent<"AeroLeafVoter", "EmissionsMinted">,
  context: handlerContext,
): Promise<void> {
  const amount = event.params.amounts.reduce((sum, a) => sum + a, 0n);
  const timestamp = new Date(event.block.timestamp * 1000);
  const [state, gauge, rewardToken] = await Promise.all([
    loadOrCreateLeafVoterState(event.chainId, timestamp, context),
    loadAeroGauge(event.chainId, event.params.gauge, context),
    loadAeroRewardToken(event.chainId, context),
  ]);
  const amountUSD = rewardTokenUSD(amount, rewardToken, event.chainId);
  persistLeafVoterState(
    {
      ...state,
      totalEmissionsMinted: state.totalEmissionsMinted + amount,
      totalEmissionsMintedUSD: state.totalEmissionsMintedUSD + amountUSD,
      receiptTokenSupply: state.receiptTokenSupply + amount,
    },
    timestamp,
    context,
  );
  if (!gauge) {
    context.log.warn(
      `[AeroLeafVoter.EmissionsMinted] unknown gauge ${event.params.gauge} on chain ${event.chainId}`,
    );
    return;
  }
  persistAeroGauge(
    {
      ...gauge,
      totalEmissionsMinted: gauge.totalEmissionsMinted + amount,
      totalEmissionsMintedUSD: gauge.totalEmissionsMintedUSD + amountUSD,
    },
    timestamp,
    context,
  );
}

/**
 * EmissionsForfeited: credited emissions a gauge could not pay out (no staked
 * liquidity in range, early-withdraw penalties), returned to the chain
 * surplus.
 *
 * @param event - AeroLeafVoter.EmissionsForfeited
 * @param context - Handler context
 * @returns Promise that resolves once the gauge and chain totals are staged
 */
export async function processEmissionsForfeited(
  event: EvmEvent<"AeroLeafVoter", "EmissionsForfeited">,
  context: handlerContext,
): Promise<void> {
  const { amount } = event.params;
  const timestamp = new Date(event.block.timestamp * 1000);
  const [state, gauge] = await Promise.all([
    loadOrCreateLeafVoterState(event.chainId, timestamp, context),
    loadAeroGauge(event.chainId, event.params.gauge, context),
  ]);
  persistLeafVoterState(
    {
      ...state,
      totalEmissionsForfeited: state.totalEmissionsForfeited + amount,
    },
    timestamp,
    context,
  );
  if (!gauge) {
    context.log.warn(
      `[AeroLeafVoter.EmissionsForfeited] unknown gauge ${event.params.gauge} on chain ${event.chainId}`,
    );
    return;
  }
  persistAeroGauge(
    {
      ...gauge,
      totalEmissionsForfeited: gauge.totalEmissionsForfeited + amount,
    },
    timestamp,
    context,
  );
}

/**
 * Redeemed: receipt tokens burned to mint AERO on Base. Every redemption
 * counts towards the chain's totals; a user redemption also gets an
 * AeroRedemptionEvent row. The ones Base's RootEmissionsHandler makes for
 * every Base claim are internal plumbing and get none.
 *
 * @param event - AeroLeafVoter.Redeemed
 * @param context - Handler context
 * @returns Promise that resolves once the totals (and row) are staged
 */
export async function processRedeemed(
  event: EvmEvent<"AeroLeafVoter", "Redeemed">,
  context: handlerContext,
): Promise<void> {
  const { redeemer, recipient, amount } = event.params;
  const timestamp = new Date(event.block.timestamp * 1000);
  const state = await loadOrCreateLeafVoterState(
    event.chainId,
    timestamp,
    context,
  );
  persistLeafVoterState(
    {
      ...state,
      totalRedeemed: state.totalRedeemed + amount,
      numberOfRedemptions: state.numberOfRedemptions + 1n,
      receiptTokenSupply: state.receiptTokenSupply - amount,
    },
    timestamp,
    context,
  );
  // Widened to number: a chain-subset config narrows event.chainId to its ids.
  const chainId: number = event.chainId;
  const isRootInternal =
    chainId === AERO_ROOT_CHAIN_ID && redeemer === AERO_ROOT_EMISSIONS_HANDLER;
  if (isRootInternal) return;
  context.AeroRedemptionEvent.set({
    id: AeroEventId(event.chainId, event.transaction.hash, event.logIndex),
    kind: AERO_REDEMPTION_EVENT_KIND.INITIATED,
    sourceChainId: event.chainId,
    redeemer,
    recipient,
    amount,
    surplusReported: undefined,
    blockNumber: BigInt(event.block.number),
    timestamp,
    transactionHash: event.transaction.hash,
  });
}

/**
 * GaugeRegistered / GaugeActivated: the gauge becomes payable / routable.
 * Activation (at registration or later) also sets the pool's gaugeIsAlive.
 *
 * @param chainId - Chain of the event
 * @param gaugeAddress - Gauge
 * @param activated - Whether the gauge is (now) activated
 * @param blockNumber - Block number
 * @param blockTimestamp - Block time (seconds)
 * @param context - Handler context
 * @returns Promise that resolves once the gauge (and pool flag) are staged
 */
export async function processGaugeLifecycle(
  chainId: number,
  gaugeAddress: string,
  activated: boolean,
  blockNumber: number,
  blockTimestamp: number,
  context: handlerContext,
): Promise<void> {
  const gauge = await loadAeroGauge(chainId, gaugeAddress, context);
  if (!gauge) {
    context.log.warn(
      `[AeroLeafVoter] gauge ${gaugeAddress} registered on chain ${chainId} but not created by an indexed gauge factory`,
    );
    return;
  }
  const timestamp = new Date(blockTimestamp * 1000);
  const wasAlive = isAeroGaugeAlive(gauge);
  const updated = {
    ...gauge,
    isRegistered: true,
    isActivated: gauge.isActivated || activated,
    activatedTimestamp:
      activated && !gauge.isActivated ? timestamp : gauge.activatedTimestamp,
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

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "GaugeRegistered" },
  async ({ event, context }) => {
    // An activated registration also emits GaugeActivated; registration alone
    // never activates.
    await processGaugeLifecycle(
      event.chainId,
      event.params.gauge,
      false,
      event.block.number,
      event.block.timestamp,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "GaugeActivated" },
  async ({ event, context }) => {
    await processGaugeLifecycle(
      event.chainId,
      event.params.gauge,
      true,
      event.block.number,
      event.block.timestamp,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "GaugeCapSettled" },
  async ({ event, context }) => {
    await processGaugeCapSettled(event, context);
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "EmissionsMinted" },
  async ({ event, context }) => {
    await processEmissionsMinted(event, context);
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "EmissionsForfeited" },
  async ({ event, context }) => {
    await processEmissionsForfeited(event, context);
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "Redeemed" },
  async ({ event, context }) => {
    await processRedeemed(event, context);
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "ChainStatusSet" },
  async ({ event, context }) => {
    const timestamp = new Date(event.block.timestamp * 1000);
    const state = await loadOrCreateLeafVoterState(
      event.chainId,
      timestamp,
      context,
    );
    persistLeafVoterState(
      { ...state, chainStatus: Number(event.params.status) },
      timestamp,
      context,
    );
  },
);

// ------------------------- phase 3: allocations -------------------------

function leafContext(event: {
  chainId: number;
  block: { number: number; timestamp: number };
  transaction: { hash: string };
  logIndex: number;
}): LeafEventContext {
  return {
    chainId: event.chainId,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  };
}

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "ChainAllocated" },
  async ({ event, context }) => {
    await processLeafChainAllocated(
      leafContext(event),
      event.params.tokenId,
      event.params.allocationDelta,
      event.params.chainAllocation,
      event.params.emissionsPerVP,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "GaugesAllocated" },
  async ({ event, context }) => {
    await processLeafGaugesAllocated(
      leafContext(event),
      event.params.tokenId,
      event.params.allocations,
      event.params.emissionsPerVP,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "Deallocated" },
  async ({ event, context }) => {
    processLeafDeallocated(
      leafContext(event),
      event.params.tokenId,
      event.params.amount,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "EmergencyDeallocationApplied" },
  async ({ event, context }) => {
    await processLeafEmergencyDeallocationApplied(
      leafContext(event),
      event.params.tokenId,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "OperatorSet" },
  async ({ event, context }) => {
    await patchLeafTokenState(
      leafContext(event),
      event.params.tokenId,
      { operator: event.params.operator },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "CanVoteForZeroCapGaugesSet" },
  async ({ event, context }) => {
    await patchLeafTokenState(
      leafContext(event),
      event.params.tokenId,
      { canVoteForZeroCapGauges: event.params.allowed },
      context,
    );
  },
);

/**
 * Applies a LeafVoter configuration change to the chain's state row.
 *
 * @param chainId - Chain of the LeafVoter
 * @param blockTimestamp - Block time (seconds)
 * @param patch - Fields to set
 * @param context - Handler context
 * @returns Promise that resolves once the state row is staged
 */
async function patchLeafVoterConfig(
  chainId: number,
  blockTimestamp: number,
  patch: Partial<{
    allocationCooldown: bigint;
    maxGauges: bigint;
    minIncentiveDuration: bigint;
    localVotingEnabled: boolean;
  }>,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(blockTimestamp * 1000);
  const state = await loadOrCreateLeafVoterState(chainId, timestamp, context);
  persistLeafVoterState({ ...state, ...patch }, timestamp, context);
}

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "AllocationCooldownSet" },
  async ({ event, context }) => {
    await patchLeafVoterConfig(
      event.chainId,
      event.block.timestamp,
      { allocationCooldown: event.params.allocationCooldown },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "MaxGaugesSet" },
  async ({ event, context }) => {
    await patchLeafVoterConfig(
      event.chainId,
      event.block.timestamp,
      { maxGauges: event.params.maxGauges },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "MinIncentiveDurationSet" },
  async ({ event, context }) => {
    await patchLeafVoterConfig(
      event.chainId,
      event.block.timestamp,
      { minIncentiveDuration: event.params.minIncentiveDuration },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroLeafVoter", event: "LocalVotingEnabledSet" },
  async ({ event, context }) => {
    await patchLeafVoterConfig(
      event.chainId,
      event.block.timestamp,
      { localVotingEnabled: event.params.enabled },
      context,
    );
  },
);
