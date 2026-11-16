import { indexer } from "envio";
import type { EvmEvent } from "envio";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import { AeroVotingRewardsManagerId } from "./AeroConstants";
import { loadAeroGauge, persistAeroGauge } from "./AeroGaugeLogic";

/**
 * Aero GaugeManager (same address on every chain): its GaugeCreated is the
 * last event of a gauge's creation (after the factory's GaugeCreated and the
 * LeafVoter's GaugeRegistered / GaugeActivated) and the only one naming the
 * gauge's VotingRewardsManager, creation module and creator. It registers the
 * rewards manager contract and records the manager → gauge link that the
 * rewards events resolve by primary key.
 */

indexer.contractRegister(
  { contract: "AeroGaugeManager", event: "GaugeCreated" },
  async ({ event, context }) => {
    context.chain.AeroVotingRewardsManager.add(
      event.params.votingRewardsManager,
    );
  },
);

/**
 * GaugeCreated: completes the AeroGauge and creates its AeroVotingRewardsManager.
 *
 * @param event - AeroGaugeManager.GaugeCreated
 * @param context - Handler context
 * @returns Promise that resolves once the gauge and rewards manager rows are staged
 */
export async function processAeroGaugeManagerGaugeCreated(
  event: EvmEvent<"AeroGaugeManager", "GaugeCreated">,
  context: handlerContext,
): Promise<void> {
  const { gauge: gaugeAddress, target, votingRewardsManager } = event.params;
  const timestamp = new Date(event.block.timestamp * 1000);
  const managerId = AeroVotingRewardsManagerId(
    event.chainId,
    votingRewardsManager,
  );
  const [gauge, manager] = await Promise.all([
    loadAeroGauge(event.chainId, gaugeAddress, context),
    getRehydrated(
      context.AeroVotingRewardsManager,
      "AeroVotingRewardsManager",
      managerId,
    ),
  ]);
  if (!manager) {
    context.AeroVotingRewardsManager.set({
      id: managerId,
      address: votingRewardsManager,
      gaugeAddress,
      poolAddress: target,
      totalFeesCollectedUSD: 0n,
      numberOfFeeCollections: 0n,
      totalFeesClaimedUSD: 0n,
      numberOfFeeClaims: 0n,
      totalIncentivesFundedUSD: 0n,
      numberOfIncentivePrograms: 0n,
      totalIncentivesClaimedUSD: 0n,
      numberOfIncentiveClaims: 0n,
      lastUpdatedTimestamp: timestamp,
    });
  }
  if (!gauge) {
    context.log.warn(
      `[AeroGaugeManager.GaugeCreated] gauge ${gaugeAddress} on chain ${event.chainId} was not created by an indexed gauge factory (factory ${event.params.gaugeFactory})`,
    );
    return;
  }
  persistAeroGauge(
    {
      ...gauge,
      votingRewardsManager,
      creationModule: event.params.module,
      creator: event.params.creator,
    },
    timestamp,
    context,
  );
}

indexer.onEvent(
  { contract: "AeroGaugeManager", event: "GaugeCreated" },
  async ({ event, context }) => {
    await processAeroGaugeManagerGaugeCreated(event, context);
  },
);
