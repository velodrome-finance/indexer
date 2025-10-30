import { ALMLPWrapper } from "generated";
import {
  loadOrCreateALMLPWrapper,
  updateALMLPWrapper,
} from "../../Aggregators/ALMLPWrapper";
import {
  loadUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import { toChecksumAddress } from "../../Constants";

/**
 * Handler for ALM LP Wrapper Deposit events
 *
 * When a user deposits into an ALM LP Wrapper:
 * 1. Updates the pool-level ALM_LP_Wrapper entity with increased amounts
 * 2. Updates the user-level UserStatsPerPool entity for the recipient
 *    (who receives the LP tokens) with their ALM position
 */
ALMLPWrapper.Deposit.handler(async ({ event, context }) => {
  const { recipient, pool, amount0, amount1, lpAmount } = event.params;
  const timestamp = new Date(event.block.timestamp * 1000);

  const ALMLPWrapperEntity = await loadOrCreateALMLPWrapper(
    event.srcAddress,
    pool,
    event.chainId,
    context,
    timestamp,
  );

  const userStats = await loadUserData(
    recipient,
    pool,
    event.chainId,
    context,
    timestamp,
  );

  if (context.isPreload) {
    return;
  }

  const ALMLPWrapperDiff = {
    amount0,
    amount1,
    lpAmount,
  };

  // Update pool-level ALM_LP_Wrapper entity (aggregates total across all users)
  await updateALMLPWrapper(
    ALMLPWrapperDiff,
    ALMLPWrapperEntity,
    timestamp,
    context,
  );

  const userStatsDiff = {
    almAmount0: amount0,
    almAmount1: amount1,
    almLpAmount: lpAmount,
  };

  // Update user-level UserStatsPerPool entity for the recipient
  // The recipient receives the LP tokens, so they are the one with the ALM position
  await updateUserStatsPerPool(userStatsDiff, userStats, timestamp, context);
});

/**
 * Handler for ALM LP Wrapper Withdraw events
 *
 * When a user withdraws from an ALM LP Wrapper:
 * 1. Updates the pool-level ALM_LP_Wrapper entity with decreased amounts
 * 2. Updates the user-level UserStatsPerPool entity for the sender
 *    (who withdraws and receives tokens) with their reduced ALM position
 */
ALMLPWrapper.Withdraw.handler(async ({ event, context }) => {
  const { recipient, pool, amount0, amount1, lpAmount } = event.params;
  const timestamp = new Date(event.block.timestamp * 1000);

  const ALMLPWrapperEntity = await loadOrCreateALMLPWrapper(
    event.srcAddress,
    pool,
    event.chainId,
    context,
    timestamp,
  );

  const userStats = await loadUserData(
    recipient,
    pool,
    event.chainId,
    context,
    timestamp,
  );

  if (context.isPreload) {
    return;
  }

  const ALMLPWrapperDiff = {
    amount0: -amount0,
    amount1: -amount1,
    lpAmount: -lpAmount,
  };

  // Update pool-level ALM_LP_Wrapper entity (subtract amounts)
  await updateALMLPWrapper(
    ALMLPWrapperDiff,
    ALMLPWrapperEntity,
    timestamp,
    context,
  );

  const userStatsDiff = {
    almAmount0: -amount0,
    almAmount1: -amount1,
    almLpAmount: -lpAmount,
  };

  // Update user-level UserStatsPerPool entity for the sender
  // The sender withdraws and receives tokens, so their position decreases
  await updateUserStatsPerPool(userStatsDiff, userStats, timestamp, context);
});

/**
 * Handler for ALM LP Wrapper Transfer events
 *
 * Transfer events are ERC20 token transfers of LP wrapper tokens between users.
 * These transfers don't affect the pool-level underlying liquidity amounts (amount0/amount1/lpAmount),
 * as they only change ownership of LP tokens, not the underlying pool position.
 *
 * However, we do update user-level ALM positions:
 * - The sender's almLpAmount is decreased (tokens transferred away)
 * - The recipient's almLpAmount is increased (tokens received)
 * - The pool address is obtained from the existing ALM_LP_Wrapper entity
 *   (which should already exist from previous Deposit/Withdraw events)
 *
 * Note: If the wrapper doesn't exist, this will fail since Transfer events don't include pool info.
 * This is expected behavior - wrappers should be created via Deposit/Withdraw events first.
 */
ALMLPWrapper.Transfer.handler(async ({ event, context }) => {
  const { from, to, value } = event.params;
  const timestamp = new Date(event.block.timestamp * 1000);

  // Load wrapper - poolAddress is optional since Transfer events don't include pool info
  // The wrapper should already exist from previous Deposit/Withdraw events
  const ALMLPWrapperEntity = await loadOrCreateALMLPWrapper(
    event.srcAddress,
    undefined, // poolAddress not available in Transfer events
    event.chainId,
    context,
    timestamp,
  );

  const [userStatsFrom, userStatsTo] = await Promise.all([
    loadUserData(
      from,
      ALMLPWrapperEntity.pool,
      event.chainId,
      context,
      timestamp,
    ),
    loadUserData(
      to,
      ALMLPWrapperEntity.pool,
      event.chainId,
      context,
      timestamp,
    ),
  ]);

  if (context.isPreload) {
    return;
  }

  const UserStatsFromDiff = {
    almLpAmount: -value,
  };

  const UserStatsToDiff = {
    almLpAmount: value,
  };

  await Promise.all([
    updateUserStatsPerPool(
      UserStatsFromDiff,
      userStatsFrom,
      timestamp,
      context,
    ),
    updateUserStatsPerPool(UserStatsToDiff, userStatsTo, timestamp, context),
  ]);
});
