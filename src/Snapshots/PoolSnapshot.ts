import type { handlerContext } from "../EntityTypes";

import { PoolSnapshotId } from "../Constants";
import type { Pool, PoolSnapshot } from "../EntityTypes";
import {
  type SnapshotForPersist,
  SnapshotType,
  getSnapshotEpoch,
  persistSnapshot,
} from "./Shared";

/**
 * Creates an epoch-aligned snapshot of Pool (no persistence).
 * @param entity - Pool to snapshot
 * @param timestamp - Timestamp used to compute snapshot epoch
 * @param chainId - Chain of the event being handled (the entity's chain)
 * @returns Epoch-aligned PoolSnapshot
 */
export function createPoolSnapshot(
  entity: Pool,
  timestamp: Date,
  chainId: number,
): PoolSnapshot {
  const epoch = getSnapshotEpoch(timestamp);

  const snapshotId = PoolSnapshotId(
    chainId,
    entity.poolAddress,
    epoch.getTime(),
  );
  return {
    id: snapshotId,
    name: entity.name,
    poolAddress: entity.poolAddress,
    token0_id: entity.token0_id,
    token1_id: entity.token1_id,
    token0_address: entity.token0_address,
    token1_address: entity.token1_address,
    isStable: entity.isStable,
    isCL: entity.isCL,
    deployment: entity.deployment,
    reserve0: entity.reserve0,
    reserve1: entity.reserve1,
    totalLPTokenSupply: entity.totalLPTokenSupply,
    totalLiquidityUSD: entity.totalLiquidityUSD,
    totalVolume0: entity.totalVolume0,
    totalVolume1: entity.totalVolume1,
    totalVolumeUSD: entity.totalVolumeUSD,
    totalFeesGenerated0: entity.totalFeesGenerated0,
    totalFeesGenerated1: entity.totalFeesGenerated1,
    totalFeesGeneratedUSD: entity.totalFeesGeneratedUSD,
    totalUnstakedFeesCollected0: entity.totalUnstakedFeesCollected0,
    totalUnstakedFeesCollected1: entity.totalUnstakedFeesCollected1,
    totalStakedFeesCollected0: entity.totalStakedFeesCollected0,
    totalStakedFeesCollected1: entity.totalStakedFeesCollected1,
    totalUnstakedFeesCollectedUSD: entity.totalUnstakedFeesCollectedUSD,
    totalStakedFeesCollectedUSD: entity.totalStakedFeesCollectedUSD,
    numberOfSwaps: entity.numberOfSwaps,
    token0Price: entity.token0Price,
    token1Price: entity.token1Price,
    totalVotesDeposited: entity.totalVotesDeposited,
    totalVotesDepositedUSD: entity.totalVotesDepositedUSD,
    totalEmissions: entity.totalEmissions,
    totalEmissionsUSD: entity.totalEmissionsUSD,
    totalEmissionsRedistributed: entity.totalEmissionsRedistributed,
    totalEmissionsForfeited: entity.totalEmissionsForfeited,
    gaugeIsAlive: entity.gaugeIsAlive,
    gaugeAddress: entity.gaugeAddress,
    gaugeEmissionsCap: entity.gaugeEmissionsCap,
    minStakeTime: entity.minStakeTime,
    numberOfGaugeDeposits: entity.numberOfGaugeDeposits,
    numberOfGaugeWithdrawals: entity.numberOfGaugeWithdrawals,
    numberOfGaugeRewardClaims: entity.numberOfGaugeRewardClaims,
    totalGaugeRewardsClaimedUSD: entity.totalGaugeRewardsClaimedUSD,
    totalGaugeRewardsClaimed: entity.totalGaugeRewardsClaimed,
    totalGaugeEarlyWithdrawPenalties: entity.totalGaugeEarlyWithdrawPenalties,
    totalGaugeEarlyWithdrawPenaltiesUSD:
      entity.totalGaugeEarlyWithdrawPenaltiesUSD,
    currentLiquidityStaked: entity.currentLiquidityStaked,
    currentLiquidityStakedUSD: entity.currentLiquidityStakedUSD,
    timestamp: epoch,
    unstakedFee: entity.unstakedFee,
    feeProtocol0: entity.feeProtocol0,
    feeProtocol1: entity.feeProtocol1,
    observationCardinalityNext: entity.observationCardinalityNext,
    sqrtPriceX96: entity.sqrtPriceX96,
    tick: entity.tick,
    liquidityInRange: entity.liquidityInRange,
    stakedLiquidityInRange: entity.stakedLiquidityInRange,
    stakedReserve0: entity.stakedReserve0,
    stakedReserve1: entity.stakedReserve1,
    totalFlashLoanFees0: entity.totalFlashLoanFees0,
    totalFlashLoanFees1: entity.totalFlashLoanFees1,
    totalFlashLoanFeesUSD: entity.totalFlashLoanFeesUSD,
    totalFlashLoanVolumeUSD: entity.totalFlashLoanVolumeUSD,
    numberOfFlashLoans: entity.numberOfFlashLoans,
    bribeVotingRewardAddress: entity.bribeVotingRewardAddress,
    totalBribeClaimedUSD: entity.totalBribeClaimedUSD,
    feeVotingRewardAddress: entity.feeVotingRewardAddress,
    totalFeeRewardClaimedUSD: entity.totalFeeRewardClaimedUSD,
    veNFTamountStaked: entity.veNFTamountStaked,
    baseFee: entity.baseFee,
    feeCap: entity.feeCap,
    scalingFactor: entity.scalingFactor,
    currentFee: entity.currentFee,
  };
}

/**
 * Creates and persists an epoch-aligned snapshot of a Pool.
 * @param entity - Pool to snapshot
 * @param timestamp - Timestamp used to compute snapshot epoch
 * @param context - Handler context
 * @param chainId - Chain of the event being handled (the entity's chain)
 * @returns void
 */
export function setPoolSnapshot(
  entity: Pool,
  timestamp: Date,
  context: handlerContext,
  chainId: number,
): void {
  const snapshotForPersist: SnapshotForPersist = {
    type: SnapshotType.Pool,
    snapshot: createPoolSnapshot(entity, timestamp, chainId),
  };
  persistSnapshot(snapshotForPersist, context);
}
