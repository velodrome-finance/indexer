import type {
  ALM_LP_Wrapper,
  ALM_LP_WrapperSnapshot,
  handlerContext,
} from "generated";

import { ALMLPWrapperSnapshotId } from "../Constants";
import { getSnapshotEpoch } from "./Shared";

/**
 * Creates and persists an epoch-aligned snapshot of ALM_LP_Wrapper.
 * @param entity - ALM_LP_Wrapper to snapshot
 * @param timestamp - Timestamp of the snapshot
 * @param context - Handler context
 * @returns void
 */
export function setALMLPWrapperSnapshot(
  entity: ALM_LP_Wrapper,
  timestamp: Date,
  context: handlerContext,
): void {
  const epoch = getSnapshotEpoch(timestamp);
  // entity.id is ALMLPWrapperId: {chainId}-{wrapperAddress}
  const wrapperAddress = entity.id.includes("-")
    ? entity.id.split("-").slice(1).join("-")
    : entity.id;

  const snapshotId = ALMLPWrapperSnapshotId(
    entity.chainId,
    wrapperAddress,
    epoch.getTime(),
  );

  const snapshot: ALM_LP_WrapperSnapshot = {
    id: snapshotId,
    wrapper: wrapperAddress,
    pool: entity.pool,
    chainId: entity.chainId,
    token0: entity.token0,
    token1: entity.token1,
    lpAmount: entity.lpAmount,
    lastUpdatedTimestamp: entity.lastUpdatedTimestamp,
    tokenId: entity.tokenId,
    tickLower: entity.tickLower,
    tickUpper: entity.tickUpper,
    property: entity.property,
    liquidity: entity.liquidity,
    strategyType: entity.strategyType,
    tickNeighborhood: entity.tickNeighborhood,
    tickSpacing: entity.tickSpacing,
    positionWidth: entity.positionWidth,
    maxLiquidityRatioDeviationX96: entity.maxLiquidityRatioDeviationX96,
    creationTimestamp: entity.creationTimestamp,
    strategyTransactionHash: entity.strategyTransactionHash,
    timestamp: epoch,
  };

  context.ALM_LP_WrapperSnapshot.set(snapshot);
}
