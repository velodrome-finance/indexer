import type { AeroMinterState } from "envio";
import { indexer } from "envio";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import { getSnapshotEpoch, shouldSnapshot } from "../../Snapshots/Shared";
import {
  AERO_MINTER_EVENT_KIND,
  AeroContractStateId,
  AeroEventId,
  AeroSnapshotId,
} from "./AeroConstants";

/**
 * Aero Minter on Base (ADR 0006). AERO is minted lazily: the Minter mints
 * only when the root Voter processes a redemption (every Base claim, and each
 * leaf chain's xAERO redemption), plus the team share to the Splitter. Mints
 * (hundreds of thousands a day) are summed on AeroMinterState and its hourly
 * snapshot; configuration changes get one AeroMinterEvent row each.
 */

/**
 * Reads the Minter state, or builds an empty one.
 *
 * @param chainId - Chain of the Minter
 * @param minter - Minter address
 * @param timestamp - Block time for a new row
 * @param context - Handler context
 * @returns The Minter state (not persisted)
 */
async function loadOrCreateMinterState(
  chainId: number,
  minter: string,
  timestamp: Date,
  context: handlerContext,
): Promise<AeroMinterState> {
  const existing = await getRehydrated(
    context.AeroMinterState,
    "AeroMinterState",
    AeroContractStateId(chainId, minter),
  );
  return (
    existing ?? {
      id: AeroContractStateId(chainId, minter),
      chainId,
      minter,
      baseRate: undefined,
      dynamicRate: undefined,
      teamRate: undefined,
      bandFloorPips: undefined,
      bandCeilingPips: undefined,
      maxBaseRateChangePips: undefined,
      baseRateUpdateCooldown: undefined,
      operator: undefined,
      fed: undefined,
      dynamicRateModule: undefined,
      totalMinted: 0n,
      totalSplitterShare: 0n,
      numberOfMints: 0n,
      lastUpdatedTimestamp: timestamp,
      lastSnapshotTimestamp: undefined,
    }
  );
}

/**
 * Applies a change to the Minter state and stages it with its hourly snapshot.
 *
 * @param event - Minter event (coordinates)
 * @param patch - Builds the change from the current state
 * @param context - Handler context
 * @returns Promise that resolves once the state (and snapshot) are staged
 */
async function updateMinterState(
  event: {
    chainId: number;
    srcAddress: string;
    block: { timestamp: number };
  },
  patch: (current: AeroMinterState) => Partial<AeroMinterState>,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);
  const current = await loadOrCreateMinterState(
    event.chainId,
    event.srcAddress,
    timestamp,
    context,
  );
  let next: AeroMinterState = {
    ...current,
    ...patch(current),
    lastUpdatedTimestamp: timestamp,
  };
  if (shouldSnapshot(next.lastSnapshotTimestamp, timestamp)) {
    const epoch = getSnapshotEpoch(timestamp);
    context.AeroMinterSnapshot.set({
      id: AeroSnapshotId(next.id, epoch.getTime()),
      chainId: next.chainId,
      timestamp: epoch,
      baseRate: next.baseRate,
      dynamicRate: next.dynamicRate,
      teamRate: next.teamRate,
      totalMinted: next.totalMinted,
      totalSplitterShare: next.totalSplitterShare,
      numberOfMints: next.numberOfMints,
    });
    next = { ...next, lastSnapshotTimestamp: epoch };
  }
  context.AeroMinterState.set(next);
}

/**
 * Writes one AeroMinterEvent row.
 *
 * @param event - Minter event (coordinates)
 * @param kind - Change kind
 * @param values - New value(s) or address
 * @param values.value - Numeric value
 * @param values.value2 - Second numeric value (band ceiling)
 * @param values.address - New address
 * @param context - Handler context
 * @returns Nothing; the row is staged
 */
function writeMinterEvent(
  event: {
    chainId: number;
    logIndex: number;
    block: { number: number; timestamp: number };
    transaction: { hash: string };
  },
  kind: string,
  values: { value?: bigint; value2?: bigint; address?: string },
  context: handlerContext,
): void {
  context.AeroMinterEvent.set({
    id: AeroEventId(event.chainId, event.transaction.hash, event.logIndex),
    chainId: event.chainId,
    kind,
    value: values.value,
    value2: values.value2,
    address: values.address,
    blockNumber: BigInt(event.block.number),
    timestamp: new Date(event.block.timestamp * 1000),
    transactionHash: event.transaction.hash,
  });
}

