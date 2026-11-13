import type { AeroGauge, AeroLeafTokenState } from "envio";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import {
  AERO_ALLOCATION_EVENT_KIND,
  AERO_ALLOCATION_LEVEL,
  AERO_DEALLOC_GAUGE,
  AERO_ZERO_GAUGE,
  AeroEventId,
  AeroLeafAllocationId,
  AeroLeafTokenStateId,
} from "./AeroConstants";
import {
  loadAeroGauge,
  loadOrCreateLeafVoterState,
  persistAeroGauge,
  persistLeafVoterState,
} from "./AeroGaugeLogic";

/**
 * LeafVoter allocations (every Aero chain, Base included; ADR 0006).
 *
 * A position's budget on a chain arrives as ChainAllocated (the event carries
 * the resulting budget). GaugesAllocated (bridged from the root Voter, or a
 * local re-split by the position's operator) lists the requested split; the
 * LeafVoter books an entry only on a registered, activated gauge with a
 * non-zero emission cap (a zero cap is allowed for positions flagged
 * CanVoteForZeroCapGauges), parks the rest of the budget idle on the zero
 * gauge, returns the dealloc sentinel's amount to root (taken off the budget
 * at once) and drops gauges missing from the list. This module replays that
 * rule from indexed state: every input (the gauges' registration, activation
 * and cap, the position's flag and previous split) is on the event's chain.
 *
 * Not replayed: the LeafVoter also parks an entry whose position's stake has
 * already expired, or whose decaying weight rounds to zero (under 1.26e-10
 * AERO); the event carries no stake shape, so such entries are booked here.
 */

/**
 * Reads a position's state on this chain, or builds an empty one.
 *
 * @param chainId - Chain of the LeafVoter
 * @param tokenId - sAERO position
 * @param timestamp - Block time for a new row
 * @param context - Handler context
 * @returns The token state (not persisted)
 */
export async function loadOrCreateLeafTokenState(
  chainId: number,
  tokenId: bigint,
  timestamp: Date,
  context: handlerContext,
): Promise<AeroLeafTokenState> {
  const existing = await getRehydrated(
    context.AeroLeafTokenState,
    "AeroLeafTokenState",
    AeroLeafTokenStateId(chainId, tokenId),
  );
  return (
    existing ?? {
      id: AeroLeafTokenStateId(chainId, tokenId),
      chainId,
      tokenId,
      chainAllocation: 0n,
      gauges: [],
      allocations: [],
      idleAllocation: 0n,
      operator: undefined,
      canVoteForZeroCapGauges: false,
      lastAllocatedTimestamp: undefined,
      lastUpdatedTimestamp: timestamp,
    }
  );
}

/**
 * Whether the LeafVoter routes an allocation onto `gauge`: registered,
 * activated, and a non-zero emission cap unless the position may vote for
 * zero-cap gauges. An unknown gauge (not created by an indexed factory) is
 * unroutable, as an unregistered gauge is on-chain.
 *
 * @param gauge - The gauge row, if any
 * @param canVoteForZeroCapGauges - The position's zero-cap flag
 * @returns True when an allocation to the gauge is booked
 */
export function isRoutable(
  gauge: AeroGauge | undefined,
  canVoteForZeroCapGauges: boolean,
): boolean {
  if (!gauge || !gauge.isRegistered || !gauge.isActivated) return false;
  return canVoteForZeroCapGauges || gauge.emissionCap !== 0n;
}

/** Coordinates of one LeafVoter event. */
export interface LeafEventContext {
  chainId: number;
  blockNumber: number;
  timestamp: number;
  transactionHash: string;
  logIndex: number;
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}

/**
 * ChainAllocated: the position's budget on this chain is now
 * `chainAllocation` (the root added `allocationDelta`); the addition parks
 * idle until a gauge split books it.
 *
 * @param ev - Event coordinates
 * @param tokenId - sAERO position
 * @param allocationDelta - Budget added
 * @param chainAllocation - Budget after the message
 * @param emissionsPerVP - The LeafVoter's scalar after the message
 * @param context - Handler context
 * @returns Promise that resolves once the token state, chain totals and row are staged
 */
