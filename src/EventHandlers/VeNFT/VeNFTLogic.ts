import type {
  VeNFTState,
  VeNFT_Deposit_event,
  VeNFT_Transfer_event,
  VeNFT_Withdraw_event,
  handlerContext,
} from "generated";
import {
  loadOrCreateUserData,
  loadUserStatsPerPool,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import { loadPoolVotesByVeNFT } from "../../Aggregators/VeNFTPoolVote";
import { updateVeNFTState } from "../../Aggregators/VeNFTState";
import { VeNFTId, ZERO_ADDRESS } from "../../Constants";

/**
 * Processes a VeNFT Deposit event: updates the VeNFTState with the new locktime,
 * adds the deposited value to totalValueLocked, sets isAlive to true, and refreshes lastUpdatedTimestamp.
 *
 * @param event - The VeNFT Deposit event payload (locktime, value).
 * @param currentVeNFTState - The existing VeNFTState entity for this token.
 * @param context - Handler context for storage and logging.
 * @returns Resolves when the state has been persisted (no value).
 */
export async function processVeNFTDeposit(
  event: VeNFT_Deposit_event,
  currentVeNFTState: VeNFTState,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);

  const veNFTStateDiff = {
    locktime: event.params.locktime,
    incrementalTotalValueLocked: event.params.value,
    isAlive: true,
    lastUpdatedTimestamp: timestamp,
  };

  // Apply VeNFT aggregator updates
  updateVeNFTState(veNFTStateDiff, currentVeNFTState, timestamp, context);
}

/**
 * Processes a VeNFT Withdraw event: subtracts the withdrawn value from totalValueLocked
 * and refreshes lastUpdatedTimestamp. Does not set isAlive (withdraw does not burn the position).
 *
 * @param event - The VeNFT Withdraw event payload (value).
 * @param currentVeNFTState - The existing VeNFTState entity for this token.
 * @param context - Handler context for storage and logging.
 * @returns Resolves when the state has been persisted (no value).
 */
export async function processVeNFTWithdraw(
  event: VeNFT_Withdraw_event,
  currentVeNFTState: VeNFTState,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);

  const veNFTStateDiff = {
    incrementalTotalValueLocked: -event.params.value,
    lastUpdatedTimestamp: timestamp,
  };

  // Apply VeNFT aggregator updates
  updateVeNFTState(veNFTStateDiff, currentVeNFTState, timestamp, context);
}

/**
 * Processes a VeNFT Transfer event: reassigns all of the token's pool votes from the previous
 * owner to the new owner in UserStatsPerPool (see reassignVeNFTVotesOnTransfer), then updates
 * VeNFTState with the new owner, isAlive (false if burn), and lastUpdatedTimestamp.
 *
 * @param event - The VeNFT Transfer event payload (from, to, tokenId).
 * @param currentVeNFTState - The existing VeNFTState entity for this token (owner is pre-transfer).
 * @param context - Handler context for storage and logging.
 * @returns Resolves when reassignment and state update are persisted (no value).
 */
export async function processVeNFTTransfer(
  event: VeNFT_Transfer_event,
  currentVeNFTState: VeNFTState,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);

  await reassignVeNFTVotesOnTransfer(event, currentVeNFTState, context);

  const veNFTStateDiff = {
    owner: event.params.to,
    lastUpdatedTimestamp: timestamp,
    isAlive: event.params.to !== ZERO_ADDRESS,
  };

  updateVeNFTState(veNFTStateDiff, currentVeNFTState, timestamp, context);
}

/**
 * Handles the mint case of a VeNFT Transfer (from === zero address): creates the VeNFTState
 * entity with owner, chainId, tokenId, and initial timestamps. Returns the VeNFTState for the
 * token (existing or just created) so the caller can run processVeNFTTransfer for non-mint transfers.
 *
 * @param event - The VeNFT Transfer event payload (from, to, tokenId).
 * @param context - Handler context for storage and logging.
 * @returns The VeNFTState for the token, or undefined if the entity could not be loaded after mint.
 */
export async function handleMintTransfer(
  event: VeNFT_Transfer_event,
  context: handlerContext,
): Promise<VeNFTState | undefined> {
  // VeNFT minting operation
  if (event.params.from === ZERO_ADDRESS) {
    context.VeNFTState.set({
      id: VeNFTId(event.chainId, event.params.tokenId),
      chainId: event.chainId,
      tokenId: event.params.tokenId,
      owner: event.params.to,
      locktime: 0n, // This is going to be updated in the Deposit event
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      totalValueLocked: 0n, // This is going to be updated in the Deposit event
      isAlive: true,
      lastSnapshotTimestamp: undefined,
    });
  }

  const veNFTState = await context.VeNFTState.get(
    VeNFTId(event.chainId, event.params.tokenId),
  );

  if (!veNFTState) {
    context.log.error(
      `VeNFTState ${event.params.tokenId} not found during transfer on chain ${event.chainId}`,
    );
    return undefined;
  }

  return veNFTState;
}

