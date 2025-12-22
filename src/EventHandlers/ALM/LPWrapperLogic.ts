import { TickMath, maxLiquidityForAmounts } from "@uniswap/v3-sdk";
import type { ALM_LP_Wrapper, handlerContext } from "generated";
import JSBI from "jsbi";
import { updateALMLPWrapper } from "../../Aggregators/ALMLPWrapper";
import {
  loadOrCreateUserData,
  loadUserStatsPerPool,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import { ZERO_ADDRESS, toChecksumAddress } from "../../Constants";
import { getSqrtPriceX96, roundBlockToInterval } from "../../Effects/Token";

/**
 * Calculates liquidity from updated amounts (amount0 and amount1) using current price
 * This is used in Deposit/Withdraw events to update the liquidity field when amounts change.
 *
 * @param wrapper - The current ALM_LP_Wrapper entity
 * @param updatedAmount0 - The updated amount0 after deposit/withdraw
 * @param updatedAmount1 - The updated amount1 after deposit/withdraw
 * @param poolAddress - The pool address to fetch price from
 * @param chainId - The chain ID
 * @param blockNumber - The block number to fetch price at
 * @param context - The handler context for effects and logging
 * @param eventType - The event type for logging purposes (e.g., "Deposit", "Withdraw")
 * @returns The calculated liquidity, or the current liquidity if calculation fails
 */
export async function calculateLiquidityFromAmounts(
  wrapper: ALM_LP_Wrapper,
  updatedAmount0: bigint,
  updatedAmount1: bigint,
  poolAddress: string,
  chainId: number,
  blockNumber: number,
  context: handlerContext,
  eventType: string,
): Promise<bigint> {
  // Default to current liquidity if calculation fails
  let updatedLiquidity = wrapper.liquidity;

  // Try with rounded block first, then retry with actual block if it fails
  let sqrtPriceX96: bigint | undefined;
  let usedBlockNumber: number | undefined;

  try {
    const roundedBlockNumber = roundBlockToInterval(blockNumber, chainId);

    try {
      sqrtPriceX96 = await context.effect(getSqrtPriceX96, {
        poolAddress: poolAddress,
        chainId: chainId,
        blockNumber: roundedBlockNumber,
      });
      usedBlockNumber = roundedBlockNumber;
    } catch (error) {
      // If rounded block fails, retry with actual block number
      context.log.warn(
        `[ALMLPWrapper.${eventType}] Failed to get sqrtPriceX96 at rounded block ${roundedBlockNumber}, retrying with actual block ${blockNumber}`,
      );
      sqrtPriceX96 = await context.effect(getSqrtPriceX96, {
        poolAddress: poolAddress,
        chainId: chainId,
        blockNumber: blockNumber,
      });
      usedBlockNumber = blockNumber;
    }

    if (sqrtPriceX96 !== undefined && sqrtPriceX96 !== 0n) {
      // Convert ticks → sqrt ratios
      const sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(
        Number(wrapper.tickLower),
      );
      const sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(
        Number(wrapper.tickUpper),
      );

      // Compute liquidity from amounts
      updatedLiquidity = BigInt(
        maxLiquidityForAmounts(
          JSBI.BigInt(sqrtPriceX96.toString()),
          sqrtRatioAX96,
          sqrtRatioBX96,
          updatedAmount0.toString(),
          updatedAmount1.toString(),
          true,
        ).toString(),
      );
    } else {
      // Do not update liquidity if sqrtPriceX96 is undefined or 0
      context.log.warn(
        `[ALMLPWrapper.${eventType}] sqrtPriceX96 is undefined or 0 for pool ${poolAddress} at block ${usedBlockNumber ?? blockNumber} on chain ${chainId}. Skipping liquidity update.`,
      );
    }
  } catch (error) {
    context.log.error(
      `[ALMLPWrapper.${eventType}] Error calculating liquidity from amounts for wrapper ${wrapper.id}`,
      error instanceof Error ? error : new Error(String(error)),
    );
    // Continue with existing liquidity if calculation fails
  }

  return updatedLiquidity;
}

export function deriveUserAmounts(
  userLp: bigint,
  totalLp: bigint,
  wrapperAmount0: bigint,
  wrapperAmount1: bigint,
): { amount0: bigint; amount1: bigint } {
  if (userLp === 0n || totalLp === 0n) {
    return { amount0: 0n, amount1: 0n };
  }

  return {
    amount0: (wrapperAmount0 * userLp) / totalLp,
    amount1: (wrapperAmount1 * userLp) / totalLp,
  };
}

/**
 * Loads an ALM_LP_Wrapper entity by its ID
 * @param srcAddress - The wrapper contract address
 * @param chainId - The chain ID
 * @param context - The handler context
 * @returns The ALM_LP_Wrapper entity or null if not found
 */
export async function loadALMLPWrapper(
  srcAddress: string,
  chainId: number,
  context: handlerContext,
): Promise<ALM_LP_Wrapper | null> {
  const lpWrapperId = `${srcAddress}_${chainId}`;
  const ALMLPWrapperEntity = await context.ALM_LP_Wrapper.get(lpWrapperId);

  if (!ALMLPWrapperEntity) {
    context.log.error(
      `ALM_LP_Wrapper entity not found for ${lpWrapperId}. It should have been created by StrategyCreated event.`,
    );
    return null;
  }

  return ALMLPWrapperEntity;
}

/**
 * Processes a Deposit event for ALM LP Wrapper
 * @param recipient - The recipient address who receives LP tokens
 * @param pool - The pool address
 * @param amount0 - Amount of token0 deposited
 * @param amount1 - Amount of token1 deposited
 * @param lpAmount - Amount of LP tokens minted
 * @param srcAddress - The wrapper contract address
 * @param chainId - The chain ID
 * @param blockNumber - The block number
 * @param timestamp - The event timestamp
 * @param context - The handler context
 */
export async function processDepositEvent(
  recipient: string,
  pool: string,
  amount0: bigint,
  amount1: bigint,
  lpAmount: bigint,
  srcAddress: string,
  chainId: number,
  blockNumber: number,
  timestamp: Date,
  context: handlerContext,
): Promise<void> {
  // Load wrapper and user stats in parallel since pool address is available from event params
  const [ALMLPWrapperEntity, userStats] = await Promise.all([
    loadALMLPWrapper(srcAddress, chainId, context),
    loadOrCreateUserData(recipient, pool, chainId, context, timestamp),
  ]);

  if (!ALMLPWrapperEntity) {
    return;
  }

  const updatedAmount0 = ALMLPWrapperEntity.amount0 + amount0;
  const updatedAmount1 = ALMLPWrapperEntity.amount1 + amount1;

  const updatedLiquidity = await calculateLiquidityFromAmounts(
    ALMLPWrapperEntity,
    updatedAmount0,
    updatedAmount1,
    pool,
    chainId,
    blockNumber,
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
    almAddress: srcAddress,
    almAmount0: derivedUserAmounts.amount0,
    almAmount1: derivedUserAmounts.amount1,
    almLpAmount: lpAmount,
    lastActivityTimestamp: timestamp,
    lastAlmActivityTimestamp: timestamp,
  };

  // Update pool-level ALM_LP_Wrapper entity and user-level UserStatsPerPool entity in parallel
  await Promise.all([
    updateALMLPWrapper(
      ALMLPWrapperDiff,
      ALMLPWrapperEntity,
      timestamp,
      context,
    ),
    updateUserStatsPerPool(userStatsDiff, userStats, context),
  ]);
}

/**
 * Processes a Withdraw event for ALM LP Wrapper
 * @param recipient - The recipient address who receives tokens
 * @param pool - The pool address
 * @param amount0 - Amount of token0 withdrawn
 * @param amount1 - Amount of token1 withdrawn
 * @param lpAmount - Amount of LP tokens burned
 * @param srcAddress - The wrapper contract address
 * @param chainId - The chain ID
 * @param blockNumber - The block number
 * @param timestamp - The event timestamp
 * @param context - The handler context
 */
export async function processWithdrawEvent(
  recipient: string,
  pool: string,
  amount0: bigint,
  amount1: bigint,
  lpAmount: bigint,
  srcAddress: string,
  chainId: number,
  blockNumber: number,
  timestamp: Date,
  context: handlerContext,
): Promise<void> {
  // Load wrapper and user stats in parallel since pool address is available from event params
  const [ALMLPWrapperEntity, userStats] = await Promise.all([
    loadALMLPWrapper(srcAddress, chainId, context),
    loadOrCreateUserData(recipient, pool, chainId, context, timestamp),
  ]);

  if (!ALMLPWrapperEntity) {
    return;
  }

  const updatedAmount0 = ALMLPWrapperEntity.amount0 - amount0;
  const updatedAmount1 = ALMLPWrapperEntity.amount1 - amount1;

  const updatedLiquidity = await calculateLiquidityFromAmounts(
    ALMLPWrapperEntity,
    updatedAmount0,
    updatedAmount1,
    pool,
    chainId,
    blockNumber,
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
    lastActivityTimestamp: timestamp,
    lastAlmActivityTimestamp: timestamp,
  };

  // Update pool-level ALM_LP_Wrapper entity and user-level UserStatsPerPool entity in parallel
  await Promise.all([
    updateALMLPWrapper(
      ALMLPWrapperDiff,
      ALMLPWrapperEntity,
      timestamp,
      context,
    ),
    updateUserStatsPerPool(userStatsDiff, userStats, context),
  ]);
}

/**
 * Processes a Transfer event for ALM LP Wrapper
 * Excludes burns/mints (zero address transfers) since Deposit/Withdraw events handle those.
 * @param from - The sender address
 * @param to - The recipient address
 * @param value - The transfer amount
 * @param srcAddress - The wrapper contract address
 * @param chainId - The chain ID
 * @param timestamp - The event timestamp
 * @param context - The handler context
 */
export async function processTransferEvent(
  from: string,
  to: string,
  value: bigint,
  srcAddress: string,
  chainId: number,
  timestamp: Date,
  context: handlerContext,
): Promise<void> {
  // Excluding burns/mints since Deposit/Withdraw events already handle those, and we don't want double counting.
  // Excluding transfers from/to wrapper contract itself
  const excludedAddresses = [ZERO_ADDRESS, srcAddress];

  if (excludedAddresses.includes(from) || excludedAddresses.includes(to)) {
    return;
  }

  const ALMLPWrapperEntity = await loadALMLPWrapper(
    srcAddress,
    chainId,
    context,
  );
  if (!ALMLPWrapperEntity) {
    return;
  }

  // Sender must exist and be a valid user entity (i.e. not 0 address or StakingReward contract address or the wrapper contract itself)
  // Recipient can be created if they don't exist (receiving LP tokens automatically makes the address an user entity)
  const [userStatsFrom, userStatsTo] = await Promise.all([
    loadUserStatsPerPool(from, ALMLPWrapperEntity.pool, chainId, context),
    loadOrCreateUserData(
      to,
      ALMLPWrapperEntity.pool,
      chainId,
      context,
      timestamp,
    ),
  ]);

  if (!userStatsFrom) {
    return;
  }

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
    lastActivityTimestamp: timestamp,
    lastAlmActivityTimestamp: timestamp,
  };

  const UserStatsToDiff = {
    almAddress: srcAddress,
    almAmount0: recipientAmounts.amount0,
    almAmount1: recipientAmounts.amount1,
    almLpAmount: value,
    lastActivityTimestamp: timestamp,
    lastAlmActivityTimestamp: timestamp,
  };

  await Promise.all([
    updateUserStatsPerPool(UserStatsFromDiff, userStatsFrom, context),
    updateUserStatsPerPool(UserStatsToDiff, userStatsTo, context),
  ]);
}
