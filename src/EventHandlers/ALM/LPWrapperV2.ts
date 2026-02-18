import { ALMLPWrapperV2 } from "generated";
import { ALMLPWrapperId } from "../../Constants";
import {
  processDepositEvent,
  processTransferEvent,
  processWithdrawEvent,
} from "./LPWrapperLogic";

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

  await processDepositEvent(
    recipient,
    pool,
    amount0,
    amount1,
    lpAmount,
    event.srcAddress,
    event.chainId,
    event.block.number,
    timestamp,
    context,
  );
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
  const { sender, pool, amount0, amount1, lpAmount } = event.params;
  const timestamp = new Date(event.block.timestamp * 1000);

  await processWithdrawEvent(
    sender,
    pool,
    amount0,
    amount1,
    lpAmount,
    event.srcAddress,
    event.chainId,
    event.block.number,
    timestamp,
    context,
    event.transaction.hash,
    event.logIndex,
    false, // isV1 = false for V2 wrapper
  );
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

  await processTransferEvent(
    from,
    to,
    value,
    event.srcAddress,
    event.chainId,
    event.transaction.hash,
    event.logIndex,
    event.block.number,
    timestamp,
    context,
    false, // isV1 = false for V2 wrapper
  );
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
    id: ALMLPWrapperId(event.chainId, event.srcAddress),
    lpWrapperAddress: event.srcAddress,
    currentTotalSupplyLPTokens: totalSupplyCurrent,
    transactionHash: event.transaction.hash,
  };

  context.ALM_TotalSupplyLimitUpdated_event.set(
    ALM_TotalSupplyLimitUpdated_event,
  );
});
