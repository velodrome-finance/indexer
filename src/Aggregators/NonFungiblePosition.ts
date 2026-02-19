import type { handlerContext } from "generated";
import type { NonFungiblePosition } from "generated";

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
}

/**
 * Updates NonFungiblePosition with the provided diff
 * Uses spread operator to handle immutable entities
 * Most fields are set to absolute values (directly substituted), except liquidity which is incremental
 * (current.liquidity + diff.incrementalLiquidity)
 */
export function updateNonFungiblePosition(
  diff: Partial<NonFungiblePositionDiff>,
  current: NonFungiblePosition,
  context: handlerContext,
): void {
  const nonFungiblePosition: NonFungiblePosition = {
    ...current,
    tokenId: diff.tokenId ?? current.tokenId,
    owner: diff.owner ?? current.owner,
    pool: diff.pool ?? current.pool,
    tickUpper: diff.tickUpper ?? current.tickUpper,
    tickLower: diff.tickLower ?? current.tickLower,
    token0: diff.token0 ?? current.token0,
    token1: diff.token1 ?? current.token1,
    liquidity: (diff.incrementalLiquidity ?? 0n) + current.liquidity,
    mintTransactionHash:
      diff.mintTransactionHash ?? current.mintTransactionHash,
    mintLogIndex: diff.mintLogIndex ?? current.mintLogIndex,
    lastUpdatedTimestamp:
      diff.lastUpdatedTimestamp ?? current.lastUpdatedTimestamp,
  };
  context.NonFungiblePosition.set(nonFungiblePosition);
}
