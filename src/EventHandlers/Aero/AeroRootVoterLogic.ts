import type { AeroRootAllocation, AeroRootChainState } from "envio";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import {
  AERO_ALLOCATION_LEVEL,
  AERO_CHAIN0,
  type AERO_REDEMPTION_EVENT_KIND,
  AeroEventId,
  AeroRootAllocationId,
  AeroRootChainStateId,
} from "./AeroConstants";

/**
 * Root Voter (Base) ledger of sAERO voting power per chain (ADR 0006).
 *
 * `AeroRootAllocation` mirrors `Voter.allocationChainAmounts(tokenId, chainId)`:
 * stake parks on CHAIN0 (ParkedOnChain0), ChainsAllocated moves it from CHAIN0
 * to chains, a confirmed leaf deallocation (DeallocationProcessed) or an
 * emergency drain (EmergencyDeallocated) moves it back, Chain0Rebalanced moves
 * CHAIN0 power between positions with their stake, Burned removes TOKEN0's
 * burned permanent power, and TokenCleared drops a withdrawn position's rows.
 * Every move is one signed AeroAllocationEvent row per (position, chain).
 * All rows are Base's; the leaves' own books are separate (AeroLeafTokenState).
 */

/** Coordinates of one root Voter event. */
export interface RootEventContext {
  chainId: number;
  blockNumber: number;
  timestamp: number;
  transactionHash: string;
  logIndex: number;
}

/**
 * Reads a root per-chain ledger row, or builds an empty one.
 *
 * @param chainId - Chain of the root Voter
 * @param targetChainId - Chain (0 = CHAIN0)
 * @param timestamp - Block time for a new row
 * @param context - Handler context
 * @returns The ledger row (not persisted)
 */
export async function loadOrCreateRootChainState(
  chainId: number,
  targetChainId: number,
  timestamp: Date,
  context: handlerContext,
): Promise<AeroRootChainState> {
  const existing = await getRehydrated(
    context.AeroRootChainState,
    "AeroRootChainState",
    AeroRootChainStateId(chainId, targetChainId),
  );
  return (
    existing ?? {
      id: AeroRootChainStateId(chainId, targetChainId),
      chainId,
      targetChainId,
      isRegistered: targetChainId === AERO_CHAIN0,
      status: undefined,
      emergencyDeallocationAllowed: false,
      totalAllocated: 0n,
      totalRedeemed: 0n,
      numberOfRedemptions: 0n,
      reportedSurplus: 0n,
      totalDonated: 0n,
      totalBufferDrawn: 0n,
      totalSurplusSpent: 0n,
      totalBurned: 0n,
      lastUpdatedTimestamp: timestamp,
    }
  );
}

/**
 * Reads a position's booked power on a chain, or builds a zero row.
 *
 * @param chainId - Chain of the root Voter
 * @param tokenId - sAERO position
 * @param targetChainId - Chain (0 = CHAIN0)
 * @param timestamp - Block time for a new row
 * @param context - Handler context
 * @returns The allocation row (not persisted)
 */
async function loadOrCreateRootAllocation(
  chainId: number,
  tokenId: bigint,
  targetChainId: number,
  timestamp: Date,
  context: handlerContext,
): Promise<AeroRootAllocation> {
  const existing = await getRehydrated(
    context.AeroRootAllocation,
    "AeroRootAllocation",
    AeroRootAllocationId(chainId, tokenId, targetChainId),
  );
  return (
    existing ?? {
      id: AeroRootAllocationId(chainId, tokenId, targetChainId),
      chainId,
      tokenId,
      targetChainId,
      amount: 0n,
      lastUpdatedTimestamp: timestamp,
    }
  );
}

/** One signed move of a position's booked power on a chain. */
export interface RootLedgerMove {
  tokenId: bigint;
  targetChainId: number;
  /** Signed AERO amount; `undefined` = set to 0 (TokenCleared). */
  delta: bigint | undefined;
}

/**
 * Applies signed moves to AeroRootAllocation and the per-chain totals, and
 * writes one AeroAllocationEvent row per non-zero move. Moves on the same
 * (position, chain) apply in order; all reads are issued up front by primary
 * key (moves are bounded by the event's arrays).
 *
 * @param ev - Event coordinates
 * @param kind - AeroAllocationEvent kind
 * @param moves - Moves to apply
 * @param context - Handler context
 * @param chainPatch - Optional extra change to each touched per-chain row
 * @returns Promise that resolves once rows and totals are staged
 */