export async function processLeafChainAllocated(
  ev: LeafEventContext,
  tokenId: bigint,
  allocationDelta: bigint,
  chainAllocation: bigint,
  emissionsPerVP: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  const [token, state] = await Promise.all([
    loadOrCreateLeafTokenState(ev.chainId, tokenId, timestamp, context),
    loadOrCreateLeafVoterState(ev.chainId, timestamp, context),
  ]);
  context.AeroLeafTokenState.set({
    ...token,
    chainAllocation,
    idleAllocation: chainAllocation - sum(token.allocations),
    lastUpdatedTimestamp: timestamp,
  });
  persistLeafVoterState(
    {
      ...state,
      emissionsPerVP,
      totalChainAllocation:
        state.totalChainAllocation + chainAllocation - token.chainAllocation,
    },
    timestamp,
    context,
  );
  context.AeroAllocationEvent.set({
    id: AeroEventId(ev.chainId, ev.transactionHash, ev.logIndex),
    chainId: ev.chainId,
    level: AERO_ALLOCATION_LEVEL.LEAF,
    kind: AERO_ALLOCATION_EVENT_KIND.CHAIN_ALLOCATED,
    tokenId,
    targetChainId: ev.chainId,
    gaugeAddress: undefined,
    amount: allocationDelta,
    bookedAmount: undefined,
    chainAllocationAfter: chainAllocation,
    emissionsPerVP,
    blockNumber: BigInt(ev.blockNumber),
    timestamp,
    transactionHash: ev.transactionHash,
  });
}

/**
 * Rebooks a position's gauges from `before` to `after` (gauge → AERO):
 * gauge totals, AeroLeafAllocation rows and the token state. Gauge rows are
 * read by primary key in parallel; the set is bounded by the LeafVoter's
 * `maxGauges` per side.
 *
 * @param ev - Event coordinates
 * @param token - Token state before the change
 * @param after - Booked split after the change
 * @param gaugeRows - Gauge rows already loaded, by address
 * @param timestamp - Block time
 * @param context - Handler context
 * @returns Change of the booked total (after minus before)
 */
function rebook(
  token: AeroLeafTokenState,
  after: Map<string, bigint>,
  gaugeRows: Map<string, AeroGauge | undefined>,
  timestamp: Date,
  context: handlerContext,
): bigint {
  const before = new Map(
    token.gauges.map((g, i) => [g, token.allocations[i] ?? 0n] as const),
  );
  const touched = new Set([...before.keys(), ...after.keys()]);
  for (const gaugeAddress of touched) {
    const oldAmount = before.get(gaugeAddress) ?? 0n;
    const newAmount = after.get(gaugeAddress) ?? 0n;
    if (oldAmount === newAmount) continue;
    const gauge = gaugeRows.get(gaugeAddress);
    context.AeroLeafAllocation.set({
      id: AeroLeafAllocationId(token.chainId, token.tokenId, gaugeAddress),
      chainId: token.chainId,
      tokenId: token.tokenId,
      gaugeAddress,
      poolAddress: gauge?.poolAddress,
      allocated: newAmount,
      lastUpdatedTimestamp: timestamp,
    });
    if (gauge) {
      const updated = {
        ...gauge,
        totalAllocated: gauge.totalAllocated + newAmount - oldAmount,
      };
      gaugeRows.set(gaugeAddress, updated);
      persistAeroGauge(updated, timestamp, context);
    }
  }
  return sum([...after.values()]) - sum([...before.values()]);
}

/**
 * GaugesAllocated: the LeafVoter applied a gauge split for the position (see
 * the module comment for the booking rule). Writes one GAUGE_ALLOCATED row per
 * listed entry (requested amount and what was booked) and per dropped gauge.
 *
 * @param ev - Event coordinates
 * @param tokenId - sAERO position
 * @param allocations - Requested split (gauge, AERO)
 * @param emissionsPerVP - The LeafVoter's scalar after the call
 * @param context - Handler context
 * @returns Promise that resolves once all rows and totals are staged
 */
