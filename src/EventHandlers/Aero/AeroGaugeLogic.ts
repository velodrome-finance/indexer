import type {
  AeroGauge,
  AeroGaugeFactory,
  AeroLeafVoterState,
  Token,
} from "envio";
import { updatePool } from "../../Aggregators/Pool";
import { POOL_DEPLOYMENT, PoolId, TokenId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import { calculateTotalUSD } from "../../Helpers";
import { getSnapshotEpoch, shouldSnapshot } from "../../Snapshots/Shared";
import {
  AeroGaugeFactoryId,
  AeroGaugeId,
  AeroLeafVoterStateId,
  AeroSnapshotId,
  aeroRewardToken,
} from "./AeroConstants";

/**
 * Shared state handling of Aero gauges (ADR 0006): loading, creating and
 * persisting `AeroGauge`, `AeroGaugeFactory` and `AeroLeafVoterState`, their
 * hourly snapshots, the `Pool.gaugeAddress` / `gaugeIsAlive` link, and the
 * reward token's USD value. Every read and write stays on the event's chain.
 */

/** LeafVoter address (same on every Aero chain, Base included). */
export const AERO_LEAF_VOTER_ADDRESS =
  "0x382409fad8503FbCdbB27A4211551fa03e884078";

/**
 * Reads an Aero gauge by primary key.
 *
 * @param chainId - Chain of the gauge
 * @param gauge - Checksummed gauge address
 * @param context - Handler context
 * @returns The gauge, or undefined when it was not created by an indexed factory
 */
export function loadAeroGauge(
  chainId: number,
  gauge: string,
  context: handlerContext,
): Promise<AeroGauge | undefined> {
  return getRehydrated(
    context.AeroGauge,
    "AeroGauge",
    AeroGaugeId(chainId, gauge),
  );
}

/**
 * Builds a new AeroGauge row at its factory's GaugeCreated (all counters 0).
 *
 * @param params - Gauge identity and creation coordinates
 * @param params.chainId - Chain of the gauge
 * @param params.gauge - Gauge address
 * @param params.pool - Target pool (staking token) address
 * @param params.isCL - Whether the CL gauge factory created it
 * @param params.isPool - The factory's isPool flag
 * @param params.gaugeFactory - Factory that emitted GaugeCreated
 * @param params.emissionCap - The factory's known default cap, when one was emitted
 * @param params.blockNumber - Creation block
 * @param params.timestamp - Creation block time
 * @param params.transactionHash - Creation transaction
 * @returns The new gauge row (not persisted)
 */
export function createAeroGaugeEntity(params: {
  chainId: number;
  gauge: string;
  pool: string;
  isCL: boolean;
  isPool: boolean;
  gaugeFactory: string;
  emissionCap: bigint | undefined;
  blockNumber: number;
  timestamp: Date;
  transactionHash: string;
}): AeroGauge {
  return {
    id: AeroGaugeId(params.chainId, params.gauge),
    gaugeAddress: params.gauge,
    pool_id: PoolId(params.chainId, params.pool),
    poolAddress: params.pool,
    isCL: params.isCL,
    isPool: params.isPool,
    gaugeFactory: params.gaugeFactory,
    votingRewardsManager: undefined,
    creationModule: undefined,
    creator: undefined,
    rewardToken: aeroRewardToken(params.chainId),
    createdBlockNumber: BigInt(params.blockNumber),
    createdTimestamp: params.timestamp,
    createdTransactionHash: params.transactionHash,
    isRegistered: false,
    isActivated: false,
    activatedTimestamp: undefined,
    emissionCap: params.emissionCap,
    emissionCapUpdatedTimestamp: undefined,
    minStakeBlocks: undefined,
    referral: undefined,
    referralShare: undefined,
    lastGaugeWeight: 0n,
    lastSettlementTimestamp: undefined,
    totalAllocated: 0n,
    totalEmissionsCredited: 0n,
    totalCapSurplus: 0n,
    totalEmissionsForfeited: 0n,
    totalEmissionsMinted: 0n,
    totalEmissionsMintedUSD: 0n,
    totalEmissionsClaimed: 0n,
    totalDeferredEmissionsClaimed: 0n,
    totalEmissionsDeferred: 0n,
    totalReferralEmissionsDeferred: 0n,
    totalReferralEmissionsClaimed: 0n,
    totalEarlyWithdrawPenalty: 0n,
    numberOfClaims: 0n,
    numberOfDeposits: 0n,
    numberOfWithdrawals: 0n,
    totalFeesClaimed0: 0n,
    totalFeesClaimed1: 0n,
    totalFeesClaimedUSD: 0n,
    lastUpdatedTimestamp: params.timestamp,
    lastSnapshotTimestamp: undefined,
  };
}

/**
 * Stages an AeroGauge write, stamping `lastUpdatedTimestamp`, and writes its
 * hourly AeroGaugeSnapshot when `timestamp` is the first change of a new hour
 * (the snapshot holds the state after this change, as PoolSnapshot does).
 *
 * @param gauge - The updated gauge
 * @param timestamp - Block time of the change
 * @param context - Handler context
 * @returns Nothing; the gauge (and any snapshot) are staged
 */
export function persistAeroGauge(
  gauge: AeroGauge,
  timestamp: Date,
  context: handlerContext,
): void {
  let next: AeroGauge = { ...gauge, lastUpdatedTimestamp: timestamp };
  if (shouldSnapshot(next.lastSnapshotTimestamp, timestamp)) {
    const epoch = getSnapshotEpoch(timestamp);
    context.AeroGaugeSnapshot.set({
      id: AeroSnapshotId(next.id, epoch.getTime()),
      gaugeAddress: next.gaugeAddress,
      poolAddress: next.poolAddress,
      isCL: next.isCL,
      timestamp: epoch,
      isActivated: next.isActivated,
      emissionCap: next.emissionCap,
      lastGaugeWeight: next.lastGaugeWeight,
      totalAllocated: next.totalAllocated,
      totalEmissionsCredited: next.totalEmissionsCredited,
      totalCapSurplus: next.totalCapSurplus,
      totalEmissionsForfeited: next.totalEmissionsForfeited,
      totalEmissionsMinted: next.totalEmissionsMinted,
      totalEmissionsMintedUSD: next.totalEmissionsMintedUSD,
      totalEarlyWithdrawPenalty: next.totalEarlyWithdrawPenalty,
      totalFeesClaimed0: next.totalFeesClaimed0,
      totalFeesClaimed1: next.totalFeesClaimed1,
      totalFeesClaimedUSD: next.totalFeesClaimedUSD,
    });
    next = { ...next, lastSnapshotTimestamp: epoch };
  }
  context.AeroGauge.set(next);
}

/**
 * Whether an Aero gauge receives emissions: activated on the LeafVoter and
 * with a non-zero emission cap (a null cap is the factory default, never 0).
 * This is what `Pool.gaugeIsAlive` means on an AERO pool.
 *
 * @param gauge - The gauge
 * @returns True when the gauge is activated and its cap is not 0
 */
export function isAeroGaugeAlive(gauge: AeroGauge): boolean {
  return gauge.isActivated && gauge.emissionCap !== 0n;
}

/**
 * Writes the gauge link onto its Aero pool: `gaugeAddress` (set once, at the
 * gauge's creation) and `gaugeIsAlive` (activated and cap > 0). Skipped when
 * the target is not an indexed Aero pool, or when nothing changes.
 *
 * @param gauge - The gauge after the change
 * @param timestamp - Block time of the change
 * @param blockNumber - Block of the change
 * @param context - Handler context
 * @param chainId - Chain of the event being handled (the gauge's chain)
 * @returns Promise that resolves once the Pool update (if any) is staged
 */
export async function syncAeroPoolGaugeLink(
  gauge: AeroGauge,
  timestamp: Date,
  blockNumber: number,
  context: handlerContext,
  chainId: number,
): Promise<void> {
  const pool = await getRehydrated(context.Pool, "Pool", gauge.pool_id);
  if (!pool || pool.deployment !== POOL_DEPLOYMENT.AERO) return;
  const alive = isAeroGaugeAlive(gauge);
  if (pool.gaugeAddress === gauge.gaugeAddress && pool.gaugeIsAlive === alive) {
    return;
  }
  await updatePool(
    {
      gaugeAddress: gauge.gaugeAddress,
      gaugeIsAlive: alive,
      lastUpdatedTimestamp: timestamp,
    },
    pool,
    timestamp,
    context,
    chainId,
    blockNumber,
  );
}

/**
 * Reads (or builds, with defaults) a gauge factory's configuration row.
 *
 * @param chainId - Chain of the factory
 * @param factory - Factory address
 * @param isCL - Whether it is the CL gauge factory
 * @param timestamp - Block time, used for a new row
 * @param context - Handler context
 * @returns The factory row (not persisted)
 */
export async function loadOrCreateAeroGaugeFactory(
  chainId: number,
  factory: string,
  isCL: boolean,
  timestamp: Date,
  context: handlerContext,
): Promise<AeroGaugeFactory> {
  const existing = await getRehydrated(
    context.AeroGaugeFactory,
    "AeroGaugeFactory",
    AeroGaugeFactoryId(chainId, factory),
  );
  if (existing) return existing;
  return {
    id: AeroGaugeFactoryId(chainId, factory),
    factoryAddress: factory,
    isCL,
    defaultCap: undefined,
    operatorMinCap: undefined,
    operatorMaxCap: undefined,
    minStakeBlocks: undefined,
    penaltyRate: undefined,
    maxShareCap: undefined,
    emergencyWithdrawEnabled: false,
    numberOfGauges: 0,
    lastUpdatedTimestamp: timestamp,
  };
}

/**
 * Reads (or builds, with zero totals) the chain's LeafVoter state row.
 *
 * @param chainId - Chain of the LeafVoter
 * @param timestamp - Block time, used for a new row
 * @param context - Handler context
 * @returns The state row (not persisted)
 */
export async function loadOrCreateLeafVoterState(
  chainId: number,
  timestamp: Date,
  context: handlerContext,
): Promise<AeroLeafVoterState> {
  const existing = await getRehydrated(
    context.AeroLeafVoterState,
    "AeroLeafVoterState",
    AeroLeafVoterStateId(chainId),
  );
  if (existing) return existing;
  return {
    id: AeroLeafVoterStateId(chainId),
    leafVoter: AERO_LEAF_VOTER_ADDRESS,
    rewardToken: aeroRewardToken(chainId),
    chainStatus: undefined,
    totalEmissionsCredited: 0n,
    totalCapSurplus: 0n,
    totalIdleSurplus: 0n,
    totalEmissionsForfeited: 0n,
    totalEmissionsMinted: 0n,
    totalEmissionsMintedUSD: 0n,
    totalRedeemed: 0n,
    numberOfRedemptions: 0n,
    receiptTokenSupply: 0n,
    emissionsPerVP: undefined,
    totalChainAllocation: 0n,
    totalBookedAllocation: 0n,
    allocationCooldown: undefined,
    maxGauges: undefined,
    minIncentiveDuration: undefined,
    localVotingEnabled: undefined,
    lastUpdatedTimestamp: timestamp,
    lastSnapshotTimestamp: undefined,
  };
}

/**
 * Stages a LeafVoter state write and its hourly AeroLeafVoterStateSnapshot
 * (first change of each hour, state after the change).
 *
 * @param state - The updated state
 * @param timestamp - Block time of the change
 * @param context - Handler context
 * @returns Nothing; the state (and any snapshot) are staged
 */
export function persistLeafVoterState(
  state: AeroLeafVoterState,
  timestamp: Date,
  context: handlerContext,
): void {
  let next: AeroLeafVoterState = { ...state, lastUpdatedTimestamp: timestamp };
  if (shouldSnapshot(next.lastSnapshotTimestamp, timestamp)) {
    const epoch = getSnapshotEpoch(timestamp);
    context.AeroLeafVoterStateSnapshot.set({
      id: AeroSnapshotId(next.id, epoch.getTime()),
      timestamp: epoch,
      totalEmissionsCredited: next.totalEmissionsCredited,
      totalCapSurplus: next.totalCapSurplus,
      totalIdleSurplus: next.totalIdleSurplus,
      totalEmissionsForfeited: next.totalEmissionsForfeited,
      totalEmissionsMinted: next.totalEmissionsMinted,
      totalEmissionsMintedUSD: next.totalEmissionsMintedUSD,
      totalRedeemed: next.totalRedeemed,
      receiptTokenSupply: next.receiptTokenSupply,
      emissionsPerVP: next.emissionsPerVP,
      totalChainAllocation: next.totalChainAllocation,
      totalBookedAllocation: next.totalBookedAllocation,
    });
    next = { ...next, lastSnapshotTimestamp: epoch };
  }
  context.AeroLeafVoterState.set(next);
}

/**
 * Reads the chain's Aero reward token (AERO on Base, xAERO elsewhere) from the
 * event's chain. Its stored price values emissions; no refresh is triggered
 * and no other chain is read, so on a chain where xAERO is not priced the USD
 * value is 0.
 *
 * @param chainId - Chain of the event
 * @param context - Handler context
 * @returns The reward token row, or undefined when the chain has never indexed it
 */
export function loadAeroRewardToken(
  chainId: number,
  context: handlerContext,
): Promise<Token | undefined> {
  return getRehydrated(
    context.Token,
    "Token",
    TokenId(chainId, aeroRewardToken(chainId)),
  );
}

/**
 * USD value (1e18) of an amount of the chain's reward token at its stored
 * price, through the price-trust gate.
 *
 * @param amount - Reward-token amount (18 decimals)
 * @param rewardToken - The chain's reward token row (undefined values to 0)
 * @param chainId - Chain of the event being handled (the reward token's chain)
 * @returns USD value, 1e18-scaled
 */
export function rewardTokenUSD(
  amount: bigint,
  rewardToken: Token | undefined,
  chainId: number,
): bigint {
  return calculateTotalUSD(amount, 0n, rewardToken, undefined, chainId);
}
