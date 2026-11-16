import { indexer } from "envio";
import {
  AERO_ALLOCATION_EVENT_KIND,
  AERO_ALLOCATION_LEVEL,
  AERO_CHAIN0,
  AERO_REDEMPTION_EVENT_KIND,
  AERO_ROOT_CHAIN_ID,
  AeroEventId,
  AeroRootAllocationId,
} from "./AeroConstants";
import {
  type RootEventContext,
  applyRootLedgerMoves,
  patchRootChainState,
  writeRootRedemptionEvent,
} from "./AeroRootVoterLogic";

/**
 * Aero root Voter on Base (ADR 0006): the per-chain ledger of sAERO voting
 * power (AeroRootAllocation), the gauge splits it dispatches to each chain
 * (AeroRootGaugeVote), per-chain redemption and surplus totals
 * (AeroRootChainState) and the processed redemptions. Also Base's
 * RootEmissionsHandler (redemptions it had to defer).
 *
 * RedeemProcessed fires for every Base claim (the RootEmissionsHandler redeems
 * each one locally, hundreds of thousands a day); those are counted on the
 * Base row of AeroRootChainState but get no AeroRedemptionEvent row, which is
 * kept for cross-chain redemptions.
 */

function rootContext(event: {
  chainId: number;
  block: { number: number; timestamp: number };
  transaction: { hash: string };
  logIndex: number;
}): RootEventContext {
  return {
    chainId: event.chainId,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  };
}