/**
 * Reassigns vote amounts on Transfer: for each pool where the token has a positive VeNFTPoolVote,
 * decrements the previous owner's UserStatsPerPool.veNFTamountStaked by that amount and increments
 * the new owner's (unless the transfer is a burn).
 *
 * @param event - The VeNFT Transfer event (from, to, tokenId).
 * @param veNFTState - The VeNFTState for the token (owner is the previous owner).
 * @param context - Handler context for storage and logging.
 * @returns Resolves when all UserStatsPerPool updates for the reassignment are done (no value).
 */
export async function reassignVeNFTVotesOnTransfer(
  event: VeNFT_Transfer_event,
  veNFTState: VeNFTState,
  context: handlerContext,
): Promise<void> {
  const previousOwner = veNFTState.owner;
  const newOwner = event.params.to;

  if (previousOwner === newOwner) {
    context.log.debug(
      `[reassignVeNFTVotesOnTransfer] Skipping vote reassignment for tokenId ${event.params.tokenId.toString()} transfer to same owner ${newOwner}`,
    );
    return;
  }

  const poolVotes = await loadPoolVotesByVeNFT(veNFTState, context);

  const poolVotePromises = poolVotes.map((tokenIdVotes) => {
    const poolAddress = tokenIdVotes.poolAddress;
    const voteAmount = tokenIdVotes.veNFTamountStaked;

    if (voteAmount === 0n) {
      return Promise.resolve();
    }

    return Promise.all([
      updatePreviousOwnerUserStatsOnTransfer(
        event,
        previousOwner,
        poolAddress,
        voteAmount,
        context,
      ),
      updateNewOwnerUserStatsOnTransfer(
        event,
        newOwner,
        poolAddress,
        voteAmount,
        context,
      ),
    ]);
  });

  await Promise.all(poolVotePromises);
}

/**
 * On Transfer, decreases the previous owner's UserStatsPerPool.veNFTamountStaked for the given pool
 * by voteDecreaseAmount and updates lastActivityTimestamp. No-op if the user has no UserStatsPerPool row.
 *
 * @param event - The VeNFT Transfer event (used for chainId and block timestamp).
 * @param previousOwnerAddress - Address of the owner before the transfer.
 * @param poolAddress - Pool for which to decrease the staked amount.
 * @param voteDecreaseAmount - Amount to subtract from veNFTamountStaked (positive value).
 * @param context - Handler context for storage and logging.
 * @returns Resolves when the previous owner's UserStatsPerPool has been updated, or immediately if no row or zero amount.
 */
export async function updatePreviousOwnerUserStatsOnTransfer(
  event: VeNFT_Transfer_event,
  previousOwnerAddress: string,
  poolAddress: string,
  voteDecreaseAmount: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);

  const previousOwnerUserStats = await loadUserStatsPerPool(
    previousOwnerAddress,
    poolAddress,
    event.chainId,
    context,
  );

  // Should already exist since at this point a mint transfer has already been processed
  if (!previousOwnerUserStats) {
    context.log.warn(
      `[updatePreviousOwnerUserStatsOnTransfer] UserStatsPerPool missing for old owner ${previousOwnerAddress} on pool ${poolAddress} (chain ${event.chainId}) during transfer`,
    );
  } else {
    if (voteDecreaseAmount !== 0n) {
      const previousOwnerUserStatsDiff = {
        incrementalVeNFTamountStaked: -voteDecreaseAmount,
        lastActivityTimestamp: timestamp,
      };
      await updateUserStatsPerPool(
        previousOwnerUserStatsDiff,
        previousOwnerUserStats,
        context,
      );
    }
  }
}

/**
 * On Transfer, increases the new owner's UserStatsPerPool.veNFTamountStaked for the given pool by
 * voteIncreaseAmount and updates lastActivityTimestamp. Loads or creates the UserStatsPerPool row.
 * No-op if the transfer is a burn (newOwner === zero address).
 *
 * @param event - The VeNFT Transfer event (used for chainId and block timestamp).
 * @param newOwnerAddress - Address of the owner after the transfer (zero address for burns).
 * @param poolAddress - Pool for which to increase the staked amount.
 * @param voteIncreaseAmount - Amount to add to veNFTamountStaked.
 * @param context - Handler context for storage and logging.
 * @returns Resolves when the new owner's UserStatsPerPool has been updated, or immediately if burn.
 */
export async function updateNewOwnerUserStatsOnTransfer(
  event: VeNFT_Transfer_event,
  newOwnerAddress: string,
  poolAddress: string,
  voteIncreaseAmount: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);
  const isBurn = newOwnerAddress === ZERO_ADDRESS;

  if (!isBurn) {
    const newOwnerUserStats = await loadOrCreateUserData(
      newOwnerAddress,
      poolAddress,
      event.chainId,
      context,
      timestamp,
    );

    const newOwnerUserStatsDiff = {
      incrementalVeNFTamountStaked: voteIncreaseAmount,
      lastActivityTimestamp: timestamp,
    };
    await updateUserStatsPerPool(
      newOwnerUserStatsDiff,
      newOwnerUserStats,
      context,
    );
  }
}
