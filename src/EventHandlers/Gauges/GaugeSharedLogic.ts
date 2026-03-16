import type { LiquidityPoolAggregator, handlerContext } from "generated";
import type { PoolData } from "../../Aggregators/LiquidityPoolAggregator";
import {
  findPoolByGaugeAddress,
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import { CHAIN_CONSTANTS, TokenId } from "../../Constants";
import {
  calculateTotalUSD,
  computeCLStakedUSDFromPositions,
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
 * Computes staked USD for a CL pool when the pool has enough price state to value positions.
 * Returns `undefined` when valuation is unavailable so callers can preserve the prior USD value.
 * @param chainId - The chain ID
 * @param poolAddress - The pool address
 * @param liquidityPoolAggregator - The liquidity pool aggregator
 * @param poolData - The pool data
 * @param context - The handler context
 * @param options - The options
 * @returns The staked USD, or undefined if valuation is unavailable
 */
async function computeCLStakedUSDIfAvailable(
  chainId: number,
  poolAddress: string,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  poolData: PoolData,
  context: handlerContext,
  options: {
    userAddress?: string;
    logLabel: string;
  },
): Promise<bigint | undefined> {
  const sqrtPriceX96 = liquidityPoolAggregator.sqrtPriceX96;
  if (sqrtPriceX96 === undefined || sqrtPriceX96 === 0n) {
    return undefined;
  }

  return computeCLStakedUSDFromPositions(
    chainId,
    poolAddress,
    liquidityPoolAggregator,
    poolData,
    context,
    options,
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
 * Computes currentLiquidityStakedUSD for pool and user:
 * CL uses position-level recompute,
 * Non-CL uses aggregate stake with reserves/totalSupply.
 *
 * @param chainId - Chain ID
 * @param poolAddress - Pool address
 * @param userAddress - User address
 * @param newPoolStake - New pool stake amount
 * @param newUserStake - New user stake amount
 * @param liquidityPoolAggregator - Pool entity
 * @param poolData - Pool data
 * @param context - Handler context
 * @returns Recomputed pool/user staked USD, or undefined when valuation is unavailable
 */
export async function computeStakedUSDForPoolAndUser(
  chainId: number,
  poolAddress: string,
  userAddress: string,
  newPoolStake: bigint,
  newUserStake: bigint,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  poolData: PoolData,
  context: handlerContext,
): Promise<{
  poolStakedUSD: bigint | undefined;
  userStakedUSD: bigint | undefined;
}> {
  // CL pools path
  if (liquidityPoolAggregator.isCL) {
    const [poolStakedUSD, userStakedUSD] = await Promise.all([
      computeCLStakedUSDIfAvailable(
        chainId,
        poolAddress,
        liquidityPoolAggregator,
        poolData,
        context,
        { logLabel: "computeCLStakedUSDFromPositions(pool)" },
      ),
      computeCLStakedUSDIfAvailable(
        chainId,
        poolAddress,
        liquidityPoolAggregator,
        poolData,
        context,
        {
          userAddress,
          logLabel: "computeCLStakedUSDFromPositions(user)",
        },
      ),
    ]);
    return { poolStakedUSD, userStakedUSD };
  }
  // Non-CL pools path
  const poolStakedUSD = computeNonCLStakedUSDIfAvailable(
    newPoolStake,
    liquidityPoolAggregator,
    poolData,
    context,
  );
  const userStakedUSD = computeNonCLStakedUSDIfAvailable(
    newUserStake,
    liquidityPoolAggregator,
    poolData,
    context,
  );
  return { poolStakedUSD, userStakedUSD };
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

  // Load pool data
  const poolData = await loadPoolData(pool.poolAddress, data.chainId, context);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.poolAddress} on chain ${data.chainId}`,
    );
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  const newPoolStake =
    liquidityPoolAggregator.currentLiquidityStaked + data.amount;

  const { poolStakedUSD } = await computeStakedUSDForPoolAndUser(
    data.chainId,
    pool.poolAddress,
    data.userAddress,
    newPoolStake,
    0n,
    liquidityPoolAggregator,
    poolData,
    context,
  );

  const poolDiff = {
    incrementalNumberOfGaugeDeposits: 1n,
    incrementalCurrentLiquidityStaked: data.amount,
    currentLiquidityStakedUSD: poolStakedUSD,
    lastUpdatedTimestamp: timestamp,
  };

  await updateLiquidityPoolAggregator(
    poolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    data.chainId,
    data.blockNumber,
  );
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

  // Load pool data
  const poolData = await loadPoolData(pool.poolAddress, data.chainId, context);

  if (!poolData) {
    context.log.error(
      `${handlerName}: Pool data not found for pool ${pool.poolAddress} on chain ${data.chainId}`,
    );
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  const newPoolStake =
    liquidityPoolAggregator.currentLiquidityStaked - data.amount;

  if (newPoolStake < 0n) {
    context.log.error(
      `${handlerName}: withdraw exceeds current stake for pool ${pool.poolAddress} user ${data.userAddress}. Skipping update. This needs to be fixed.`,
    );
    return;
  }

  const { poolStakedUSD } = await computeStakedUSDForPoolAndUser(
    data.chainId,
    pool.poolAddress,
    data.userAddress,
    newPoolStake,
    0n,
    liquidityPoolAggregator,
    poolData,
    context,
  );

  const poolDiff = {
    incrementalNumberOfGaugeWithdrawals: 1n,
    incrementalCurrentLiquidityStaked: -data.amount,
    currentLiquidityStakedUSD: poolStakedUSD,
    lastUpdatedTimestamp: timestamp,
  };

  await updateLiquidityPoolAggregator(
    poolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    data.chainId,
    data.blockNumber,
  );
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

  // Load pool data and reward token concurrently
  const [poolData, rewardToken] = await Promise.all([
    loadPoolData(
      pool.poolAddress,
      data.chainId,
      context,
      data.blockNumber,
      data.timestamp,
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

  // Update pool entity
  await updateLiquidityPoolAggregator(
    poolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    data.chainId,
    data.blockNumber,
  );
}
