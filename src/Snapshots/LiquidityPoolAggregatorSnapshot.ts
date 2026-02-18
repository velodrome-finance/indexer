import type {
  LiquidityPoolAggregator,
  LiquidityPoolAggregatorSnapshot,
  handlerContext,
} from "generated";

import { LiquidityPoolAggregatorSnapshotId } from "../Constants";
import { getSnapshotEpoch } from "./Shared";

/**
 * Creates and persists an epoch-aligned snapshot of a LiquidityPoolAggregator.
 * @param liquidityPoolAggregator - Liquidity pool aggregator to snapshot
 * @param timestamp - Timestamp of the snapshot
 * @param context - Handler context
 * @returns void
 */
export function setLiquidityPoolAggregatorSnapshot(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  timestamp: Date,
  context: handlerContext,
): void {
  const epoch = getSnapshotEpoch(timestamp);

  const snapshotId = LiquidityPoolAggregatorSnapshotId(
    liquidityPoolAggregator.chainId,
    liquidityPoolAggregator.poolAddress,
    epoch.getTime(),
  );

  const snapshot: LiquidityPoolAggregatorSnapshot = {
    id: snapshotId,
    chainId: liquidityPoolAggregator.chainId,
    name: liquidityPoolAggregator.name,
    poolAddress: liquidityPoolAggregator.poolAddress,
    token0_id: liquidityPoolAggregator.token0_id,
    token1_id: liquidityPoolAggregator.token1_id,
    token0_address: liquidityPoolAggregator.token0_address,
    token1_address: liquidityPoolAggregator.token1_address,
    isStable: liquidityPoolAggregator.isStable,
    isCL: liquidityPoolAggregator.isCL,
    reserve0: liquidityPoolAggregator.reserve0,
    reserve1: liquidityPoolAggregator.reserve1,
    totalLPTokenSupply: liquidityPoolAggregator.totalLPTokenSupply,
    totalLiquidityUSD: liquidityPoolAggregator.totalLiquidityUSD,
    totalVolume0: liquidityPoolAggregator.totalVolume0,
    totalVolume1: liquidityPoolAggregator.totalVolume1,
    totalVolumeUSD: liquidityPoolAggregator.totalVolumeUSD,
    totalFeesGenerated0: liquidityPoolAggregator.totalFeesGenerated0,
    totalFeesGenerated1: liquidityPoolAggregator.totalFeesGenerated1,
    totalFeesGeneratedUSD: liquidityPoolAggregator.totalFeesGeneratedUSD,
    totalVolumeUSDWhitelisted:
      liquidityPoolAggregator.totalVolumeUSDWhitelisted,
    totalUnstakedFeesCollected0:
      liquidityPoolAggregator.totalUnstakedFeesCollected0,
    totalUnstakedFeesCollected1:
      liquidityPoolAggregator.totalUnstakedFeesCollected1,
    totalStakedFeesCollected0:
      liquidityPoolAggregator.totalStakedFeesCollected0,
    totalStakedFeesCollected1:
      liquidityPoolAggregator.totalStakedFeesCollected1,
    totalUnstakedFeesCollectedUSD:
      liquidityPoolAggregator.totalUnstakedFeesCollectedUSD,
    totalStakedFeesCollectedUSD:
      liquidityPoolAggregator.totalStakedFeesCollectedUSD,
    totalFeesUSDWhitelisted: liquidityPoolAggregator.totalFeesUSDWhitelisted,
    numberOfSwaps: liquidityPoolAggregator.numberOfSwaps,
    token0Price: liquidityPoolAggregator.token0Price,
    token1Price: liquidityPoolAggregator.token1Price,
    totalVotesDeposited: liquidityPoolAggregator.totalVotesDeposited,
    totalVotesDepositedUSD: liquidityPoolAggregator.totalVotesDepositedUSD,
    totalEmissions: liquidityPoolAggregator.totalEmissions,
    totalEmissionsUSD: liquidityPoolAggregator.totalEmissionsUSD,
    gaugeIsAlive: liquidityPoolAggregator.gaugeIsAlive,
    gaugeAddress: liquidityPoolAggregator.gaugeAddress,
    currentLiquidityStaked: liquidityPoolAggregator.currentLiquidityStaked,
    currentLiquidityStakedUSD:
      liquidityPoolAggregator.currentLiquidityStakedUSD,
    timestamp: epoch,
    feeProtocol0: liquidityPoolAggregator.feeProtocol0,
    feeProtocol1: liquidityPoolAggregator.feeProtocol1,
    observationCardinalityNext:
      liquidityPoolAggregator.observationCardinalityNext,
    sqrtPriceX96: liquidityPoolAggregator.sqrtPriceX96,
    tick: liquidityPoolAggregator.tick,
    totalFlashLoanFees0: liquidityPoolAggregator.totalFlashLoanFees0,
    totalFlashLoanFees1: liquidityPoolAggregator.totalFlashLoanFees1,
    totalFlashLoanFeesUSD: liquidityPoolAggregator.totalFlashLoanFeesUSD,
    totalFlashLoanVolumeUSD: liquidityPoolAggregator.totalFlashLoanVolumeUSD,
    numberOfFlashLoans: liquidityPoolAggregator.numberOfFlashLoans,
    bribeVotingRewardAddress: liquidityPoolAggregator.bribeVotingRewardAddress,
    totalBribeClaimed: liquidityPoolAggregator.totalBribeClaimed,
    totalBribeClaimedUSD: liquidityPoolAggregator.totalBribeClaimedUSD,
    feeVotingRewardAddress: liquidityPoolAggregator.feeVotingRewardAddress,
    totalFeeRewardClaimed: liquidityPoolAggregator.totalFeeRewardClaimed,
    totalFeeRewardClaimedUSD: liquidityPoolAggregator.totalFeeRewardClaimedUSD,
    veNFTamountStaked: liquidityPoolAggregator.veNFTamountStaked,
    baseFee: liquidityPoolAggregator.baseFee,
    feeCap: liquidityPoolAggregator.feeCap,
    scalingFactor: liquidityPoolAggregator.scalingFactor,
    currentFee: liquidityPoolAggregator.currentFee,
  };

  context.LiquidityPoolAggregatorSnapshot.set(snapshot);
}
