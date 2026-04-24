import type { LiquidityPoolAggregator, handlerContext } from "generated";
import {
  isPositionInRange,
  updateTicksForStakedPosition,
} from "../../Aggregators/CLStakedLiquidity";
import type { PoolData } from "../../Aggregators/LiquidityPoolAggregator";
import {
  findPoolByGaugeAddress,
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import {
  CHAIN_CONSTANTS,
  NonFungiblePositionId,
  TokenId,
} from "../../Constants";
import {
  calculatePositionAmountsFromLiquidity,
  calculateTotalUSD,
  computeNonCLStakedUSD,
} from "../../Helpers";

export interface GaugeEventData {
  gaugeAddress: string;
  userAddress: string;
  chainId: number;
  blockNumber: number;
  timestamp: number;
  amount: bigint;
  tokenId?: bigint; // Optional - for CL pools to look up position tick ranges
}

/**
 * Computes the CL staked reserve deltas and updated pool staked USD when a position
 * is deposited to or withdrawn from a gauge. Handles tick entity updates and determines
 * whether the position is in range.
 *
 * @param data - Gauge event data (must have tokenId for CL)
 * @param liquidityPoolAggregator - Current pool entity
 * @param poolData - Token instances for USD conversion
 * @param context - Handler context for entity access
 * @param direction - 1n for deposit (add to staked), -1n for withdraw (remove from staked)
 * @returns Staked liquidity diff fields, or empty object if position not found
 */
async function computeCLStakedReservesOnGaugeEvent(
  data: GaugeEventData,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  poolData: PoolData,
  context: handlerContext,
  direction: 1n | -1n,
): Promise<{
  poolStakedUSD?: bigint;
  stakedLiquidityInRange?: bigint;
  incrementalStakedReserve0?: bigint;
  incrementalStakedReserve1?: bigint;
}> {
  if (data.tokenId === undefined) return {};

  // Pool → NFPM is threaded onto the aggregator at PoolCreated time (see #619).
  // For V2 pools or pools without an NFPM mapping, no position can exist — bail early.
  const nfpmAddress = liquidityPoolAggregator.nfpmAddress;
  if (!nfpmAddress) return {};

  const position = await context.NonFungiblePosition.get(
    NonFungiblePositionId(data.chainId, nfpmAddress, data.tokenId),
  );
  if (!position) return {};

  const currentTick = liquidityPoolAggregator.tick ?? 0n;
  const sqrtPriceX96 = liquidityPoolAggregator.sqrtPriceX96 ?? 0n;

  // Update tick entities: +liquidity on deposit, -liquidity on withdraw
  await updateTicksForStakedPosition(
    data.chainId,
    liquidityPoolAggregator.poolAddress,
    position.tickLower,
    position.tickUpper,
    direction * position.liquidity,
    context,
  );

  // stakedLiquidityInRange only changes when the position is in range (drives swap proportional attribution)
  const stakedLiquidityInRange = isPositionInRange(
    position.tickLower,
    position.tickUpper,
    currentTick,
  )
    ? (liquidityPoolAggregator.stakedLiquidityInRange ?? 0n) +
      direction * position.liquidity
    : undefined;

  // stakedReserve0/1 track ALL staked token holdings (in-range + out-of-range) for USD valuation.
  // Out-of-range positions still hold tokens (100% token0 if below, 100% token1 if above),
  // and calculatePositionAmountsFromLiquidity handles all three cases.
  let incrementalStakedReserve0: bigint | undefined;
  let incrementalStakedReserve1: bigint | undefined;
  if (sqrtPriceX96 !== 0n) {
    const { amount0, amount1 } = calculatePositionAmountsFromLiquidity(
      position.liquidity,
      sqrtPriceX96,
      position.tickLower,
      position.tickUpper,
    );
    incrementalStakedReserve0 = direction * amount0;
    incrementalStakedReserve1 = direction * amount1;
  }

  // Compute pool staked USD from updated staked reserves
  const newStakedReserve0 =
    (liquidityPoolAggregator.stakedReserve0 ?? 0n) +
    (incrementalStakedReserve0 ?? 0n);
  const newStakedReserve1 =
    (liquidityPoolAggregator.stakedReserve1 ?? 0n) +
    (incrementalStakedReserve1 ?? 0n);
  const poolStakedUSD = calculateTotalUSD(
    newStakedReserve0 > 0n ? newStakedReserve0 : 0n,
    newStakedReserve1 > 0n ? newStakedReserve1 : 0n,
    poolData.token0Instance,
    poolData.token1Instance,
  );

  return {
    poolStakedUSD,
    stakedLiquidityInRange,
    incrementalStakedReserve0,
    incrementalStakedReserve1,
  };
}

/**
 * Computes staked USD for a non-CL pool when the inputs are sufficient to do so.
 * Returns `undefined` only for "valuation unavailable" cases, not for valid zero stake.
 * @param stakeAmount - The amount of stake in the pool
 * @param liquidityPoolAggregator - The liquidity pool aggregator
 * @param poolData - The pool data
 * @param context - The handler context
 * @returns The staked USD, or undefined if valuation is unavailable
 */
function computeNonCLStakedUSDIfAvailable(
  stakeAmount: bigint,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  poolData: PoolData,
  context: handlerContext,
): bigint | undefined {
  if (stakeAmount <= 0n) {
    return 0n;
  }

  if (
    liquidityPoolAggregator.totalLPTokenSupply === undefined ||
    liquidityPoolAggregator.totalLPTokenSupply === 0n
  ) {
    return undefined;
  }

  return computeNonCLStakedUSD(
    stakeAmount,
    liquidityPoolAggregator,
    poolData,
    context,
  );
}

/**
 * Returns true if the gauge address is registered as a root gauge (RootGauge/RootCLGauge on the root chain).
 * Used to skip Deposit/Withdraw/ClaimRewards for root gauges, which have no associated pool entity.
 * @param gaugeAddress - The address of the gauge
 * @param context - The handler context
 * @returns True if the gauge address is registered as a root gauge, false otherwise
 */
export async function isRootGauge(
  gaugeAddress: string,
  context: handlerContext,
): Promise<boolean> {
  const mappings = await context.RootGauge_RootPool.getWhere({
    rootGaugeAddress: { _eq: gaugeAddress },
  });
  return mappings.length > 0;
}

/**
 * Looks up pool by gauge address; returns null silently for root gauges, logs and returns null otherwise when not found.
 * @param gaugeAddress - The gauge address
 * @param chainId - The chain ID
 * @param context - The handler context
 * @param handlerName - Handler name for error logging
 * @returns { pool } if pool found, null if not found (root gauge = silent, else log error)
 */
export async function findPoolOrSkipRootGauge(
  gaugeAddress: string,
  chainId: number,
  context: handlerContext,
  handlerName: string,
): Promise<{ pool: LiquidityPoolAggregator } | null> {
  const pool = await findPoolByGaugeAddress(gaugeAddress, chainId, context);
  if (pool) {
    return { pool };
  }
  if (await isRootGauge(gaugeAddress, context)) {
    return null;
  }
  context.log.error(
    `${handlerName}: Pool not found for gauge address ${gaugeAddress} on chain ${chainId}`,
  );
  return null;
}

/**
 * Computes currentLiquidityStakedUSD for the pool (not user) for non-CL pools.
 * User staked USD is deferred to hourly snapshots (see UserStatsPerPool.ts).
 */
function computeNonCLPoolStakedUSD(
  newPoolStake: bigint,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  poolData: PoolData,
  context: handlerContext,
): bigint | undefined {
  return computeNonCLStakedUSDIfAvailable(
    newPoolStake,
    liquidityPoolAggregator,
    poolData,
    context,
  );
}

/**
 * Common logic for processing gauge deposit events
 */
export async function processGaugeDeposit(
  data: GaugeEventData,
  context: handlerContext,
  handlerName: string,
): Promise<void> {
  const result = await findPoolOrSkipRootGauge(
    data.gaugeAddress,
    data.chainId,
    context,
    handlerName,
  );
  if (!result) return;
  const { pool } = result;

  const timestamp = new Date(data.timestamp * 1000);

  // Load pool data and user data concurrently
  const [poolData, userData] = await Promise.all([
    loadPoolData(pool.poolAddress, data.chainId, context),
    loadOrCreateUserData(
      data.userAddress,
      pool.poolAddress,
      data.chainId,
      context,
      timestamp,
    ),
  ]);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.poolAddress} on chain ${data.chainId}`,
    );
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  const newPoolStake =
    liquidityPoolAggregator.currentLiquidityStaked + data.amount;

  let poolStakedUSD: bigint | undefined;
  let stakedLiquidityInRange: bigint | undefined;
  let incrementalStakedReserve0: bigint | undefined;
  let incrementalStakedReserve1: bigint | undefined;

  if (liquidityPoolAggregator.isCL) {
    const clResult = await computeCLStakedReservesOnGaugeEvent(
      data,
      liquidityPoolAggregator,
      poolData,
      context,
      1n,
    );
    poolStakedUSD = clResult.poolStakedUSD;
    stakedLiquidityInRange = clResult.stakedLiquidityInRange;
    incrementalStakedReserve0 = clResult.incrementalStakedReserve0;
    incrementalStakedReserve1 = clResult.incrementalStakedReserve1;
  } else {
    poolStakedUSD = computeNonCLPoolStakedUSD(
      newPoolStake,
      liquidityPoolAggregator,
      poolData,
      context,
    );
  }

  const poolDiff = {
    incrementalNumberOfGaugeDeposits: 1n,
    incrementalCurrentLiquidityStaked: data.amount,
    currentLiquidityStakedUSD: poolStakedUSD,
    stakedLiquidityInRange,
    incrementalStakedReserve0,
    incrementalStakedReserve1,
    // Flip the CL pool's hasStakes latch on the first deposit. The latch gates the
    // per-swap CLTickStaked sweep in processTickCrossingsForStaked. Non-CL pools
    // and already-latched CL pools leave this field alone.
    hasStakes:
      liquidityPoolAggregator.isCL && !liquidityPoolAggregator.hasStakes
        ? true
        : undefined,
    lastUpdatedTimestamp: timestamp,
  };

  // For CL pools with a tokenId, append to the user's staked position list
  const existingStakedTokenIds = userData.stakedCLPositionTokenIds ?? [];
  const stakedCLPositionTokenIds =
    liquidityPoolAggregator.isCL && data.tokenId !== undefined
      ? [...existingStakedTokenIds, data.tokenId]
      : undefined;

  const userDiff = {
    incrementalNumberOfGaugeDeposits: 1n,
    incrementalCurrentLiquidityStaked: data.amount,
    stakedCLPositionTokenIds,
    lastActivityTimestamp: timestamp,
  };

  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      data.chainId,
      data.blockNumber,
    ),
    updateUserStatsPerPool(userDiff, userData, context, timestamp, poolData),
  ]);
}

/**
 * Common logic for processing gauge withdrawal events
 */
export async function processGaugeWithdraw(
  data: GaugeEventData,
  context: handlerContext,
  handlerName: string,
): Promise<void> {
  const result = await findPoolOrSkipRootGauge(
    data.gaugeAddress,
    data.chainId,
    context,
    handlerName,
  );
  if (!result) return;
  const { pool } = result;

  const timestamp = new Date(data.timestamp * 1000);

  // Load pool data and user data concurrently
  const [poolData, userData] = await Promise.all([
    loadPoolData(pool.poolAddress, data.chainId, context),
    loadOrCreateUserData(
      data.userAddress,
      pool.poolAddress,
      data.chainId,
      context,
      timestamp,
    ),
  ]);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.poolAddress} on chain ${data.chainId}`,
    );
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  const newPoolStake =
    liquidityPoolAggregator.currentLiquidityStaked - data.amount;
  const newUserStake = userData.currentLiquidityStaked - data.amount;

  if (newPoolStake < 0n || newUserStake < 0n) {
    context.log.error(
      `${handlerName}: withdraw exceeds current stake for pool ${pool.poolAddress} user ${data.userAddress}. Skipping update. This needs to be fixed.`,
    );
    return;
  }

  let poolStakedUSD: bigint | undefined;
  let stakedLiquidityInRange: bigint | undefined;
  let incrementalStakedReserve0: bigint | undefined;
  let incrementalStakedReserve1: bigint | undefined;

  if (liquidityPoolAggregator.isCL) {
    const clResult = await computeCLStakedReservesOnGaugeEvent(
      data,
      liquidityPoolAggregator,
      poolData,
      context,
      -1n,
    );
    poolStakedUSD = clResult.poolStakedUSD;
    stakedLiquidityInRange = clResult.stakedLiquidityInRange;
    incrementalStakedReserve0 = clResult.incrementalStakedReserve0;
    incrementalStakedReserve1 = clResult.incrementalStakedReserve1;
  } else {
    poolStakedUSD = computeNonCLPoolStakedUSD(
      newPoolStake,
      liquidityPoolAggregator,
      poolData,
      context,
    );
  }

  const poolDiff = {
    incrementalNumberOfGaugeWithdrawals: 1n,
    incrementalCurrentLiquidityStaked: -data.amount,
    currentLiquidityStakedUSD: poolStakedUSD,
    stakedLiquidityInRange,
    incrementalStakedReserve0,
    incrementalStakedReserve1,
    lastUpdatedTimestamp: timestamp,
  };

  // For CL pools with a tokenId, remove from the user's staked position list
  const existingStakedTokenIds = userData.stakedCLPositionTokenIds ?? [];
  const stakedCLPositionTokenIds =
    liquidityPoolAggregator.isCL && data.tokenId !== undefined
      ? existingStakedTokenIds.filter((id) => id !== data.tokenId)
      : undefined;

  const userDiff = {
    incrementalNumberOfGaugeWithdrawals: 1n,
    incrementalCurrentLiquidityStaked: -data.amount,
    stakedCLPositionTokenIds,
    lastActivityTimestamp: timestamp,
  };

  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      data.chainId,
      data.blockNumber,
    ),
    updateUserStatsPerPool(userDiff, userData, context, timestamp, poolData),
  ]);
}