export async function processLeafGaugesAllocated(
  ev: LeafEventContext,
  tokenId: bigint,
  allocations: readonly { gauge: string; allocated: bigint }[],
  emissionsPerVP: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  const [token, state] = await Promise.all([
    loadOrCreateLeafTokenState(ev.chainId, tokenId, timestamp, context),
    loadOrCreateLeafVoterState(ev.chainId, timestamp, context),
  ]);
  const listed = allocations
    .map((a) => a.gauge)
    .filter((g) => g !== AERO_ZERO_GAUGE && g !== AERO_DEALLOC_GAUGE);
  const addresses = [...new Set([...listed, ...token.gauges])];
  const loaded = await Promise.all(
    addresses.map((g) => loadAeroGauge(ev.chainId, g, context)),
  );
  const gaugeRows = new Map(addresses.map((g, i) => [g, loaded[i]]));

  let dealloc = 0n;
  const booked = new Map<string, bigint>();
  for (const a of allocations) {
    if (a.gauge === AERO_DEALLOC_GAUGE) {
      dealloc += a.allocated;
    } else if (
      a.gauge !== AERO_ZERO_GAUGE &&
      a.allocated > 0n &&
      isRoutable(gaugeRows.get(a.gauge), token.canVoteForZeroCapGauges)
    ) {
      booked.set(a.gauge, a.allocated);
    }
  }

  const previous = new Map(
    token.gauges.map((g, i) => [g, token.allocations[i] ?? 0n] as const),
  );
  const bookedDelta = rebook(token, booked, gaugeRows, timestamp, context);
  const chainAllocation = token.chainAllocation - dealloc;
  context.AeroLeafTokenState.set({
    ...token,
    chainAllocation,
    gauges: [...booked.keys()],
    allocations: [...booked.values()],
    idleAllocation: chainAllocation - sum([...booked.values()]),
    lastAllocatedTimestamp: timestamp,
    lastUpdatedTimestamp: timestamp,
  });
  persistLeafVoterState(
    {
      ...state,
      emissionsPerVP,
      totalChainAllocation: state.totalChainAllocation - dealloc,
      totalBookedAllocation: state.totalBookedAllocation + bookedDelta,
    },
    timestamp,
    context,
  );

  // Rows: every listed entry, then every gauge the split dropped.
  const rowBase = {
    chainId: ev.chainId,
    level: AERO_ALLOCATION_LEVEL.LEAF,
    kind: AERO_ALLOCATION_EVENT_KIND.GAUGE_ALLOCATED,
    tokenId,
    targetChainId: ev.chainId,
    chainAllocationAfter: chainAllocation,
    emissionsPerVP,
    blockNumber: BigInt(ev.blockNumber),
    timestamp,
    transactionHash: ev.transactionHash,
  };
  let leg = 0;
  for (const a of allocations) {
    context.AeroAllocationEvent.set({
      ...rowBase,
      id: AeroEventId(ev.chainId, ev.transactionHash, ev.logIndex, leg++),
      gaugeAddress: a.gauge,
      amount: a.allocated,
      bookedAmount: booked.get(a.gauge) ?? 0n,
    });
  }
  const listedSet = new Set(allocations.map((a) => a.gauge));
  for (const [gaugeAddress] of previous) {
    if (listedSet.has(gaugeAddress)) continue;
    context.AeroAllocationEvent.set({
      ...rowBase,
      id: AeroEventId(ev.chainId, ev.transactionHash, ev.logIndex, leg++),
      gaugeAddress,
      amount: 0n,
      bookedAmount: 0n,
    });
  }
}

/**
 * EmergencyDeallocationApplied: root drained the position from this
 * (suspended) chain; the LeafVoter cleared its gauges and re-parked the rest
 * of the budget idle. The drained amount is not in the event, so the budget
 * keeps its last value until the next ChainAllocated (which carries the
 * resulting budget) and a warning is logged.
 *
 * @param ev - Event coordinates
 * @param tokenId - sAERO position
 * @param context - Handler context
 * @returns Promise that resolves once the gauges, token state and row are staged
 */
