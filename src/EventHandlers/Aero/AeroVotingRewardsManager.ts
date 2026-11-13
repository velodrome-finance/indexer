import { indexer } from "envio";
import type { EvmEvent } from "envio";
import { TokenId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import { getTrustedUSD } from "../../PriceTrust";
import {
  AERO_VOTING_REWARDS_EVENT_KIND,
  AeroEventId,
  AeroIncentiveProgramId,
  AeroVotingRewardsManagerId,
} from "./AeroConstants";

/**
 * Aero VotingRewardsManager (one per gauge, registered by the GaugeManager's
 * GaugeCreated). FeesCollected: the staked liquidity's pool fees the manager
 * pulls from its gauge (one event per token). Allocator side: ClaimFees (an
 * sAERO position's share of those fees, per token), IncentiveCreated (a
 * program funded for the gauge's allocators), ClaimIncentives and
 * IncentiveSwept. Amounts are raw token units; USD uses the token's stored
 * price on this chain through the price-trust gate.
 */

/**
 * FeesCollected: one AeroVotingRewardsEvent row and the manager's totals.
 *
 * @param event - AeroVotingRewardsManager.FeesCollected
 * @param context - Handler context
 * @returns Promise that resolves once the row and the manager are staged
 */
export async function processFeesCollected(
  event: EvmEvent<"AeroVotingRewardsManager", "FeesCollected">,
  context: handlerContext,
): Promise<void> {
  const { gauge, token, amount } = event.params;
  const [manager, tokenRow] = await Promise.all([
    getRehydrated(
      context.AeroVotingRewardsManager,
      "AeroVotingRewardsManager",
      AeroVotingRewardsManagerId(event.chainId, event.srcAddress),
    ),
    getRehydrated(context.Token, "Token", TokenId(event.chainId, token)),
  ]);
  const timestamp = new Date(event.block.timestamp * 1000);
  const amountUSD = getTrustedUSD(amount, tokenRow);
  context.AeroVotingRewardsEvent.set({
    id: AeroEventId(event.chainId, event.transaction.hash, event.logIndex),
    chainId: event.chainId,
    kind: AERO_VOTING_REWARDS_EVENT_KIND.FEES_COLLECTED,
    votingRewardsManager: event.srcAddress,
    gaugeAddress: gauge,
    poolAddress: manager?.poolAddress ?? "",
    tokenId: undefined,
    recipient: undefined,
    token,
    programId: undefined,
    amount,
    amountUSD,
    blockNumber: BigInt(event.block.number),
    timestamp,
    transactionHash: event.transaction.hash,
  });
  if (!manager) {
    context.log.warn(
      `[AeroVotingRewardsManager.FeesCollected] unknown rewards manager ${event.srcAddress} on chain ${event.chainId}`,
    );
    return;
  }
  context.AeroVotingRewardsManager.set({
    ...manager,
    totalFeesCollectedUSD: manager.totalFeesCollectedUSD + amountUSD,
    numberOfFeeCollections: manager.numberOfFeeCollections + 1n,
    lastUpdatedTimestamp: timestamp,
  });
}

indexer.onEvent(
  { contract: "AeroVotingRewardsManager", event: "FeesCollected" },
  async ({ event, context }) => {
    await processFeesCollected(event, context);
  },
);

// -------------------- phase 3: allocator rewards --------------------

/** One allocator-side flow of a rewards manager. */
interface RewardsFlow {
  kind: string;
  tokenId: bigint | undefined;
  recipient: string | undefined;
  /** Token moved; undefined resolves it from the incentive program. */
  token: string | undefined;
  programId: bigint | undefined;
  amount: bigint;
}

/**
 * Records one allocator-side flow (fee claim, incentive funding, incentive
 * claim, sweep): the AeroVotingRewardsEvent row, the manager's USD totals and,
 * for incentives, the program. The manager, the program and the token are
 * read by primary key; the program read resolves the token of a claim or
 * sweep (those events carry only the program id).
 *
 * @param event - Any rewards-manager event (coordinates)
 * @param flow - The flow
 * @param context - Handler context
 * @param funding - IncentiveCreated: the new program's creator and window
 * @returns Promise that resolves once the row, manager and program are staged
 */
async function recordRewardsFlow(
  event: {
    chainId: number;
    srcAddress: string;
    logIndex: number;
    block: { number: number; timestamp: number };
    transaction: { hash: string };
  },
  flow: RewardsFlow,
  context: handlerContext,
  funding?: { creator: string; start: bigint; duration: bigint },
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);
  const programId =
    flow.programId === undefined
      ? undefined
      : AeroIncentiveProgramId(event.chainId, event.srcAddress, flow.programId);
  const [manager, program] = await Promise.all([
    getRehydrated(
      context.AeroVotingRewardsManager,
      "AeroVotingRewardsManager",
      AeroVotingRewardsManagerId(event.chainId, event.srcAddress),
    ),
    programId && !funding
      ? getRehydrated(
          context.AeroIncentiveProgram,
          "AeroIncentiveProgram",
          programId,
        )
      : undefined,
  ]);
  const token = flow.token ?? program?.token;
  const tokenRow = token
    ? await getRehydrated(context.Token, "Token", TokenId(event.chainId, token))
    : undefined;
  const amountUSD = getTrustedUSD(flow.amount, tokenRow);

  context.AeroVotingRewardsEvent.set({
    id: AeroEventId(event.chainId, event.transaction.hash, event.logIndex),
    chainId: event.chainId,
    kind: flow.kind,
    votingRewardsManager: event.srcAddress,
    gaugeAddress: manager?.gaugeAddress ?? "",
    poolAddress: manager?.poolAddress ?? "",
    tokenId: flow.tokenId,
    recipient: flow.recipient,
    token,
    programId: flow.programId,
    amount: flow.amount,
    amountUSD,
    blockNumber: BigInt(event.block.number),
    timestamp,
    transactionHash: event.transaction.hash,
  });

  if (funding && programId && token && flow.programId !== undefined) {
    context.AeroIncentiveProgram.set({
      id: programId,
      chainId: event.chainId,
      votingRewardsManager: event.srcAddress,
      gaugeAddress: manager?.gaugeAddress ?? "",
      poolAddress: manager?.poolAddress ?? "",
      programId: flow.programId,
      token,
      creator: funding.creator,
      amount: flow.amount,
      amountUSD,
      start: new Date(Number(funding.start) * 1000),
      end: new Date(Number(funding.start + funding.duration) * 1000),
      totalClaimed: 0n,
      totalSwept: 0n,
      createdTimestamp: timestamp,
      transactionHash: event.transaction.hash,
    });
  } else if (program) {
    context.AeroIncentiveProgram.set({
      ...program,
      totalClaimed:
        flow.kind === AERO_VOTING_REWARDS_EVENT_KIND.INCENTIVE_CLAIMED
          ? program.totalClaimed + flow.amount
          : program.totalClaimed,
      totalSwept:
        flow.kind === AERO_VOTING_REWARDS_EVENT_KIND.INCENTIVE_SWEPT
          ? program.totalSwept + flow.amount
          : program.totalSwept,
    });
  }

  if (!manager) {
    context.log.warn(
      `[AeroVotingRewardsManager.${flow.kind}] unknown rewards manager ${event.srcAddress} on chain ${event.chainId}`,
    );
    return;
  }
  const isFeeClaim = flow.kind === AERO_VOTING_REWARDS_EVENT_KIND.FEES_CLAIMED;
  const isFunding =
    flow.kind === AERO_VOTING_REWARDS_EVENT_KIND.INCENTIVE_CREATED;
  const isIncentiveClaim =
    flow.kind === AERO_VOTING_REWARDS_EVENT_KIND.INCENTIVE_CLAIMED;
  context.AeroVotingRewardsManager.set({
    ...manager,
    totalFeesClaimedUSD:
      manager.totalFeesClaimedUSD + (isFeeClaim ? amountUSD : 0n),
    numberOfFeeClaims: manager.numberOfFeeClaims + (isFeeClaim ? 1n : 0n),
    totalIncentivesFundedUSD:
      manager.totalIncentivesFundedUSD + (isFunding ? amountUSD : 0n),
    numberOfIncentivePrograms:
      manager.numberOfIncentivePrograms + (isFunding ? 1n : 0n),
    totalIncentivesClaimedUSD:
      manager.totalIncentivesClaimedUSD + (isIncentiveClaim ? amountUSD : 0n),
    numberOfIncentiveClaims:
      manager.numberOfIncentiveClaims + (isIncentiveClaim ? 1n : 0n),
    lastUpdatedTimestamp: timestamp,
  });
}