indexer.onEvent(
  { contract: "AeroMinter", event: "Minted" },
  async ({ event, context }) => {
    await updateMinterState(
      event,
      (c) => ({
        totalMinted: c.totalMinted + event.params.amount,
        totalSplitterShare: c.totalSplitterShare + event.params.splitterShare,
        numberOfMints: c.numberOfMints + 1n,
      }),
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroMinter", event: "BaseRateSet" },
  async ({ event, context }) => {
    writeMinterEvent(
      event,
      AERO_MINTER_EVENT_KIND.BASE_RATE_SET,
      { value: event.params.baseRate },
      context,
    );
    await updateMinterState(
      event,
      () => ({ baseRate: event.params.baseRate }),
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroMinter", event: "DynamicRateSet" },
  async ({ event, context }) => {
    writeMinterEvent(
      event,
      AERO_MINTER_EVENT_KIND.DYNAMIC_RATE_SET,
      { value: event.params.rate },
      context,
    );
    await updateMinterState(
      event,
      () => ({ dynamicRate: event.params.rate }),
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroMinter", event: "TeamRateSet" },
  async ({ event, context }) => {
    const value = BigInt(event.params.teamRate);
    writeMinterEvent(
      event,
      AERO_MINTER_EVENT_KIND.TEAM_RATE_SET,
      { value },
      context,
    );
    await updateMinterState(event, () => ({ teamRate: value }), context);
  },
);

indexer.onEvent(
  { contract: "AeroMinter", event: "RateBandSet" },
  async ({ event, context }) => {
    const floor = BigInt(event.params.floorPips);
    const ceiling = BigInt(event.params.ceilingPips);
    writeMinterEvent(
      event,
      AERO_MINTER_EVENT_KIND.RATE_BAND_SET,
      { value: floor, value2: ceiling },
      context,
    );
    await updateMinterState(
      event,
      () => ({ bandFloorPips: floor, bandCeilingPips: ceiling }),
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroMinter", event: "MaxBaseRateChangePipsSet" },
  async ({ event, context }) => {
    const value = BigInt(event.params.maxBaseRateChangePips);
    writeMinterEvent(
      event,
      AERO_MINTER_EVENT_KIND.MAX_BASE_RATE_CHANGE_PIPS_SET,
      { value },
      context,
    );
    await updateMinterState(
      event,
      () => ({ maxBaseRateChangePips: value }),
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroMinter", event: "BaseRateUpdateCooldownSet" },
  async ({ event, context }) => {
    const value = BigInt(event.params.baseRateUpdateCooldown);
    writeMinterEvent(
      event,
      AERO_MINTER_EVENT_KIND.BASE_RATE_UPDATE_COOLDOWN_SET,
      { value },
      context,
    );
    await updateMinterState(
      event,
      () => ({ baseRateUpdateCooldown: value }),
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroMinter", event: "OperatorSet" },
  async ({ event, context }) => {
    writeMinterEvent(
      event,
      AERO_MINTER_EVENT_KIND.OPERATOR_SET,
      { address: event.params.operator },
      context,
    );
    await updateMinterState(
      event,
      () => ({ operator: event.params.operator }),
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroMinter", event: "FEDSet" },
  async ({ event, context }) => {
    writeMinterEvent(
      event,
      AERO_MINTER_EVENT_KIND.FED_SET,
      { address: event.params.fed },
      context,
    );
    await updateMinterState(event, () => ({ fed: event.params.fed }), context);
  },
);

indexer.onEvent(
  { contract: "AeroMinter", event: "DynamicRateModuleSet" },
  async ({ event, context }) => {
    writeMinterEvent(
      event,
      AERO_MINTER_EVENT_KIND.DYNAMIC_RATE_MODULE_SET,
      { address: event.params.module },
      context,
    );
    await updateMinterState(
      event,
      () => ({ dynamicRateModule: event.params.module }),
      context,
    );
  },
);
