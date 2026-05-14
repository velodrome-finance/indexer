import type { handlerContext } from "generated";
import type { NonFungiblePosition } from "generated";

import { setNonFungiblePositionSnapshot } from "../Snapshots/NonFungiblePositionSnapshot";
import { getSnapshotEpoch, shouldSnapshot } from "../Snapshots/Shared";

export interface NonFungiblePositionDiff {
  tokenId: bigint;
  owner: string;
  pool: string;
  tickUpper: bigint;
  tickLower: bigint;
  token0: string;
  token1: string;
  incrementalLiquidity: bigint;
  mintTransactionHash: string;
  mintLogIndex: number;
  lastUpdatedTimestamp: Date;
  isStakedInGauge: boolean;
}

/**
 * Updates NonFungiblePosition with the provided diff.
 * Uses spread operator to handle immutable entities.
 * Most fields are set to absolute values (directly substituted), except liquidity which is incremental.
 * Takes an epoch-aligned snapshot when entering a new snapshot epoch.
 *
 * Liquidity writes are clamped to `>= 0n` (issue #706 latent guard). If a Decrease
 * arrives without a matching Increase — HyperSync gap, reorg, or periphery vault
 * firing Decrease without Increase — the raw subtraction would persist as negative.
 * The clamp emits a `[NEG_NFP_LIQUIDITY_GUARD]` error log so the signal stays
 * visible without aborting the indexer.
 */
export function updateNonFungiblePosition(
  diff: Partial<NonFungiblePositionDiff>,
  current: NonFungiblePosition,
  context: handlerContext,
  timestamp: Date,
): void {
  const delta = diff.incrementalLiquidity ?? 0n;
  const rawLiquidity = current.liquidity + delta;
  let clampedLiquidity = rawLiquidity;
  if (rawLiquidity < 0n) {
    context.log.error(
      `[NEG_NFP_LIQUIDITY_GUARD] tokenId=${current.tokenId} chain=${current.chainId} prior=${current.liquidity} delta=${delta} clampedTo=0`,
    );
    clampedLiquidity = 0n;
  }

  let nonFungiblePosition: NonFungiblePosition = {
    ...current,
    tokenId: diff.tokenId ?? current.tokenId,
    owner: diff.owner ?? current.owner,
    pool: diff.pool ?? current.pool,
    tickUpper: diff.tickUpper ?? current.tickUpper,
    tickLower: diff.tickLower ?? current.tickLower,
    token0: diff.token0 ?? current.token0,
    token1: diff.token1 ?? current.token1,
    liquidity: clampedLiquidity,
    mintTransactionHash:
      diff.mintTransactionHash ?? current.mintTransactionHash,
    mintLogIndex: diff.mintLogIndex ?? current.mintLogIndex,
    lastUpdatedTimestamp:
      diff.lastUpdatedTimestamp ?? current.lastUpdatedTimestamp,
    isStakedInGauge: diff.isStakedInGauge ?? current.isStakedInGauge,
  };

  if (shouldSnapshot(current.lastSnapshotTimestamp, timestamp)) {
    setNonFungiblePositionSnapshot(nonFungiblePosition, timestamp, context);
    nonFungiblePosition = {
      ...nonFungiblePosition,
      lastSnapshotTimestamp: getSnapshotEpoch(timestamp),
    };
  }

  context.NonFungiblePosition.set(nonFungiblePosition);
}