indexer.onEvent(
  { contract: "AeroVotingRewardsManager", event: "ClaimFees" },
  async ({ event, context }) => {
    await recordRewardsFlow(
      event,
      {
        kind: AERO_VOTING_REWARDS_EVENT_KIND.FEES_CLAIMED,
        tokenId: event.params.tokenId,
        recipient: event.params.recipient,
        token: event.params.token,
        programId: undefined,
        amount: event.params.amount,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVotingRewardsManager", event: "ClaimIncentives" },
  async ({ event, context }) => {
    await recordRewardsFlow(
      event,
      {
        kind: AERO_VOTING_REWARDS_EVENT_KIND.INCENTIVE_CLAIMED,
        tokenId: event.params.tokenId,
        recipient: event.params.recipient,
        token: undefined,
        programId: event.params.programId,
        amount: event.params.amount,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVotingRewardsManager", event: "IncentiveCreated" },
  async ({ event, context }) => {
    await recordRewardsFlow(
      event,
      {
        kind: AERO_VOTING_REWARDS_EVENT_KIND.INCENTIVE_CREATED,
        tokenId: undefined,
        recipient: undefined,
        token: event.params.token,
        programId: event.params.programId,
        amount: event.params.amount,
      },
      context,
      {
        creator: event.params.creator,
        start: event.params.start,
        duration: event.params.duration,
      },
    );
  },
);

indexer.onEvent(
  { contract: "AeroVotingRewardsManager", event: "IncentiveSwept" },
  async ({ event, context }) => {
    await recordRewardsFlow(
      event,
      {
        kind: AERO_VOTING_REWARDS_EVENT_KIND.INCENTIVE_SWEPT,
        tokenId: undefined,
        recipient: event.params.creator,
        token: undefined,
        programId: event.params.programId,
        amount: event.params.amount,
      },
      context,
    );
  },
);
