import { ALMLPWrapperV1 } from "generated";
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
 *
 * Note: In V1, Deposit event has both `sender` and `recipient` fields.
 * The `recipient` is the one who receives the LP tokens and should have their stats updated.
 */
ALMLPWrapperV1.Deposit.handler(async ({ event, context }) => {
  const { recipient, pool, lpAmount, amount0, amount1 } = event.params;
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
 * 2. Updates the user-level UserStatsPerPool entity for the recipient
 *    (who withdraws and receives tokens) with their reduced ALM position
 *
 * Note: In V1, Withdraw event has both `sender` and `recipient` fields.
 * The `sender` is the one who receives the tokens and should have their stats updated.
 * The above can be observed by the _burn function execution within _withdraw:
 * - msg.sender is the one whose tokens are being burned/withdrawn
 */
ALMLPWrapperV1.Withdraw.handler(async ({ event, context }) => {
  const { sender, pool, lpAmount, amount0, amount1 } = event.params;
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
    true, // isV1 = true for V1 wrapper
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
ALMLPWrapperV1.Transfer.handler(async ({ event, context }) => {
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
    true, // isV1 = true for V1 wrapper
  );
});
