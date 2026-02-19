import type { VeNFTPoolVote, VeNFTState, handlerContext } from "generated";

import { VeNFTPoolVoteId } from "../Constants";

export interface VeNFTPoolVoteDiff {
  poolAddress: string;
  incrementalVeNFTamountStaked: bigint;
  veNFTStateId: string;
  lastUpdatedTimestamp: Date;
}

/**
 * Loads a VeNFTPoolVote entity by its ID
 * @param chainId - The chain ID
 * @param tokenId - The veNFT token ID
 * @param poolAddress - The pool address
 * @param context - The handler context
 * @returns Promise<VeNFTPoolVote | undefined> - The VeNFTPoolVote entity or undefined if not found
 */
export async function loadVeNFTPoolVote(
  chainId: number,
  tokenId: bigint,
  poolAddress: string,
  context: handlerContext,
): Promise<VeNFTPoolVote | undefined> {
  const id = VeNFTPoolVoteId(chainId, tokenId, poolAddress);
  return context.VeNFTPoolVote.get(id);
}

export async function loadPoolVotesByVeNFT(
  veNFTState: VeNFTState,
  context: handlerContext,
): Promise<VeNFTPoolVote[]> {
  const votesByState = await context.VeNFTPoolVote.getWhere.veNFTState_id.eq(
    veNFTState.id,
  );

  return votesByState ?? [];
}

/**
 * Loads or creates tokenId-pool vote tracking entity.
 * If the entity does not exist, it is created with initial values.
 */
export async function loadOrCreateVeNFTPoolVote(
  chainId: number,
  tokenId: bigint,
  poolAddress: string,
  veNFTState: VeNFTState,
  context: handlerContext,
  timestamp: Date,
): Promise<VeNFTPoolVote> {
  const veNFTPoolVotes = await context.VeNFTPoolVote.getOrCreate({
    id: VeNFTPoolVoteId(chainId, tokenId, poolAddress),
    poolAddress: poolAddress,
    veNFTamountStaked: 0n,
    veNFTState_id: veNFTState.id,
    lastUpdatedTimestamp: timestamp,
  });

  return veNFTPoolVotes;
}

/**
 * Updates VeNFTPoolVote with incremental diff values.
 */
export async function updateVeNFTPoolVote(
  diff: Partial<VeNFTPoolVoteDiff>,
  current: VeNFTPoolVote,
  context: handlerContext,
): Promise<VeNFTPoolVote> {
  const updated: VeNFTPoolVote = {
    ...current,
    poolAddress: diff.poolAddress ?? current.poolAddress,
    veNFTamountStaked:
      diff.incrementalVeNFTamountStaked !== undefined
        ? current.veNFTamountStaked + diff.incrementalVeNFTamountStaked
        : current.veNFTamountStaked,
    veNFTState_id: diff.veNFTStateId ?? current.veNFTState_id,
    lastUpdatedTimestamp:
      diff.lastUpdatedTimestamp ?? current.lastUpdatedTimestamp,
  };

  context.VeNFTPoolVote.set(updated);
  return updated;
}
