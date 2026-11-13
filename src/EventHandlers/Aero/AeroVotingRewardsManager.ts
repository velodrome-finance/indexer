import { indexer } from "envio";
import type { EvmEvent } from "envio";
import { TokenId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import { getTrustedUSD } from "../../PriceTrust";
import {
  AERO_VOTING_REWARDS_EVENT_KIND,
  AeroEventId,
  AeroVotingRewardsManagerId,
} from "./AeroConstants";

/**
 * Aero VotingRewardsManager (one per gauge, registered by the GaugeManager's
 * GaugeCreated). Phase 2: FeesCollected, the staked liquidity's pool fees the
 * manager pulls from its gauge (one event per token), which sAERO allocators
 * of the gauge then claim.
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
