import type {
  LiquidityPoolAggregator,
  LiquidityPoolAggregatorSnapshot,
  handlerContext,
} from "generated";

import { LiquidityPoolAggregatorSnapshotId } from "../Constants";
import {
  type SnapshotForPersist,
  SnapshotType,
  getSnapshotEpoch,
  persistSnapshot,
} from "./Shared";

/**
 * Creates an epoch-aligned snapshot of LiquidityPoolAggregator (no persistence).
 * @param entity - LiquidityPoolAggregator to snapshot
 * @param timestamp - Timestamp used to compute snapshot epoch
 * @returns Epoch-aligned LiquidityPoolAggregatorSnapshot
 */
export function createLiquidityPoolAggregatorSnapshot(
  entity: LiquidityPoolAggregator,
  timestamp: Date,
): LiquidityPoolAggregatorSnapshot {
  const epoch = getSnapshotEpoch(timestamp);

  const snapshotId = LiquidityPoolAggregatorSnapshotId(
    entity.chainId,
    entity.poolAddress,
    epoch.getTime(),
  );
  return {
    id: snapshotId,
    chainId: entity.chainId,
    name: entity.name,
    poolAddress: entity.poolAddress,
    token0_id: entity.token0_id,
    token1_id: entity.token1_id,
    token0_address: entity.token0_address,
    token1_address: entity.token1_address,
    isStable: entity.isStable,
    isCL: entity.isCL,
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
    totalVolumeUSDWhitelisted: entity.totalVolumeUSDWhitelisted,
    totalUnstakedFeesCollected0: entity.totalUnstakedFeesCollected0,
    totalUnstakedFeesCollected1: entity.totalUnstakedFeesCollected1,
    totalStakedFeesCollected0: entity.totalStakedFeesCollected0,
    totalStakedFeesCollected1: entity.totalStakedFeesCollected1,
    totalUnstakedFeesCollectedUSD: entity.totalUnstakedFeesCollectedUSD,
    totalStakedFeesCollectedUSD: entity.totalStakedFeesCollectedUSD,
    totalFeesUSDWhitelisted: entity.totalFeesUSDWhitelisted,
    numberOfSwaps: entity.numberOfSwaps,
    token0Price: entity.token0Price,
    token1Price: entity.token1Price,
    totalVotesDeposited: entity.totalVotesDeposited,
    totalVotesDepositedUSD: entity.totalVotesDepositedUSD,
    totalEmissions: entity.totalEmissions,
    totalEmissionsUSD: entity.totalEmissionsUSD,
    gaugeIsAlive: entity.gaugeIsAlive,
    gaugeAddress: entity.gaugeAddress,
    currentLiquidityStaked: entity.currentLiquidityStaked,
    currentLiquidityStakedUSD: entity.currentLiquidityStakedUSD,
    timestamp: epoch,
    feeProtocol0: entity.feeProtocol0,
    feeProtocol1: entity.feeProtocol1,
    observationCardinalityNext: entity.observationCardinalityNext,
    sqrtPriceX96: entity.sqrtPriceX96,
    tick: entity.tick,
    totalFlashLoanFees0: entity.totalFlashLoanFees0,
    totalFlashLoanFees1: entity.totalFlashLoanFees1,
    totalFlashLoanFeesUSD: entity.totalFlashLoanFeesUSD,
    totalFlashLoanVolumeUSD: entity.totalFlashLoanVolumeUSD,
    numberOfFlashLoans: entity.numberOfFlashLoans,
    bribeVotingRewardAddress: entity.bribeVotingRewardAddress,
    totalBribeClaimed: entity.totalBribeClaimed,
    totalBribeClaimedUSD: entity.totalBribeClaimedUSD,
    feeVotingRewardAddress: entity.feeVotingRewardAddress,
    totalFeeRewardClaimed: entity.totalFeeRewardClaimed,
    totalFeeRewardClaimedUSD: entity.totalFeeRewardClaimedUSD,
    veNFTamountStaked: entity.veNFTamountStaked,
    baseFee: entity.baseFee,
    feeCap: entity.feeCap,
    scalingFactor: entity.scalingFactor,
    currentFee: entity.currentFee,
  };
}

/**
 * Creates and persists an epoch-aligned snapshot of a LiquidityPoolAggregator.
 * @param entity - LiquidityPoolAggregator to snapshot
 * @param timestamp - Timestamp used to compute snapshot epoch
 * @param context - Handler context
 * @returns void
 */
export function setLiquidityPoolAggregatorSnapshot(
  entity: LiquidityPoolAggregator,
  timestamp: Date,
  context: handlerContext,
): void {
  const snapshotForPersist: SnapshotForPersist = {
    type: SnapshotType.LiquidityPoolAggregator,
    snapshot: createLiquidityPoolAggregatorSnapshot(entity, timestamp),
  };
  persistSnapshot(snapshotForPersist, context);
}
