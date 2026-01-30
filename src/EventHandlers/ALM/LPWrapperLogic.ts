import { TickMath, maxLiquidityForAmounts } from "@uniswap/v3-sdk";
import type {
  ALMLPWrapperTransferInTx,
  ALM_LP_Wrapper,
  handlerContext,
} from "generated";
import JSBI from "jsbi";
import { updateALMLPWrapper } from "../../Aggregators/ALMLPWrapper";
import {
  loadOrCreateUserData,
  loadUserStatsPerPool,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import { PoolId, ZERO_ADDRESS } from "../../Constants";

interface MatchingBurnTransfer {
  id: string;
  value: bigint;
  logIndex: number;
}

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

  try {
    // Load pool entity to get sqrtPriceX96
    const poolId = PoolId(chainId, poolAddress);
    const liquidityPoolAggregator =
      await context.LiquidityPoolAggregator.get(poolId);

    if (!liquidityPoolAggregator) {
      context.log.error(
        `[ALMLPWrapper.${eventType}] LiquidityPoolAggregator ${poolId} not found on chain ${chainId}. Skipping liquidity update.`,
      );
      return updatedLiquidity;
    }

    const sqrtPriceX96 = liquidityPoolAggregator.sqrtPriceX96;

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
        `[ALMLPWrapper.${eventType}] sqrtPriceX96 is undefined or 0 for pool ${poolId} at block ${blockNumber} on chain ${chainId}. Skipping liquidity update.`,
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

/**
 * Calculates user's token amounts from their LP share using integer division.
 *
 * This function computes the proportional share of tokens a user owns based on their
 * LP token balance relative to the total LP supply. The calculation uses integer
 * division which may result in minor precision loss (at most 1 wei per token).
 *
 * Precision considerations:
 * - LP tokens typically have 18 decimals, providing high precision
 * - Precision loss is negligible for large amounts
 * - This matches how smart contracts handle proportional calculations
 * - The maximum precision loss is at most 1 wei per token due to integer division
 *   truncation, which is acceptable for typical LP amounts in the millions or billions
 *
 * @param userLp - User's LP token balance
 * @param totalLp - Total LP token supply in the wrapper
 * @param wrapperAmount0 - Total amount of token0 in the wrapper
 * @param wrapperAmount1 - Total amount of token1 in the wrapper
 * @returns User's proportional amounts of token0 and token1
 */
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
 * Finds the matching burn Transfer event for a Withdraw event
 * The burn Transfer event always comes before the Withdraw event in the transaction
 * @param txHash - The transaction hash
 * @param sender - The sender address
 * @param chainId - The chain ID
 * @param wrapperAddress - The wrapper contract address
 * @param withdrawLogIndex - The log index of the Withdraw event
 * @param context - The handler context
 * @returns The matching burn Transfer event, or undefined if not found
 */
export async function getMatchingBurnTransferInTx(
  txHash: string,
  sender: string,
  chainId: number,
  wrapperAddress: string,
  withdrawLogIndex: number,
  context: handlerContext,
): Promise<MatchingBurnTransfer | undefined> {
  const transfersInTxHash =
    await context.ALMLPWrapperTransferInTx.getWhere.txHash.eq(txHash);

  const matchingBurns = transfersInTxHash.filter(
    (t: ALMLPWrapperTransferInTx) =>
      t.chainId === chainId &&
      t.wrapperAddress === wrapperAddress &&
      t.from === sender &&
      t.isBurn === true &&
      t.logIndex < withdrawLogIndex &&
      (t.consumedByLogIndex === null || t.consumedByLogIndex === undefined),
  );

  if (matchingBurns.length === 0) {
    return undefined;
  }

  // Select the closest preceding burn (highest logIndex) for deterministic matching
  const closestBurn = matchingBurns.reduce(
    (prev: ALMLPWrapperTransferInTx, curr: ALMLPWrapperTransferInTx) =>
      curr.logIndex > prev.logIndex ? curr : prev,
  );

  return {
    id: closestBurn.id,
    value: closestBurn.value,
    logIndex: closestBurn.logIndex,
  };
}

/**
 * Gets the actual LP amount withdrawn for V1 wrappers by matching with burn Transfer event
 * V1 Withdraw events emit the input parameter, not the actual burned amount
 * @param lpAmount - The lpAmount from the Withdraw event (may be input parameter for V1)
 * @param txHash - The transaction hash
 * @param chainId - The chain ID
 * @param sender - The sender address whose tokens are being burned
 * @param srcAddress - The wrapper contract address
 * @param logIndex - The log index of the Withdraw event
 * @param context - The handler context
 * @returns The actual LP amount withdrawn (from Transfer event if found, otherwise 0n)
 */
async function getActualLpAmountForV1(
  lpAmount: bigint,
  txHash: string,
  chainId: number,
  sender: string,
  srcAddress: string,
  logIndex: number,
  context: handlerContext,
): Promise<bigint> {
  const matchingBurn = await getMatchingBurnTransferInTx(
    txHash,
    sender,
    chainId,
    srcAddress,
    logIndex,
    context,
  );

  if (matchingBurn) {
    // Use the actual burned amount from Transfer event
    const actualLpAmount = matchingBurn.value;

    // Mark the transfer as consumed
    const transferEntity = await (
      context as handlerContext
    ).ALMLPWrapperTransferInTx.get(matchingBurn.id);
    if (transferEntity) {
      (context as handlerContext).ALMLPWrapperTransferInTx.set({
        ...transferEntity,
        consumedByLogIndex: logIndex,
      });
    }

    return actualLpAmount;
  }
  // No matching Transfer found - log warning
  context.log.warn(
    `[ALMLPWrapper.Withdraw] V1 wrapper ${srcAddress} on chain ${chainId}, but no matching burn Transfer event found. Using event parameter ${lpAmount} as fallback.`,
  );
  return 0n;
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
    incrementalLpAmount: lpAmount,
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
    incrementalAlmLpAmount: lpAmount,
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
 * @param sender - The sender address whose tokens are being burned
 * @param pool - The pool address
 * @param amount0 - Amount of token0 withdrawn
 * @param amount1 - Amount of token1 withdrawn
 * @param lpAmount - Amount of LP tokens burned (from event parameter - may be input parameter for V1)
 * @param srcAddress - The wrapper contract address
 * @param chainId - The chain ID
 * @param blockNumber - The block number
 * @param timestamp - The event timestamp
 * @param context - The handler context
 * @param txHash - The transaction hash (for matching with Transfer events)
 * @param logIndex - The log index of the Withdraw event (for matching with Transfer events)
 * @param isV1 - Whether this is a V1 wrapper (V1 emits input parameter, V2 emits actualLpAmount)
 */
export async function processWithdrawEvent(
  sender: string,
  pool: string,
  amount0: bigint,
  amount1: bigint,
  lpAmount: bigint,
  srcAddress: string,
  chainId: number,
  blockNumber: number,
  timestamp: Date,
  context: handlerContext,
  txHash: string,
  logIndex: number,
  isV1: boolean,
): Promise<void> {
  // Load wrapper and user stats in parallel since pool address is available from event params
  const [ALMLPWrapperEntity, userStats] = await Promise.all([
    loadALMLPWrapper(srcAddress, chainId, context),
    loadOrCreateUserData(sender, pool, chainId, context, timestamp),
  ]);

  if (!ALMLPWrapperEntity) {
    return;
  }

  // For LPWrapper V1, try to match with burn Transfer event to get actual burned amount
  // This is needed because V1 Withdraw event emits the input parameter which is not
  // the actual amount burned (see contract code)
  // V2 corrects this by emitting actualLpAmount in the Withdraw event
  const actualLpAmountWithdrawn = isV1
    ? await getActualLpAmountForV1(
        lpAmount,
        txHash,
        chainId,
        sender,
        srcAddress,
        logIndex,
        context,
      )
    : lpAmount;

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
    incrementalLpAmount: -actualLpAmountWithdrawn,
    liquidity: updatedLiquidity,
    ammStateIsDerived: true, // Derived from amount0 and amount1 at a specific price; not derived from on-chain AMM position (i.e. Rebalance event)
  };

  // Derive user's current balance from their LP share after withdrawal
  // Use updatedAmount0/amount1 (wrapper amounts AFTER withdrawal) to calculate user's remaining position
  const derivedUserAmounts = deriveUserAmounts(
    userStats.almLpAmount - actualLpAmountWithdrawn, // User's LP after withdrawal
    ALMLPWrapperEntity.lpAmount - actualLpAmountWithdrawn, // Total LP after withdrawal
    updatedAmount0, // Wrapper amount0 AFTER withdrawal
    updatedAmount1, // Wrapper amount1 AFTER withdrawal
  );

  const userStatsDiff = {
    almAmount0: derivedUserAmounts.amount0,
    almAmount1: derivedUserAmounts.amount1,
    incrementalAlmLpAmount: -actualLpAmountWithdrawn,
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
 * Stores a burn Transfer event in the temporary entity for matching with Withdraw events
 * @param chainId - The chain ID
 * @param txHash - The transaction hash
 * @param wrapperAddress - The wrapper contract address
 * @param logIndex - The log index of the Transfer event
 * @param blockNumber - The block number
 * @param from - The sender address
 * @param to - The recipient address (should be 0x0 for burns)
 * @param value - The transfer amount
 * @param timestamp - The event timestamp
 * @param context - The handler context
 */
function storeBurnTransferForMatching(
  chainId: number,
  txHash: string,
  wrapperAddress: string,
  logIndex: number,
  blockNumber: number,
  from: string,
  to: string,
  value: bigint,
  timestamp: Date,
  context: handlerContext,
): void {
  const transferId = `${chainId}-${txHash}-${wrapperAddress}-${logIndex}`;
  (context as handlerContext).ALMLPWrapperTransferInTx.set({
    id: transferId,
    chainId: chainId,
    txHash: txHash,
    wrapperAddress: wrapperAddress,
    logIndex: logIndex,
    blockNumber: BigInt(blockNumber),
    from: from,
    to: to,
    value: value,
    isBurn: true, // Only storing burns
    consumedByLogIndex: undefined, // Initially unused
    timestamp: timestamp,
  });
}

/**
 * Processes a Transfer event for ALM LP Wrapper
 * Excludes burns/mints (zero address transfers) since Deposit/Withdraw events handle those.
 * @param from - The sender address
 * @param to - The recipient address
 * @param value - The transfer amount
 * @param srcAddress - The wrapper contract address
 * @param chainId - The chain ID
 * @param txHash - The transaction hash
 * @param logIndex - The log index of the Transfer event
 * @param blockNumber - The block number
 * @param timestamp - The event timestamp
 * @param context - The handler context
 * @param isV1 - Whether this is a V1 wrapper (only V1 needs burn Transfer events stored for matching)
 */
export async function processTransferEvent(
  from: string,
  to: string,
  value: bigint,
  srcAddress: string,
  chainId: number,
  txHash: string,
  logIndex: number,
  blockNumber: number,
  timestamp: Date,
  context: handlerContext,
  isV1: boolean,
): Promise<void> {
  // Store burn events (to == 0x0) for matching with Withdraw events (V1 only needs this)
  // The burn Transfer event always comes before the Withdraw event in the transaction
  // V2 doesn't need this because it emits actualLpAmount in the Withdraw event
  if (isV1 && to === ZERO_ADDRESS) {
    storeBurnTransferForMatching(
      chainId,
      txHash,
      srcAddress,
      logIndex,
      blockNumber,
      from,
      to,
      value,
      timestamp,
      context,
    );
  }

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
    incrementalAlmLpAmount: -value,
    lastActivityTimestamp: timestamp,
    lastAlmActivityTimestamp: timestamp,
  };

  const UserStatsToDiff = {
    almAddress: srcAddress,
    almAmount0: recipientAmounts.amount0,
    almAmount1: recipientAmounts.amount1,
    incrementalAlmLpAmount: value,
    lastActivityTimestamp: timestamp,
    lastAlmActivityTimestamp: timestamp,
  };

  await Promise.all([
    updateUserStatsPerPool(UserStatsFromDiff, userStatsFrom, context),
    updateUserStatsPerPool(UserStatsToDiff, userStatsTo, context),
  ]);
}
