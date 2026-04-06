import type {
  VeNFTState,
  VeNFT_DepositManaged_event,
  VeNFT_Deposit_event,
  VeNFT_Merge_event,
  VeNFT_Split_event,
  VeNFT_Transfer_event,
  VeNFT_WithdrawManaged_event,
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
import {
  SECONDS_IN_A_WEEK,
  SECONDS_IN_FOUR_YEARS,
  VeNFTId,
  ZERO_ADDRESS,
} from "../../Constants";

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
  await updateVeNFTState(veNFTStateDiff, currentVeNFTState, timestamp, context);
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
  await updateVeNFTState(veNFTStateDiff, currentVeNFTState, timestamp, context);
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

  await updateVeNFTState(veNFTStateDiff, currentVeNFTState, timestamp, context);
}

/**
 * Reconciles a VeNFT position to an absolute target state.
 *
 * This helper translates an event-authoritative target TVL into the incremental
 * diff expected by `updateVeNFTState`. It is used for flows such as `Merge`,
 * `Split`, and managed-lock transitions where the contract emits the resulting
 * balance directly and the indexer must correct any stale intermediate value.
 *
 * @param currentVeNFTState - The current persisted state for the affected token.
 * @param timestamp - The block timestamp for the event being processed.
 * @param context - Handler context used to persist the reconciled entity.
 * @param target - The desired post-event state for the token. `totalValueLocked`
 * is treated as an absolute value; the other fields override the current entity
 * only when provided.
 */
async function reconcileVeNFTState(
  currentVeNFTState: VeNFTState,
  timestamp: Date,
  context: handlerContext,
  target: {
    totalValueLocked: bigint;
    owner?: string;
    locktime?: bigint;
    isAlive?: boolean;
  },
): Promise<void> {
  const veNFTStateDiff = {
    owner: target.owner,
    locktime: target.locktime,
    isAlive: target.isAlive,
    incrementalTotalValueLocked:
      target.totalValueLocked - currentVeNFTState.totalValueLocked,
    lastUpdatedTimestamp: timestamp,
  };

  await updateVeNFTState(veNFTStateDiff, currentVeNFTState, timestamp, context);
}

/**
 * Reconstructs the lock end for a token leaving a managed position.
 *
 * The voting escrow contract restores the withdrawn token to a standard
 * four-year lock aligned to week boundaries. The event exposes the withdrawal
 * timestamp, so the indexer reproduces the contract's rounding logic here.
 *
 * @param ts - The withdrawal timestamp emitted by `WithdrawManaged`.
 * @returns The reconstructed lock end, rounded down to the nearest week.
 */
function getManagedWithdrawLocktime(ts: bigint): bigint {
  return ((ts + SECONDS_IN_FOUR_YEARS) / SECONDS_IN_A_WEEK) * SECONDS_IN_A_WEEK;
}

/**
 * Reconciles both sides of a `Merge` into their post-event TVL state.
 *
 * The source token is burned by the merge and must end with zero TVL and
 * `isAlive = false`. The destination token keeps the merged position and is
 * reconciled to `_amountFinal` and `_locktime` from the event payload.
 *
 * @param event - The merge event carrying the authoritative destination amount
 * and locktime.
 * @param fromVeNFTState - Current state for the burned source token.
 * @param toVeNFTState - Current state for the surviving destination token.
 * @param context - Handler context used to persist both reconciled entities.
 */
export async function processVeNFTMerge(
  event: VeNFT_Merge_event,
  fromVeNFTState: VeNFTState,
  toVeNFTState: VeNFTState,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);

  const fromVeNFTStateDiff = {
    totalValueLocked: 0n,
    locktime: 0n,
    isAlive: false,
  };

  const toVeNFTStateDiff = {
    totalValueLocked: event.params._amountFinal,
    locktime: event.params._locktime,
    isAlive: true,
  };

  await Promise.all([
    reconcileVeNFTState(fromVeNFTState, timestamp, context, fromVeNFTStateDiff),
    reconcileVeNFTState(toVeNFTState, timestamp, context, toVeNFTStateDiff),
  ]);
}

