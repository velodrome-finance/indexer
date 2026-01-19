import type { handlerContext } from "generated";
import type { VeNFTAggregator } from "generated";

export interface VeNFTAggregatorDiff {
  id: string;
  chainId: number;
  tokenId: bigint;
  owner: string;
  locktime: bigint;
  incrementalTotalValueLocked: bigint;
  isAlive: boolean;
  lastUpdatedTimestamp: Date;
}

export const VeNFTId = (chainId: number, tokenId: bigint) =>
  `${chainId}_${tokenId}`;

/**
 * Updates VeNFTAggregator with the provided diff
 * Uses spread operator to handle immutable entities
 */
export function updateVeNFTAggregator(
  diff: Partial<VeNFTAggregatorDiff>,
  current: VeNFTAggregator,
  timestamp: Date,
  context: handlerContext,
): void {
  const veNFTAggregator: VeNFTAggregator = {
    ...current,
    id: diff.id ?? `${current.chainId}_${current.tokenId}`,
    chainId: diff.chainId ?? current.chainId,
    tokenId: diff.tokenId ?? current.tokenId,
    owner: diff.owner ?? current.owner,
    locktime: diff.locktime ?? current.locktime, // lockTime of the deposit action
    lastUpdatedTimestamp: timestamp,
    totalValueLocked:
      (diff.incrementalTotalValueLocked ?? 0n) + current.totalValueLocked,
    isAlive: diff.isAlive ?? current.isAlive,
  };
  context.VeNFTAggregator.set(veNFTAggregator);
}