indexer.onEvent(
  { contract: "AeroVoter", event: "ParkedOnChain0" },
  async ({ event, context }) => {
    await applyRootLedgerMoves(
      rootContext(event),
      AERO_ALLOCATION_EVENT_KIND.PARKED,
      [
        {
          tokenId: event.params.tokenId,
          targetChainId: AERO_CHAIN0,
          delta: event.params.amount,
        },
      ],
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "ChainsAllocated" },
  async ({ event, context }) => {
    const { tokenId, allocations } = event.params;
    const total = allocations.reduce((sum, a) => sum + a.delta, 0n);
    await applyRootLedgerMoves(
      rootContext(event),
      AERO_ALLOCATION_EVENT_KIND.CHAIN_ALLOCATED,
      [
        // CHAIN0 gives up the whole delta, redeployed onto the listed chains.
        { tokenId, targetChainId: AERO_CHAIN0, delta: -total },
        ...allocations.map((a) => ({
          tokenId,
          targetChainId: Number(a.chainId),
          delta: a.delta,
        })),
      ],
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "GaugesAllocated" },
  async ({ event, context }) => {
    const { tokenId, chainId: target, gauges } = event.params;
    const ev = rootContext(event);
    const timestamp = new Date(ev.timestamp * 1000);
    const targetChainId = Number(target);
    context.AeroRootGaugeVote.set({
      id: AeroRootAllocationId(ev.chainId, tokenId, targetChainId),
      tokenId,
      targetChainId,
      gauges: gauges.map((g) => g.gauge),
      amounts: gauges.map((g) => g.allocated),
      lastDispatchedTimestamp: timestamp,
      transactionHash: ev.transactionHash,
    });
    gauges.forEach((g, leg) => {
      context.AeroAllocationEvent.set({
        id: AeroEventId(ev.chainId, ev.transactionHash, ev.logIndex, leg),
        level: AERO_ALLOCATION_LEVEL.ROOT,
        kind: AERO_ALLOCATION_EVENT_KIND.GAUGES_DISPATCHED,
        tokenId,
        targetChainId,
        gaugeAddress: g.gauge,
        amount: g.allocated,
        bookedAmount: undefined,
        chainAllocationAfter: undefined,
        emissionsPerVP: undefined,
        blockNumber: BigInt(ev.blockNumber),
        timestamp,
        transactionHash: ev.transactionHash,
      });
    });
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "DeallocationProcessed" },
  async ({ event, context }) => {
    const { chainId, tokenId, amount } = event.params;
    await applyRootLedgerMoves(
      rootContext(event),
      AERO_ALLOCATION_EVENT_KIND.DEALLOCATION_PROCESSED,
      [
        { tokenId, targetChainId: Number(chainId), delta: -amount },
        { tokenId, targetChainId: AERO_CHAIN0, delta: amount },
      ],
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "EmergencyDeallocated" },
  async ({ event, context }) => {
    const { chainId, tokenId, amount } = event.params;
    await applyRootLedgerMoves(
      rootContext(event),
      AERO_ALLOCATION_EVENT_KIND.EMERGENCY_DEALLOCATED,
      [
        { tokenId, targetChainId: Number(chainId), delta: -amount },
        { tokenId, targetChainId: AERO_CHAIN0, delta: amount },
      ],
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "TokenCleared" },
  async ({ event, context }) => {
    const { tokenId, clearedChains } = event.params;
    await applyRootLedgerMoves(
      rootContext(event),
      AERO_ALLOCATION_EVENT_KIND.TOKEN_CLEARED,
      clearedChains.map((c) => ({
        tokenId,
        targetChainId: Number(c),
        delta: undefined,
      })),
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "Chain0Rebalanced" },
  async ({ event, context }) => {
    const { sources, destinations } = event.params;
    await applyRootLedgerMoves(
      rootContext(event),
      AERO_ALLOCATION_EVENT_KIND.CHAIN0_REBALANCED,
      [
        ...sources.map((s) => ({
          tokenId: s.tokenId,
          targetChainId: AERO_CHAIN0,
          delta: -s.amount,
        })),
        // Destination tokenIds are already resolved (mints included); 0 = TOKEN0.
        ...destinations.map((d) => ({
          tokenId: d.tokenId,
          targetChainId: AERO_CHAIN0,
          delta: d.amount,
        })),
      ],
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "Burned" },
  async ({ event, context }) => {
    await applyRootLedgerMoves(
      rootContext(event),
      AERO_ALLOCATION_EVENT_KIND.BURNED,
      [
        {
          tokenId: 0n,
          targetChainId: AERO_CHAIN0,
          delta: -event.params.amount,
        },
      ],
      context,
      (c) => ({ totalBurned: c.totalBurned + event.params.amount }),
    );
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "RedeemProcessed" },
  async ({ event, context }) => {
    const ev = rootContext(event);
    const { chainId, recipient, amount, surplusReported } = event.params;
    const source = Number(chainId);
    await patchRootChainState(
      ev,
      source,
      (c) => ({
        totalRedeemed: c.totalRedeemed + amount,
        numberOfRedemptions: c.numberOfRedemptions + 1n,
        reportedSurplus: surplusReported,
      }),
      context,
    );
    if (source !== AERO_ROOT_CHAIN_ID) {
      writeRootRedemptionEvent(
        ev,
        AERO_REDEMPTION_EVENT_KIND.PROCESSED,
        source,
        recipient,
        amount,
        surplusReported,
        context,
      );
    }
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "Donated" },
  async ({ event, context }) => {
    const ev = rootContext(event);
    const source = Number(event.params.chainId);
    await patchRootChainState(
      ev,
      source,
      (c) => ({ totalDonated: c.totalDonated + event.params.amount }),
      context,
    );
    writeRootRedemptionEvent(
      ev,
      AERO_REDEMPTION_EVENT_KIND.DONATED,
      source,
      event.params.donor,
      event.params.amount,
      undefined,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "BufferDrawn" },
  async ({ event, context }) => {
    const ev = rootContext(event);
    const source = Number(event.params.chainId);
    await patchRootChainState(
      ev,
      source,
      (c) => ({ totalBufferDrawn: c.totalBufferDrawn + event.params.amount }),
      context,
    );
    writeRootRedemptionEvent(
      ev,
      AERO_REDEMPTION_EVENT_KIND.BUFFER_DRAWN,
      source,
      undefined,
      event.params.amount,
      undefined,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "SurplusSpent" },
  async ({ event, context }) => {
    const ev = rootContext(event);
    const source = Number(event.params.chainId);
    await patchRootChainState(
      ev,
      source,
      (c) => ({
        totalSurplusSpent: c.totalSurplusSpent + event.params.amount,
      }),
      context,
    );
    writeRootRedemptionEvent(
      ev,
      AERO_REDEMPTION_EVENT_KIND.SURPLUS_SPENT,
      source,
      event.params.recipient,
      event.params.amount,
      undefined,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "ChainRegistered" },
  async ({ event, context }) => {
    await patchRootChainState(
      rootContext(event),
      Number(event.params.chainId),
      () => ({ isRegistered: true }),
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "ChainStatusSet" },
  async ({ event, context }) => {
    await patchRootChainState(
      rootContext(event),
      Number(event.params.chainId),
      () => ({ status: Number(event.params.status) }),
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVoter", event: "EmergencyDeallocationAllowedSet" },
  async ({ event, context }) => {
    await patchRootChainState(
      rootContext(event),
      Number(event.params.chainId),
      () => ({ emergencyDeallocationAllowed: event.params.allowed }),
      context,
    );
  },
);

// Base's RootEmissionsHandler: a claim's redemption it could not complete at
// once (paid later); one row each.
indexer.onEvent(
  { contract: "AeroRootEmissionsHandler", event: "RedeemDeferred" },
  async ({ event, context }) => {
    writeRootRedemptionEvent(
      rootContext(event),
      AERO_REDEMPTION_EVENT_KIND.DEFERRED,
      event.chainId,
      event.params.recipient,
      event.params.amount,
      undefined,
      context,
    );
  },
);
