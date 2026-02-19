import type { VeNFTState, handlerContext } from "generated";

import { VeNFTId } from "../Constants";

export interface VeNFTStateDiff {
  id: string;
  chainId: number;
  tokenId: bigint;
  owner: string;
  locktime: bigint;
  incrementalTotalValueLocked: bigint;
  isAlive: boolean;
  lastUpdatedTimestamp: Date;
}

export async function loadVeNFTState(
  chainId: number,
  tokenId: bigint,
  context: handlerContext,
): Promise<VeNFTState | undefined> {
  const id = VeNFTId(chainId, tokenId);
  const veNFTState = await context.VeNFTState.get(id);

  if (!veNFTState) {
    context.log.warn(`[loadVeNFTState] VeNFTState ${id} not found`);
  }

  return veNFTState;
}

/**
 * Updates VeNFTState with the provided diff
 * Uses spread operator to handle immutable entities
 */
export function updateVeNFTState(
  diff: Partial<VeNFTStateDiff>,
  current: VeNFTState,
  timestamp: Date,
  context: handlerContext,
): void {
  const veNFTState: VeNFTState = {
    ...current,
    id: diff.id ?? VeNFTId(current.chainId, current.tokenId),
    chainId: diff.chainId ?? current.chainId,
    tokenId: diff.tokenId ?? current.tokenId,
    owner: diff.owner ?? current.owner,
    locktime: diff.locktime ?? current.locktime, // lockTime of the deposit action
    lastUpdatedTimestamp: timestamp,
    totalValueLocked:
      (diff.incrementalTotalValueLocked ?? 0n) + current.totalValueLocked,
    isAlive: diff.isAlive ?? current.isAlive,
  };
  context.VeNFTState.set(veNFTState);
}