export async function applyRootLedgerMoves(
  ev: RootEventContext,
  kind: string,
  moves: readonly RootLedgerMove[],
  context: handlerContext,
  chainPatch?: (chain: AeroRootChainState) => Partial<AeroRootChainState>,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  const allocationKeys = [
    ...new Set(moves.map((m) => `${m.tokenId}|${m.targetChainId}`)),
  ];
  const chainKeys = [...new Set(moves.map((m) => m.targetChainId))];
  const [allocationRows, chainRows] = await Promise.all([
    Promise.all(
      allocationKeys.map((k) => {
        const [tokenId, target] = k.split("|");
        return loadOrCreateRootAllocation(
          ev.chainId,
          BigInt(tokenId),
          Number(target),
          timestamp,
          context,
        );
      }),
    ),
    Promise.all(
      chainKeys.map((target) =>
        loadOrCreateRootChainState(ev.chainId, target, timestamp, context),
      ),
    ),
  ]);
  const allocations = new Map(
    allocationKeys.map((k, i) => [k, allocationRows[i]]),
  );
  const chains = new Map(chainKeys.map((c, i) => [c, chainRows[i]]));

  moves.forEach((move, leg) => {
    const key = `${move.tokenId}|${move.targetChainId}`;
    const row = allocations.get(key) as AeroRootAllocation;
    const chain = chains.get(move.targetChainId) as AeroRootChainState;
    const delta = move.delta ?? -row.amount;
    if (delta === 0n) return;
    allocations.set(key, {
      ...row,
      amount: row.amount + delta,
      lastUpdatedTimestamp: timestamp,
    });
    chains.set(move.targetChainId, {
      ...chain,
      isRegistered: true,
      totalAllocated: chain.totalAllocated + delta,
      lastUpdatedTimestamp: timestamp,
    });
    context.AeroAllocationEvent.set({
      id: AeroEventId(ev.chainId, ev.transactionHash, ev.logIndex, leg),
      chainId: ev.chainId,
      level: AERO_ALLOCATION_LEVEL.ROOT,
      kind,
      tokenId: move.tokenId,
      targetChainId: move.targetChainId,
      gaugeAddress: undefined,
      amount: delta,
      bookedAmount: undefined,
      chainAllocationAfter: undefined,
      emissionsPerVP: undefined,
      blockNumber: BigInt(ev.blockNumber),
      timestamp,
      transactionHash: ev.transactionHash,
    });
  });
  for (const row of allocations.values()) context.AeroRootAllocation.set(row);
  for (const chain of chains.values()) {
    context.AeroRootChainState.set(
      chainPatch ? { ...chain, ...chainPatch(chain) } : chain,
    );
  }
}

/**
 * Applies a change to one root per-chain ledger row (redemption totals,
 * status, registration, buffer, surplus).
 *
 * @param ev - Event coordinates
 * @param targetChainId - Chain (0 = CHAIN0)
 * @param patch - Builds the new row from the current one
 * @param context - Handler context
 * @returns Promise that resolves once the row is staged
 */
export async function patchRootChainState(
  ev: RootEventContext,
  targetChainId: number,
  patch: (current: AeroRootChainState) => Partial<AeroRootChainState>,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  const current = await loadOrCreateRootChainState(
    ev.chainId,
    targetChainId,
    timestamp,
    context,
  );
  context.AeroRootChainState.set({
    ...current,
    ...patch(current),
    lastUpdatedTimestamp: timestamp,
  });
}

/**
 * Writes one AeroRedemptionEvent row of the root side.
 *
 * @param ev - Event coordinates
 * @param kind - PROCESSED, DEFERRED, BUFFER_DRAWN, DONATED or SURPLUS_SPENT
 * @param sourceChainId - Chain whose redemption / pot it concerns
 * @param recipient - AERO recipient, when there is one
 * @param amount - AERO amount
 * @param surplusReported - PROCESSED: the reported surplus after the redeem
 * @param context - Handler context
 * @returns Nothing; the row is staged
 */
export function writeRootRedemptionEvent(
  ev: RootEventContext,
  kind: (typeof AERO_REDEMPTION_EVENT_KIND)[keyof typeof AERO_REDEMPTION_EVENT_KIND],
  sourceChainId: number,
  recipient: string | undefined,
  amount: bigint,
  surplusReported: bigint | undefined,
  context: handlerContext,
): void {
  context.AeroRedemptionEvent.set({
    id: AeroEventId(ev.chainId, ev.transactionHash, ev.logIndex),
    chainId: ev.chainId,
    kind,
    sourceChainId,
    redeemer: undefined,
    recipient,
    amount,
    surplusReported,
    blockNumber: BigInt(ev.blockNumber),
    timestamp: new Date(ev.timestamp * 1000),
    transactionHash: ev.transactionHash,
  });
}
