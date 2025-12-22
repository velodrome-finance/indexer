import { ALMLPWrapperV2 } from "generated";
import { updateALMLPWrapper } from "../../Aggregators/ALMLPWrapper";
import {
  loadUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import { recalculateLPWrapperAmountsFromLiquidity } from "./LPWrapperLogic";

/**
 * Handler for ALM LP Wrapper Deposit events
 *
 * When a user deposits into an ALM LP Wrapper:
 * 1. Updates the pool-level ALM_LP_Wrapper entity with increased amounts
 * 2. Updates the user-level UserStatsPerPool entity for the recipient
 *    (who receives the LP tokens) with their ALM position
 */
ALMLPWrapperV2.Deposit.handler(async ({ event, context }) => {
  const { recipient, pool, amount0, amount1, lpAmount } = event.params;
  const timestamp = new Date(event.block.timestamp * 1000);

  // Should be created already by StrategyCreated event
  // Note: event.srcAddress should already be checksummed if tests use checksummed addresses
  const lpWrapperId = `${event.srcAddress}_${event.chainId}`;
  const ALMLPWrapperEntity = await context.ALM_LP_Wrapper.get(lpWrapperId);

  if (!ALMLPWrapperEntity) {
    context.log.error(
      `ALM_LP_Wrapper entity not found for ${lpWrapperId}. It should have been created by StrategyCreated event.`,
    );
    return;
  }

  const userStats = await loadUserData(
    recipient,
    pool,
    event.chainId,
    context,
    timestamp,
  );

  // Recalculate amount0 and amount1 from current liquidity and current price
  // Then add the deposited amounts to reflect the new tokens added to the position
  const { amount0: recalculatedAmount0, amount1: recalculatedAmount1 } =
    await recalculateLPWrapperAmountsFromLiquidity(
      ALMLPWrapperEntity,
      pool,
      event.chainId,
      event.block.number,
      context,
      "Deposit",
    );

  const ALMLPWrapperDiff = {
    amount0: recalculatedAmount0 + amount0,
    amount1: recalculatedAmount1 + amount1,
    lpAmount: lpAmount,
  };

  const userStatsDiff = {
    almAddress: event.srcAddress,
    almAmount0: amount0,
    almAmount1: amount1,
    almLpAmount: lpAmount,
  };

  // Update pool-level ALM_LP_Wrapper entity and user-level UserStatsPerPool entity in parallel
  await Promise.all([
    updateALMLPWrapper(
      ALMLPWrapperDiff,
      ALMLPWrapperEntity,
      timestamp,
      context,
    ),
    // Update user-level UserStatsPerPool entity for the recipient
    // The recipient receives the LP tokens, so they are the one with the ALM position
    updateUserStatsPerPool(userStatsDiff, userStats, timestamp, context),
  ]);
});

/**
 * Handler for ALM LP Wrapper Withdraw events
 *
 * When a user withdraws from an ALM LP Wrapper:
 * 1. Updates the pool-level ALM_LP_Wrapper entity with decreased amounts
 * 2. Updates the user-level UserStatsPerPool entity for the sender
 *    (who withdraws and receives tokens) with their reduced ALM position
 */
ALMLPWrapperV2.Withdraw.handler(async ({ event, context }) => {
  const { recipient, pool, amount0, amount1, lpAmount } = event.params;
  const timestamp = new Date(event.block.timestamp * 1000);

  // Should be created already by StrategyCreated event
  // Note: event.srcAddress should already be checksummed if tests use checksummed addresses
  const lpWrapperId = `${event.srcAddress}_${event.chainId}`;
  const ALMLPWrapperEntity = await context.ALM_LP_Wrapper.get(lpWrapperId);

  if (!ALMLPWrapperEntity) {
    context.log.error(
      `ALM_LP_Wrapper entity not found for ${lpWrapperId}. It should have been created by StrategyCreated event.`,
    );
    return;
  }

  const userStats = await loadUserData(
    recipient,
    pool,
    event.chainId,
    context,
    timestamp,
  );

  // Recalculate amount0 and amount1 from current liquidity and current price
  // Then subtract the withdrawn amounts to reflect the tokens removed from the position
  const { amount0: recalculatedAmount0, amount1: recalculatedAmount1 } =
    await recalculateLPWrapperAmountsFromLiquidity(
      ALMLPWrapperEntity,
      pool,
      event.chainId,
      event.block.number,
      context,
      "Withdraw",
    );

  const ALMLPWrapperDiff = {
    amount0: recalculatedAmount0 - amount0,
    amount1: recalculatedAmount1 - amount1,
    lpAmount: -lpAmount,
  };

  const userStatsDiff = {
    almAmount0: -amount0,
    almAmount1: -amount1,
    almLpAmount: -lpAmount,
  };

  // Update pool-level ALM_LP_Wrapper entity and user-level UserStatsPerPool entity in parallel
  await Promise.all([
    updateALMLPWrapper(
      ALMLPWrapperDiff,
      ALMLPWrapperEntity,
      timestamp,
      context,
    ),
    // Update user-level UserStatsPerPool entity for the sender
    // The sender withdraws and receives tokens, so their position decreases
    updateUserStatsPerPool(userStatsDiff, userStats, timestamp, context),
  ]);
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
ALMLPWrapperV2.Transfer.handler(async ({ event, context }) => {
  const { from, to, value } = event.params;
  const timestamp = new Date(event.block.timestamp * 1000);

  // Load wrapper - poolAddress is not available in Transfer events
  // The wrapper should already exist from previous Deposit/Withdraw or StrategyCreated events
  const lpWrapperId = `${event.srcAddress}_${event.chainId}`;
  const ALMLPWrapperEntity = await context.ALM_LP_Wrapper.get(lpWrapperId);

  if (!ALMLPWrapperEntity) {
    context.log.error(
      `ALM_LP_Wrapper entity not found for ${lpWrapperId}. It should have been created by StrategyCreated event.`,
    );
    return;
  }

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

/**
 * Handler for ALM LP Wrapper TotalSupplyLimitUpdated events
 *
 * Persists the current LP token supply for a wrapper so other handlers
 * (e.g., StrategyCreated) can seed `lpAmount` from the latest supply.
 */
ALMLPWrapperV2.TotalSupplyLimitUpdated.handler(async ({ event, context }) => {
  const { totalSupplyCurrent } = event.params;

  const ALM_TotalSupplyLimitUpdated_event = {
    id: `${event.srcAddress}_${event.chainId}`,
    lpWrapperAddress: event.srcAddress,
    currentTotalSupplyLPTokens: totalSupplyCurrent,
    transactionHash: event.transaction.hash,
  };

  context.ALM_TotalSupplyLimitUpdated_event.set(
    ALM_TotalSupplyLimitUpdated_event,
  );
});