/**
 * Reconciles a `Split` into the exact balances emitted by the contract.
 *
 * The original token is fully consumed by the split and must end at zero TVL
 * with `isAlive = false`. The two child tokens are reconciled to the
 * authoritative split amounts and shared locktime provided by the event.
 *
 * @param event - The split event carrying both child amounts and the resulting
 * locktime.
 * @param fromVeNFTState - Current state for the token being split.
 * @param token1VeNFTState - Current state for the first child token.
 * @param token2VeNFTState - Current state for the second child token.
 * @param context - Handler context used to persist all three reconciled entities.
 */
export async function processVeNFTSplit(
  event: VeNFT_Split_event,
  fromVeNFTState: VeNFTState,
  token1VeNFTState: VeNFTState,
  token2VeNFTState: VeNFTState,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);

  const originalVeNFTStateDiff = {
    totalValueLocked: 0n,
    locktime: 0n,
    isAlive: false,
  };

  const token1VeNFTStateDiff = {
    totalValueLocked: event.params._splitAmount1,
    locktime: event.params._locktime,
    isAlive: true,
  };

  const token2VeNFTStateDiff = {
    totalValueLocked: event.params._splitAmount2,
    locktime: event.params._locktime,
    isAlive: true,
  };

  await Promise.all([
    reconcileVeNFTState(
      fromVeNFTState,
      timestamp,
      context,
      originalVeNFTStateDiff,
    ),
    reconcileVeNFTState(
      token1VeNFTState,
      timestamp,
      context,
      token1VeNFTStateDiff,
    ),
    reconcileVeNFTState(
      token2VeNFTState,
      timestamp,
      context,
      token2VeNFTStateDiff,
    ),
  ]);
}

/**
 * Reconciles TVL movement when a standard veNFT is deposited into a managed lock.
 *
 * After `DepositManaged`, the source token no longer carries independent TVL,
 * so it is reconciled to zero. The managed token absorbs the emitted `_weight`,
 * which is added to its current TVL to reach the post-event balance.
 *
 * @param event - The managed-deposit event carrying the transferred weight.
 * @param tokenVeNFTState - Current state for the deposited standard token.
 * @param managedVeNFTState - Current state for the managed token receiving the weight.
 * @param context - Handler context used to persist both reconciled entities.
 */
export async function processVeNFTDepositManaged(
  event: VeNFT_DepositManaged_event,
  tokenVeNFTState: VeNFTState,
  managedVeNFTState: VeNFTState,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);

  const tokenVeNFTStateDiff = {
    totalValueLocked: 0n,
  };

  const managedVeNFTStateDiff = {
    totalValueLocked: managedVeNFTState.totalValueLocked + event.params._weight,
  };

  // DepositManaged moves value out of the standard token into the managed token,
  // but it does not burn or replace the standard token ID. Keep `isAlive` unchanged:
  // the NFT still exists on-chain, keeps its owner, and can later receive TVL again
  // via WithdrawManaged. This differs from Merge / Split / burn flows, where the
  // source token ID is actually destroyed and should be marked not alive.
  await Promise.all([
    reconcileVeNFTState(
      tokenVeNFTState,
      timestamp,
      context,
      tokenVeNFTStateDiff,
    ),
    reconcileVeNFTState(
      managedVeNFTState,
      timestamp,
      context,
      managedVeNFTStateDiff,
    ),
  ]);
}

/**
 * Reconciles TVL movement when weight is withdrawn from a managed lock.
 *
 * The withdrawn standard token is restored with TVL equal to the emitted
 * `_weight` and a new four-year lock derived from `_ts`. The managed token is
 * reduced by the same amount so the pair remains consistent with contract state.
 *
 * @param event - The managed-withdraw event carrying the returned weight and timestamp.
 * @param tokenVeNFTState - Current state for the token receiving the withdrawn weight.
 * @param managedVeNFTState - Current state for the managed token losing the weight.
 * @param context - Handler context used to persist both reconciled entities.
 */
