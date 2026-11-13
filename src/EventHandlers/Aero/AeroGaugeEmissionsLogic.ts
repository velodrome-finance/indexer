import type { AeroGauge } from "envio";
import { loadPoolData } from "../../Aggregators/Pool";
import type { handlerContext } from "../../EntityTypes";
import { calculateTotalUSD } from "../../Helpers";
import {
  AERO_EMISSIONS_EVENT_KIND,
  type AeroEmissionsEventKind,
  AeroEventId,
} from "./AeroConstants";
import {
  loadAeroGauge,
  loadAeroRewardToken,
  persistAeroGauge,
  rewardTokenUSD,
} from "./AeroGaugeLogic";

/**
 * Per-LP emissions of Aero gauges (ADR 0006): one AeroEmissionsEvent row per
 * claim, deferral, referral leg and early-withdraw penalty, plus the gauge's
 * running totals. Amounts are in the chain's reward token (AERO on Base,
 * xAERO elsewhere), valued at its stored price on the event's chain.
 */

/** Fields of one Aero gauge emissions event. */
export interface AeroEmissionsEventData {
  chainId: number;
  gaugeAddress: string;
  kind: AeroEmissionsEventKind;
  account: string;
  recipient: string | undefined;
  referral: string | undefined;
  tokenId: bigint | undefined;
  amount: bigint;
  blockNumber: number;
  timestamp: number;
  transactionHash: string;
  logIndex: number;
}

/**
 * Adds an emissions event to the gauge total it belongs to.
 *
 * @param gauge - The gauge
 * @param kind - Event kind
 * @param amount - Reward-token amount
 * @returns The gauge with the total updated (not persisted)
 */
export function applyEmissionsToGauge(
  gauge: AeroGauge,
  kind: AeroEmissionsEventKind,
  amount: bigint,
): AeroGauge {
  switch (kind) {
    case AERO_EMISSIONS_EVENT_KIND.CLAIMED:
      return {
        ...gauge,
        totalEmissionsClaimed: gauge.totalEmissionsClaimed + amount,
        numberOfClaims: gauge.numberOfClaims + 1n,
      };
    case AERO_EMISSIONS_EVENT_KIND.DEFERRED:
      return {
        ...gauge,
        totalEmissionsDeferred: gauge.totalEmissionsDeferred + amount,
      };
    case AERO_EMISSIONS_EVENT_KIND.DEFERRED_CLAIMED:
      return {
        ...gauge,
        totalDeferredEmissionsClaimed:
          gauge.totalDeferredEmissionsClaimed + amount,
      };
    case AERO_EMISSIONS_EVENT_KIND.REFERRAL_DEFERRED:
      return {
        ...gauge,
        totalReferralEmissionsDeferred:
          gauge.totalReferralEmissionsDeferred + amount,
      };
    case AERO_EMISSIONS_EVENT_KIND.REFERRAL_CLAIMED:
      return {
        ...gauge,
        totalReferralEmissionsClaimed:
          gauge.totalReferralEmissionsClaimed + amount,
      };
    case AERO_EMISSIONS_EVENT_KIND.EARLY_WITHDRAW_PENALTY:
      return {
        ...gauge,
        totalEarlyWithdrawPenalty: gauge.totalEarlyWithdrawPenalty + amount,
      };
  }
}

/**
 * Records one Aero gauge emissions event: the AeroEmissionsEvent row and the
 * gauge's total.
 *
 * @param data - Event fields
 * @param context - Handler context
 * @returns Promise that resolves once the row and the gauge are staged
 */
export async function recordAeroEmissionsEvent(
  data: AeroEmissionsEventData,
  context: handlerContext,
): Promise<void> {
  const [gauge, rewardToken] = await Promise.all([
    loadAeroGauge(data.chainId, data.gaugeAddress, context),
    loadAeroRewardToken(data.chainId, context),
  ]);
  if (!gauge) {
    context.log.warn(
      `[AeroGauge.${data.kind}] unknown gauge ${data.gaugeAddress} on chain ${data.chainId}`,
    );
    return;
  }
  const timestamp = new Date(data.timestamp * 1000);
  context.AeroEmissionsEvent.set({
    id: AeroEventId(data.chainId, data.transactionHash, data.logIndex),
    chainId: data.chainId,
    kind: data.kind,
    gaugeAddress: data.gaugeAddress,
    poolAddress: gauge.poolAddress,
    account: data.account,
    recipient: data.recipient,
    referral: data.referral,
    tokenId: data.tokenId,
    amount: data.amount,
    amountUSD: rewardTokenUSD(data.amount, rewardToken),
    rewardToken: gauge.rewardToken,
    blockNumber: BigInt(data.blockNumber),
    timestamp,
    transactionHash: data.transactionHash,
  });
  persistAeroGauge(
    applyEmissionsToGauge(gauge, data.kind, data.amount),
    timestamp,
    context,
  );
}

/**
 * Gauge ClaimFees: pool fees earned by the gauge's staked liquidity, sent to
 * its VotingRewardsManager for the gauge's sAERO allocators. Raw amounts and
 * their trusted USD at the pool tokens' stored prices.
 *
 * @param chainId - Chain of the event
 * @param gaugeAddress - Gauge
 * @param claimed0 - token0 fees (raw)
 * @param claimed1 - token1 fees (raw)
 * @param blockTimestamp - Block time (seconds)
 * @param context - Handler context
 * @returns Promise that resolves once the gauge is staged
 */
export async function processAeroGaugeClaimFees(
  chainId: number,
  gaugeAddress: string,
  claimed0: bigint,
  claimed1: bigint,
  blockTimestamp: number,
  context: handlerContext,
): Promise<void> {
  const gauge = await loadAeroGauge(chainId, gaugeAddress, context);
  if (!gauge) {
    context.log.warn(
      `[AeroGauge.ClaimFees] unknown gauge ${gaugeAddress} on chain ${chainId}`,
    );
    return;
  }
  const poolData = await loadPoolData(gauge.poolAddress, chainId, context);
  const feesUSD = poolData
    ? calculateTotalUSD(
        claimed0,
        claimed1,
        poolData.token0Instance,
        poolData.token1Instance,
      )
    : 0n;
  persistAeroGauge(
    {
      ...gauge,
      totalFeesClaimed0: gauge.totalFeesClaimed0 + claimed0,
      totalFeesClaimed1: gauge.totalFeesClaimed1 + claimed1,
      totalFeesClaimedUSD: gauge.totalFeesClaimedUSD + feesUSD,
    },
    new Date(blockTimestamp * 1000),
    context,
  );
}