/**
 * Common logic for processing gauge reward claim events
 */
export async function processGaugeClaimRewards(
  data: GaugeEventData,
  context: handlerContext,
  handlerName: string,
): Promise<void> {
  const result = await findPoolOrSkipRootGauge(
    data.gaugeAddress,
    data.chainId,
    context,
    handlerName,
  );
  if (!result) return;
  const { pool } = result;

  const timestamp = new Date(data.timestamp * 1000);

  // Get reward token address
  const rewardTokenAddress = CHAIN_CONSTANTS[data.chainId].rewardToken(
    data.blockNumber,
  );

  // Load pool data, user data, and reward token concurrently
  const [poolData, userData, rewardToken] = await Promise.all([
    loadPoolData(
      pool.poolAddress,
      data.chainId,
      context,
      data.blockNumber,
      data.timestamp,
    ),
    loadOrCreateUserData(
      data.userAddress,
      pool.poolAddress,
      data.chainId,
      context,
      timestamp,
    ),
    context.Token.get(TokenId(data.chainId, rewardTokenAddress)),
  ]);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.poolAddress} on chain ${data.chainId}`,
    );
    return;
  }

  if (!rewardToken) {
    context.log.error(
      `${handlerName}: Reward token not found for ${rewardTokenAddress} on chain ${data.chainId}`,
    );
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  const rewardAmountUSD = calculateTotalUSD(
    data.amount,
    0n,
    rewardToken,
    undefined,
  );

  // Update pool aggregator with gauge reward claim
  const poolDiff = {
    incrementalNumberOfGaugeRewardClaims: 1n,
    incrementalTotalGaugeRewardsClaimedUSD: rewardAmountUSD,
    incrementalTotalGaugeRewardsClaimed: data.amount, // in token units
    lastUpdatedTimestamp: timestamp,
  };

  // Update user stats with gauge reward claim
  const userDiff = {
    incrementalNumberOfGaugeRewardClaims: 1n,
    incrementalTotalGaugeRewardsClaimedUSD: rewardAmountUSD,
    incrementalTotalGaugeRewardsClaimed: data.amount, // in token units
    lastActivityTimestamp: timestamp,
  };

  // Update pool and user entities in parallel
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      data.chainId,
      data.blockNumber,
    ),
    updateUserStatsPerPool(userDiff, userData, context, timestamp, poolData),
  ]);
}