export async function processVeNFTWithdrawManaged(
  event: VeNFT_WithdrawManaged_event,
  tokenVeNFTState: VeNFTState,
  managedVeNFTState: VeNFTState,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);

  const tokenVeNFTStateDiff = {
    totalValueLocked: event.params._weight,
    locktime: getManagedWithdrawLocktime(event.params._ts),
    isAlive: true,
  };

  const managedVeNFTStateDiff = {
    totalValueLocked: managedVeNFTState.totalValueLocked - event.params._weight,
  };

  // WithdrawManaged restores value into an existing standard token ID. We set
  // `isAlive = true` explicitly because the token is a live NFT position after
  // the withdrawal; it was never burned during the managed-deposit period, only
  // temporarily reduced to zero standalone TVL.
  await Promise.all([
    reconcileVeNFTState(
      tokenVeNFTState,
      timestamp,
      context,
      tokenVeNFTStateDiff,
    ),
    reconcileVeNFTState(
      managedVeNFTState,
      timestamp,
      context,
      managedVeNFTStateDiff,
    ),
  ]);
}

/**
 * Ensures a VeNFT row exists for transfers involving newly minted token IDs.
 *
 * A mint `Transfer` is used only to create the entity shell. TVL is intentionally
 * initialized to zero because amount-carrying events such as `Deposit` or `Split`
 * are responsible for reconciling the actual locked balance afterward.
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
      // TVL-changing flows such as Split emit Transfer before the amount-carrying event.
      // Create the shell here and let the follow-up VeNFT event reconcile TVL.
      locktime: 0n,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      totalValueLocked: 0n,
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
    return;
  }

  const poolVotes = await loadPoolVotesByVeNFT(veNFTState, context);

  const poolVotePromises = poolVotes.map((tokenIdVotes) => {
    const poolAddress = tokenIdVotes.poolAddress;
    const voteAmount = tokenIdVotes.veNFTamountStaked;
    const poolChainId = Number(tokenIdVotes.id.split("-", 1)[0]);

    if (voteAmount === 0n) {
      return Promise.resolve();
    }

    return Promise.all([
      updatePreviousOwnerUserStatsOnTransfer(
        event,
        previousOwner,
        poolAddress,
        poolChainId,
        voteAmount,
        context,
      ),
      updateNewOwnerUserStatsOnTransfer(
        event,
        newOwner,
        poolAddress,
        poolChainId,
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
 * @param poolChainId - Chain ID of the pool.
 * @param voteDecreaseAmount - Amount to subtract from veNFTamountStaked (positive value).
 * @param context - Handler context for storage and logging.
 * @returns Resolves when the previous owner's UserStatsPerPool has been updated, or immediately if no row or zero amount.
 */
export async function updatePreviousOwnerUserStatsOnTransfer(
  event: VeNFT_Transfer_event,
  previousOwnerAddress: string,
  poolAddress: string,
  poolChainId: number,
  voteDecreaseAmount: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);

  const previousOwnerUserStats = await loadUserStatsPerPool(
    previousOwnerAddress,
    poolAddress,
    poolChainId,
    context,
  );

  // Should already exist since at this point a mint transfer has already been processed
  if (!previousOwnerUserStats) {
    context.log.warn(
      `[updatePreviousOwnerUserStatsOnTransfer] UserStatsPerPool missing for old owner ${previousOwnerAddress} on pool ${poolAddress} (chain ${poolChainId}) during transfer`,
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
        timestamp,
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
 * @param poolChainId - Chain ID of the pool.
 * @param voteIncreaseAmount - Amount to add to veNFTamountStaked.
 * @param context - Handler context for storage and logging.
 * @returns Resolves when the new owner's UserStatsPerPool has been updated, or immediately if burn.
 */
export async function updateNewOwnerUserStatsOnTransfer(
  event: VeNFT_Transfer_event,
  newOwnerAddress: string,
  poolAddress: string,
  poolChainId: number,
  voteIncreaseAmount: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(event.block.timestamp * 1000);
  const isBurn = newOwnerAddress === ZERO_ADDRESS;

  if (!isBurn) {
    const newOwnerUserStats = await loadOrCreateUserData(
      newOwnerAddress,
      poolAddress,
      poolChainId,
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
      timestamp,
    );
  }
}