export async function processLeafEmergencyDeallocationApplied(
  ev: LeafEventContext,
  tokenId: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  const [token, state] = await Promise.all([
    loadOrCreateLeafTokenState(ev.chainId, tokenId, timestamp, context),
    loadOrCreateLeafVoterState(ev.chainId, timestamp, context),
  ]);
  const loaded = await Promise.all(
    token.gauges.map((g) => loadAeroGauge(ev.chainId, g, context)),
  );
  const gaugeRows = new Map(token.gauges.map((g, i) => [g, loaded[i]]));
  const bookedDelta = rebook(token, new Map(), gaugeRows, timestamp, context);
  context.AeroLeafTokenState.set({
    ...token,
    gauges: [],
    allocations: [],
    idleAllocation: token.chainAllocation,
    lastUpdatedTimestamp: timestamp,
  });
  persistLeafVoterState(
    {
      ...state,
      totalBookedAllocation: state.totalBookedAllocation + bookedDelta,
    },
    timestamp,
    context,
  );
  context.log.warn(
    `[AeroLeafVoter.EmergencyDeallocationApplied] position ${tokenId} on chain ${ev.chainId}: gauges cleared; the drained budget is not in the event and is corrected by the next ChainAllocated`,
  );
  context.AeroAllocationEvent.set({
    id: AeroEventId(ev.chainId, ev.transactionHash, ev.logIndex),
    chainId: ev.chainId,
    level: AERO_ALLOCATION_LEVEL.LEAF,
    kind: AERO_ALLOCATION_EVENT_KIND.EMERGENCY_DEALLOCATION_APPLIED,
    tokenId,
    targetChainId: ev.chainId,
    gaugeAddress: undefined,
    amount: 0n,
    bookedAmount: undefined,
    chainAllocationAfter: token.chainAllocation,
    emissionsPerVP: undefined,
    blockNumber: BigInt(ev.blockNumber),
    timestamp,
    transactionHash: ev.transactionHash,
  });
}

/**
 * Deallocated: power the position returned to root (already taken off its
 * budget by the GaugesAllocated that listed the dealloc sentinel). Row only.
 *
 * @param ev - Event coordinates
 * @param tokenId - sAERO position
 * @param amount - Power returned to root's CHAIN0
 * @param context - Handler context
 * @returns Nothing; the row is staged
 */
export function processLeafDeallocated(
  ev: LeafEventContext,
  tokenId: bigint,
  amount: bigint,
  context: handlerContext,
): void {
  context.AeroAllocationEvent.set({
    id: AeroEventId(ev.chainId, ev.transactionHash, ev.logIndex),
    chainId: ev.chainId,
    level: AERO_ALLOCATION_LEVEL.LEAF,
    kind: AERO_ALLOCATION_EVENT_KIND.DEALLOCATED,
    tokenId,
    targetChainId: ev.chainId,
    gaugeAddress: undefined,
    amount: -amount,
    bookedAmount: undefined,
    chainAllocationAfter: undefined,
    emissionsPerVP: undefined,
    blockNumber: BigInt(ev.blockNumber),
    timestamp: new Date(ev.timestamp * 1000),
    transactionHash: ev.transactionHash,
  });
}

/**
 * Applies a partial update to a position's state on this chain (operator,
 * zero-cap flag).
 *
 * @param ev - Event coordinates
 * @param tokenId - sAERO position
 * @param patch - Fields to set
 * @param context - Handler context
 * @returns Promise that resolves once the token state is staged
 */
export async function patchLeafTokenState(
  ev: LeafEventContext,
  tokenId: bigint,
  patch: Partial<
    Pick<AeroLeafTokenState, "operator" | "canVoteForZeroCapGauges">
  >,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  const token = await loadOrCreateLeafTokenState(
    ev.chainId,
    tokenId,
    timestamp,
    context,
  );
  context.AeroLeafTokenState.set({
    ...token,
    ...patch,
    lastUpdatedTimestamp: timestamp,
  });
}
