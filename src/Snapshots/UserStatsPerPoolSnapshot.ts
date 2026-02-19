import type {
  UserStatsPerPool,
  UserStatsPerPoolSnapshot,
  handlerContext,
} from "generated";

import { UserStatsPerPoolSnapshotId } from "../Constants";
import { getSnapshotEpoch } from "./Shared";

/**
 * Creates and persists an epoch-aligned snapshot of UserStatsPerPool.
 * @param entity - UserStatsPerPool to snapshot
 * @param timestamp - Timestamp of the snapshot
 * @param blockNumber - Block number of the snapshot
 * @param context - Handler context
 * @returns void
 */
export function setUserStatsPerPoolSnapshot(
  entity: UserStatsPerPool,
  timestamp: Date,
  blockNumber: number,
  context: handlerContext,
): void {
  const epoch = getSnapshotEpoch(timestamp);

  const snapshotId = UserStatsPerPoolSnapshotId(
    entity.chainId,
    entity.userAddress,
    entity.poolAddress,
    epoch.getTime(),
  );

  const snapshot: UserStatsPerPoolSnapshot = {
    id: snapshotId,
    userAddress: entity.userAddress,
    poolAddress: entity.poolAddress,
    chainId: entity.chainId,
    timestamp: epoch,
    blockNumber,
    currentLiquidityUSD: entity.currentLiquidityUSD,
    lpBalance: entity.lpBalance,
    totalLiquidityAddedUSD: entity.totalLiquidityAddedUSD,
    totalLiquidityAddedToken0: entity.totalLiquidityAddedToken0,
    totalLiquidityAddedToken1: entity.totalLiquidityAddedToken1,
    totalLiquidityRemovedUSD: entity.totalLiquidityRemovedUSD,
    totalLiquidityRemovedToken0: entity.totalLiquidityRemovedToken0,
    totalLiquidityRemovedToken1: entity.totalLiquidityRemovedToken1,
    numberOfSwaps: entity.numberOfSwaps,
    totalSwapVolumeAmount0: entity.totalSwapVolumeAmount0,
    totalSwapVolumeAmount1: entity.totalSwapVolumeAmount1,
    totalSwapVolumeUSD: entity.totalSwapVolumeUSD,
    totalFeesContributedUSD: entity.totalFeesContributedUSD,
    totalFeesContributed0: entity.totalFeesContributed0,
    totalFeesContributed1: entity.totalFeesContributed1,
    numberOfFlashLoans: entity.numberOfFlashLoans,
    totalFlashLoanVolumeUSD: entity.totalFlashLoanVolumeUSD,
    numberOfGaugeDeposits: entity.numberOfGaugeDeposits,
    numberOfGaugeWithdrawals: entity.numberOfGaugeWithdrawals,
    numberOfGaugeRewardClaims: entity.numberOfGaugeRewardClaims,
    totalGaugeRewardsClaimedUSD: entity.totalGaugeRewardsClaimedUSD,
    totalGaugeRewardsClaimed: entity.totalGaugeRewardsClaimed,
    totalStakedFeesCollected0: entity.totalStakedFeesCollected0,
    totalStakedFeesCollected1: entity.totalStakedFeesCollected1,
    totalStakedFeesCollectedUSD: entity.totalStakedFeesCollectedUSD,
    totalUnstakedFeesCollected0: entity.totalUnstakedFeesCollected0,
    totalUnstakedFeesCollected1: entity.totalUnstakedFeesCollected1,
    totalUnstakedFeesCollectedUSD: entity.totalUnstakedFeesCollectedUSD,
    currentLiquidityStaked: entity.currentLiquidityStaked,
    currentLiquidityStakedUSD: entity.currentLiquidityStakedUSD,
    totalBribeClaimed: entity.totalBribeClaimed,
    totalBribeClaimedUSD: entity.totalBribeClaimedUSD,
    totalFeeRewardClaimed: entity.totalFeeRewardClaimed,
    totalFeeRewardClaimedUSD: entity.totalFeeRewardClaimedUSD,
    veNFTamountStaked: entity.veNFTamountStaked,
    almAddress: entity.almAddress,
    almLpAmount: entity.almLpAmount,
  };

  context.UserStatsPerPoolSnapshot.set(snapshot);
}
