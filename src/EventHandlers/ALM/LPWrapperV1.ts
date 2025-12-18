import { ALMLPWrapperV1 } from "generated";
import { updateALMLPWrapper } from "../../Aggregators/ALMLPWrapper";
import {
  loadUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import {
  calculateLiquidityFromAmounts,
  deriveUserAmounts,
} from "./LPWrapperLogic";

/**
 * Handler for ALM LP Wrapper Deposit events
 *
 * When a user deposits into an ALM LP Wrapper:
 * 1. Updates the pool-level ALM_LP_Wrapper entity with increased amounts
 * 2. Updates the user-level UserStatsPerPool entity for the recipient
 *    (who receives the LP tokens) with their ALM position
 *
 * Note: In V1, Deposit event has both `sender` and `recipient` fields.
 * The `recipient` is the one who receives the LP tokens and should have their stats updated.
 */
ALMLPWrapperV1.Deposit.handler(async ({ event, context }) => {
  const { recipient, pool, lpAmount, amount0, amount1 } = event.params;
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

  const updatedAmount0 = ALMLPWrapperEntity.amount0 + amount0;
  const updatedAmount1 = ALMLPWrapperEntity.amount1 + amount1;

  const updatedLiquidity = await calculateLiquidityFromAmounts(
    ALMLPWrapperEntity,
    updatedAmount0,
    updatedAmount1,
    pool,
    event.chainId,
    event.block.number,
    context,
    "Deposit",
  );

  const ALMLPWrapperDiff = {
    amount0: updatedAmount0,
    amount1: updatedAmount1,
    lpAmount: lpAmount,
    liquidity: updatedLiquidity,
    ammStateIsDerived: true, // Derived from amount0 and amount1 at a specific price; not derived from on-chain AMM position (i.e. Rebalance event)
  };

  // Derive user's current balance from their LP share after deposit
  // Use updatedAmount0/amount1 (wrapper amounts AFTER deposit) to calculate user's position
  const derivedUserAmounts = deriveUserAmounts(
    userStats.almLpAmount + lpAmount, // User's LP after deposit
    ALMLPWrapperEntity.lpAmount + lpAmount, // Total LP after deposit
    updatedAmount0, // Wrapper amount0 AFTER deposit
    updatedAmount1, // Wrapper amount1 AFTER deposit
  );

  const userStatsDiff = {
    almAddress: event.srcAddress,
    almAmount0: derivedUserAmounts.amount0,
    almAmount1: derivedUserAmounts.amount1,
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
 * 2. Updates the user-level UserStatsPerPool entity for the recipient
 *    (who withdraws and receives tokens) with their reduced ALM position
 *
 * Note: In V1, Withdraw event has both `sender` and `recipient` fields.
 * The `recipient` is the one who receives the tokens and should have their stats updated.
 */
ALMLPWrapperV1.Withdraw.handler(async ({ event, context }) => {
  const { recipient, pool, lpAmount, amount0, amount1 } = event.params;
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

  const updatedAmount0 = ALMLPWrapperEntity.amount0 - amount0;
  const updatedAmount1 = ALMLPWrapperEntity.amount1 - amount1;

  const updatedLiquidity = await calculateLiquidityFromAmounts(
    ALMLPWrapperEntity,
    updatedAmount0,
    updatedAmount1,
    pool,
    event.chainId,
    event.block.number,
    context,
    "Withdraw",
  );

  const ALMLPWrapperDiff = {
    amount0: updatedAmount0,
    amount1: updatedAmount1,
    lpAmount: -lpAmount,
    liquidity: updatedLiquidity,
    ammStateIsDerived: true, // Derived from amount0 and amount1 at a specific price; not derived from on-chain AMM position (i.e. Rebalance event)
  };

  // Derive user's current balance from their LP share after withdrawal
  // Use updatedAmount0/amount1 (wrapper amounts AFTER withdrawal) to calculate user's remaining position
  const derivedUserAmounts = deriveUserAmounts(
    userStats.almLpAmount - lpAmount, // User's LP after withdrawal
    ALMLPWrapperEntity.lpAmount - lpAmount, // Total LP after withdrawal
    updatedAmount0, // Wrapper amount0 AFTER withdrawal
    updatedAmount1, // Wrapper amount1 AFTER withdrawal
  );

  const userStatsDiff = {
    almAmount0: derivedUserAmounts.amount0,
    almAmount1: derivedUserAmounts.amount1,
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
    // Update user-level UserStatsPerPool entity for the recipient
    // The recipient withdraws and receives tokens, so their position decreases
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
ALMLPWrapperV1.Transfer.handler(async ({ event, context }) => {
  const { from, to, value } = event.params;

  // Excluding burns/mints since that would double count ALM position
  // Deposit/Withdraw events already handle burns/mints correctly.
  if (
    from === "0x0000000000000000000000000000000000000000" ||
    to === "0x0000000000000000000000000000000000000000"
  ) {
    return;
  }

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

  // Derive user amounts from LP share after transfer
  // Sender's LP decreases, recipient's LP increases
  const senderLpAfter = userStatsFrom.almLpAmount - value;
  const recipientLpAfter = userStatsTo.almLpAmount + value;

  const senderAmounts = deriveUserAmounts(
    senderLpAfter,
    ALMLPWrapperEntity.lpAmount, // Total LP unchanged in transfers
    ALMLPWrapperEntity.amount0,
    ALMLPWrapperEntity.amount1,
  );

  const recipientAmounts = deriveUserAmounts(
    recipientLpAfter,
    ALMLPWrapperEntity.lpAmount, // Total LP unchanged in transfers
    ALMLPWrapperEntity.amount0,
    ALMLPWrapperEntity.amount1,
  );

  const UserStatsFromDiff = {
    almAmount0: senderAmounts.amount0,
    almAmount1: senderAmounts.amount1,
    almLpAmount: -value,
  };

  const UserStatsToDiff = {
    almAmount0: recipientAmounts.amount0,
    almAmount1: recipientAmounts.amount1,
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
