import { PoolId, TokenIdByChain } from "../Constants";
import { getCurrentFee, roundBlockToInterval } from "../Effects/Index";
import { generatePoolName } from "../Helpers";
import { refreshTokenPrice } from "../PriceOracle";
import type {
  CLGaugeConfig,
  LiquidityPoolAggregator,
  LiquidityPoolAggregatorSnapshot,
  Token,
  handlerContext,
} from "./../src/Types.gen";

const UPDATE_INTERVAL = 60 * 60 * 1000; // 1 hour

/**
 * Enum for pool address field types
 */
export enum PoolAddressField {
  GAUGE_ADDRESS = "gaugeAddress",
  BRIBE_VOTING_REWARD_ADDRESS = "bribeVotingRewardAddress",
  FEE_VOTING_REWARD_ADDRESS = "feeVotingRewardAddress",
}

export type DynamicFeeConfig = {
  baseFee: bigint;
  feeCap: bigint;
  scalingFactor: bigint;
};

export interface LiquidityPoolAggregatorDiff {
  incrementalReserve0: bigint;
  incrementalReserve1: bigint;
  incrementalTotalLPSupply: bigint;
  incrementalCurrentLiquidityUSD: bigint;
  incrementalTotalVolume0: bigint;
  incrementalTotalVolume1: bigint;
  incrementalTotalVolumeUSD: bigint;
  incrementalTotalVolumeUSDWhitelisted: bigint;
  incrementalTotalFeesGenerated0: bigint;
  incrementalTotalFeesGenerated1: bigint;
  incrementalTotalFeesGeneratedUSD: bigint;
  incrementalTotalFeesUSDWhitelisted: bigint;
  incrementalTotalUnstakedFeesCollected0: bigint;
  incrementalTotalUnstakedFeesCollected1: bigint;
  incrementalTotalUnstakedFeesCollectedUSD: bigint;
  incrementalTotalStakedFeesCollected0: bigint;
  incrementalTotalStakedFeesCollected1: bigint;
  incrementalTotalStakedFeesCollectedUSD: bigint;
  incrementalNumberOfSwaps: bigint;
  incrementalTotalEmissions: bigint;
  incrementalTotalEmissionsUSD: bigint;
  incrementalTotalBribesUSD: bigint;
  incrementalTotalFlashLoanFees0: bigint;
  incrementalTotalFlashLoanFees1: bigint;
  incrementalTotalFlashLoanFeesUSD: bigint;
  incrementalTotalFlashLoanVolumeUSD: bigint;
  incrementalNumberOfFlashLoans: bigint;
  incrementalNumberOfGaugeDeposits: bigint;
  incrementalNumberOfGaugeWithdrawals: bigint;
  incrementalNumberOfGaugeRewardClaims: bigint;
  incrementalTotalGaugeRewardsClaimedUSD: bigint;
  incrementalTotalGaugeRewardsClaimed: bigint;
  incrementalCurrentLiquidityStaked: bigint;
  incrementalCurrentLiquidityStakedUSD: bigint;
  token0Price: bigint;
  token1Price: bigint;
  gaugeIsAlive: boolean;
  gaugeAddress: string;
  bribeVotingRewardAddress: string;
  feeVotingRewardAddress: string;
  feeProtocol0: bigint;
  feeProtocol1: bigint;
  observationCardinalityNext: bigint;
  sqrtPriceX96: bigint;
  tick: bigint;
  totalVotesDeposited: bigint;
  totalVotesDepositedUSD: bigint;
  incrementalTotalBribeClaimed: bigint;
  incrementalTotalBribeClaimedUSD: bigint;
  incrementalTotalFeeRewardClaimed: bigint;
  incrementalTotalFeeRewardClaimedUSD: bigint;
  veNFTamountStaked: bigint;
  baseFee: bigint;
  feeCap: bigint;
  scalingFactor: bigint;
  currentFee: bigint;
  lastUpdatedTimestamp: Date;
  lastSnapshotTimestamp: Date;
}

/**
 * Update the dynamic fee pools data from the swap module.
 * @param liquidityPoolAggregator
 * @param context
 * @param blockNumber
 * @param eventChainId
 * @returns The updated liquidity pool aggregator, or the original if chain mismatch occurs
 */
export async function updateDynamicFeePools(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  context: handlerContext,
  eventChainId: number,
  blockNumber: number,
): Promise<LiquidityPoolAggregator> {
  const poolAddress = liquidityPoolAggregator.poolAddress;
  const chainId = liquidityPoolAggregator.chainId;

  if (chainId !== eventChainId) {
    context.log.warn(
      `[updateDynamicFeePools] Chain ID mismatch for pool entity ${liquidityPoolAggregator.id}. Expected ${eventChainId}, got ${chainId}. No update to currentFee will be performed.
      This is expected if the event is coming from Voter.ts since this contract is only available on Optimism but makes association with
      cross-chain pool entities.`,
    );
    return liquidityPoolAggregator;
  }

  const dynamicFeeGlobalConfigs =
    await context.DynamicFeeGlobalConfig.getWhere.chainId.eq(chainId);

  if (!dynamicFeeGlobalConfigs || dynamicFeeGlobalConfigs.length === 0) {
    context.log.warn(
      `No dynamic fee global config found for chain ${chainId}. No update to currentFee will be performed.`,
    );
    return liquidityPoolAggregator;
  }

  const dynamicFeeModuleAddress = dynamicFeeGlobalConfigs[0].id;

  // base fee + dynamic fee
  const currentFee = await context.effect(getCurrentFee, {
    poolAddress,
    dynamicFeeModuleAddress,
    chainId,
    blockNumber,
  });

  // If fee is undefined, it means the effect failed - skip update to preserve existing fee
  if (currentFee === undefined) {
    context.log.warn(
      `[updateDynamicFeePools] Failed to fetch fee for pool ${poolAddress} on chain ${chainId}, skipping update`,
    );
    return liquidityPoolAggregator;
  }

  // Update the current fee in the pool entity
  const updatedLiquidityPoolAggregator = {
    ...liquidityPoolAggregator,
    currentFee,
  };

  return updatedLiquidityPoolAggregator;
}

/**
 * Creates and stores a snapshot of the current state of a LiquidityPoolAggregator.
 *
 * This function is used to capture the state of a liquidity pool aggregator at a specific
 * point in time. The snapshot includes the pool's ID, a unique snapshot ID, and the timestamp
 * of the last update.
 *
 * @param liquidityPoolAggregator - The current state of the liquidity pool aggregator.
 * @param timestamp - The current timestamp when the snapshot is taken.
 * @param context - The handler context used to store the snapshot.
 */
export function setLiquidityPoolAggregatorSnapshot(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  timestamp: Date,
  context: handlerContext,
) {
  const chainId = liquidityPoolAggregator.chainId;

  const snapshot: LiquidityPoolAggregatorSnapshot = {
    ...liquidityPoolAggregator,
    id: `${PoolId(chainId, liquidityPoolAggregator.poolAddress)}-${timestamp.getTime()}`,
    pool: liquidityPoolAggregator.poolAddress,
    timestamp: timestamp,
  };

  context.LiquidityPoolAggregatorSnapshot.set(snapshot);
}

/**
 * Updates the state of a LiquidityPoolAggregator with new data and manages snapshots.
 *
 * This function applies a set of changes (diff) to the current state of a liquidity pool
 * aggregator. It updates the last updated timestamp and, if more than an hour has passed
 * since the last snapshot, it creates a new snapshot of the aggregator's state.
 *
 * @param diff - An object containing the changes to be applied to the current state.
 * @param current - The current state of the liquidity pool aggregator.
 * @param timestamp - The current timestamp when the update is applied.
 * @param context - The handler context used to store the updated state and snapshots.
 * @param eventChainId - The chain ID of the event that triggered the update.
 * @param blockNumber - The block number of the event that triggered the update.
 */
export async function updateLiquidityPoolAggregator(
  diff: Partial<LiquidityPoolAggregatorDiff>,
  current: LiquidityPoolAggregator,
  timestamp: Date,
  context: handlerContext,
  eventChainId: number,
  blockNumber: number,
) {
  let updated: LiquidityPoolAggregator = {
    ...current,
    // Handle cumulative fields by adding diff values to current values
    reserve0: (diff.incrementalReserve0 ?? 0n) + current.reserve0,
    reserve1: (diff.incrementalReserve1 ?? 0n) + current.reserve1,
    totalLPTokenSupply:
      (diff.incrementalTotalLPSupply ?? 0n) + current.totalLPTokenSupply,
    totalLiquidityUSD:
      (diff.incrementalCurrentLiquidityUSD ?? 0n) + current.totalLiquidityUSD,
    totalVolume0: (diff.incrementalTotalVolume0 ?? 0n) + current.totalVolume0,
    totalVolume1: (diff.incrementalTotalVolume1 ?? 0n) + current.totalVolume1,
    totalVolumeUSD:
      (diff.incrementalTotalVolumeUSD ?? 0n) + current.totalVolumeUSD,
    totalVolumeUSDWhitelisted:
      (diff.incrementalTotalVolumeUSDWhitelisted ?? 0n) +
      current.totalVolumeUSDWhitelisted,
    totalFeesUSDWhitelisted:
      (diff.incrementalTotalFeesUSDWhitelisted ?? 0n) +
      current.totalFeesUSDWhitelisted,
    totalFeesGenerated0:
      (diff.incrementalTotalFeesGenerated0 ?? 0n) + current.totalFeesGenerated0,
    totalFeesGenerated1:
      (diff.incrementalTotalFeesGenerated1 ?? 0n) + current.totalFeesGenerated1,
    totalFeesGeneratedUSD:
      (diff.incrementalTotalFeesGeneratedUSD ?? 0n) +
      current.totalFeesGeneratedUSD,
    // Unstaked fees (from Collect events - LPs that didn't stake)
    totalUnstakedFeesCollected0:
      (diff.incrementalTotalUnstakedFeesCollected0 ?? 0n) +
      current.totalUnstakedFeesCollected0,
    totalUnstakedFeesCollected1:
      (diff.incrementalTotalUnstakedFeesCollected1 ?? 0n) +
      current.totalUnstakedFeesCollected1,
    totalUnstakedFeesCollectedUSD:
      (diff.incrementalTotalUnstakedFeesCollectedUSD ?? 0n) +
      current.totalUnstakedFeesCollectedUSD,
    // Staked fees (from CollectFees events - LPs that staked in gauge)
    totalStakedFeesCollected0:
      (diff.incrementalTotalStakedFeesCollected0 ?? 0n) +
      current.totalStakedFeesCollected0,
    totalStakedFeesCollected1:
      (diff.incrementalTotalStakedFeesCollected1 ?? 0n) +
      current.totalStakedFeesCollected1,
    totalStakedFeesCollectedUSD:
      (diff.incrementalTotalStakedFeesCollectedUSD ?? 0n) +
      current.totalStakedFeesCollectedUSD,
    numberOfSwaps:
      (diff.incrementalNumberOfSwaps ?? 0n) + current.numberOfSwaps,
    totalEmissions:
      (diff.incrementalTotalEmissions ?? 0n) + current.totalEmissions,
    totalEmissionsUSD:
      (diff.incrementalTotalEmissionsUSD ?? 0n) + current.totalEmissionsUSD,
    totalBribesUSD:
      (diff.incrementalTotalBribesUSD ?? 0n) + current.totalBribesUSD,
    totalFlashLoanFees0:
      (diff.incrementalTotalFlashLoanFees0 ?? 0n) +
      (current.totalFlashLoanFees0 ?? 0n),
    totalFlashLoanFees1:
      (diff.incrementalTotalFlashLoanFees1 ?? 0n) +
      (current.totalFlashLoanFees1 ?? 0n),
    totalFlashLoanFeesUSD:
      (diff.incrementalTotalFlashLoanFeesUSD ?? 0n) +
      (current.totalFlashLoanFeesUSD ?? 0n),
    totalFlashLoanVolumeUSD:
      (diff.incrementalTotalFlashLoanVolumeUSD ?? 0n) +
      (current.totalFlashLoanVolumeUSD ?? 0n),
    numberOfFlashLoans:
      (diff.incrementalNumberOfFlashLoans ?? 0n) +
      (current.numberOfFlashLoans ?? 0n),

    // Gauge fields - all cumulative
    numberOfGaugeDeposits:
      (diff.incrementalNumberOfGaugeDeposits ?? 0n) +
      current.numberOfGaugeDeposits,
    numberOfGaugeWithdrawals:
      (diff.incrementalNumberOfGaugeWithdrawals ?? 0n) +
      current.numberOfGaugeWithdrawals,
    numberOfGaugeRewardClaims:
      (diff.incrementalNumberOfGaugeRewardClaims ?? 0n) +
      current.numberOfGaugeRewardClaims,
    totalGaugeRewardsClaimedUSD:
      (diff.incrementalTotalGaugeRewardsClaimedUSD ?? 0n) +
      current.totalGaugeRewardsClaimedUSD,
    totalGaugeRewardsClaimed:
      (diff.incrementalTotalGaugeRewardsClaimed ?? 0n) +
      current.totalGaugeRewardsClaimed,
    currentLiquidityStaked:
      (diff.incrementalCurrentLiquidityStaked ?? 0n) +
      current.currentLiquidityStaked,
    currentLiquidityStakedUSD:
      (diff.incrementalCurrentLiquidityStakedUSD ?? 0n) +
      current.currentLiquidityStakedUSD,

    // Handle non-cumulative fields (prices, timestamps, etc.) - use diff values directly
    token0Price: diff.token0Price ?? current.token0Price,
    token1Price: diff.token1Price ?? current.token1Price,
    gaugeIsAlive: diff.gaugeIsAlive ?? current.gaugeIsAlive,
    gaugeAddress: diff.gaugeAddress ?? current.gaugeAddress,
    bribeVotingRewardAddress:
      diff.bribeVotingRewardAddress ?? current.bribeVotingRewardAddress,
    feeVotingRewardAddress:
      diff.feeVotingRewardAddress ?? current.feeVotingRewardAddress,
    feeProtocol0: diff.feeProtocol0 ?? current.feeProtocol0,
    feeProtocol1: diff.feeProtocol1 ?? current.feeProtocol1,
    observationCardinalityNext:
      diff.observationCardinalityNext ?? current.observationCardinalityNext,
    sqrtPriceX96: diff.sqrtPriceX96 ?? current.sqrtPriceX96,
    tick: diff.tick ?? current.tick,
    totalVotesDeposited:
      diff.totalVotesDeposited ?? current.totalVotesDeposited,
    totalVotesDepositedUSD:
      diff.totalVotesDepositedUSD ?? current.totalVotesDepositedUSD,

    // Voting Reward Claims - cumulative fields
    totalBribeClaimed:
      (diff.incrementalTotalBribeClaimed ?? 0n) + current.totalBribeClaimed,
    totalBribeClaimedUSD:
      (diff.incrementalTotalBribeClaimedUSD ?? 0n) +
      current.totalBribeClaimedUSD,
    totalFeeRewardClaimed:
      (diff.incrementalTotalFeeRewardClaimed ?? 0n) +
      current.totalFeeRewardClaimed,
    totalFeeRewardClaimedUSD:
      (diff.incrementalTotalFeeRewardClaimedUSD ?? 0n) +
      current.totalFeeRewardClaimedUSD,
    veNFTamountStaked: diff.veNFTamountStaked ?? current.veNFTamountStaked,

    // Dynamic Fee fields - non-cumulative
    baseFee: diff.baseFee ?? current.baseFee,
    currentFee: diff.currentFee ?? current.currentFee,
    feeCap: diff.feeCap ?? current.feeCap,
    scalingFactor: diff.scalingFactor ?? current.scalingFactor,

    lastUpdatedTimestamp: timestamp,
  };

  // Update the snapshot if the last update was more than 1 hour ago
  if (
    !current.lastSnapshotTimestamp ||
    timestamp.getTime() - current.lastSnapshotTimestamp.getTime() >
      UPDATE_INTERVAL
  ) {
    // Only update dynamic fees for CL pools (they use dynamic fee modules)
    // Non-CL pools have their fees fixed at a certain constant level. It can change over time, but we fetch that change
    // through events.
    if (updated.isCL) {
      updated = {
        ...updated,
        ...(await updateDynamicFeePools(
          updated,
          context,
          eventChainId,
          blockNumber,
        )),
      };
    }

    setLiquidityPoolAggregatorSnapshot(updated, timestamp, context);
  }

  // Update lastSnapshotTimestamp
  updated = {
    ...updated,
    lastSnapshotTimestamp: timestamp,
  };

  context.LiquidityPoolAggregator.set(updated);
}

/**
 * Common pool data loading and validation logic
 * Loads liquidity pool aggregator and token instances, handles errors
 * If blockNumber and blockTimestamp are provided, token prices will be refreshed
 * (refreshTokenPrice will decide internally if refresh is needed)
 *
 * @param poolAddress - The pool address
 * @param chainId - The chain ID
 * @param context - The handler context
 * @param blockNumber - Optional block number for price refresh
 * @param blockTimestamp - Optional block timestamp for price refresh
 */
export async function loadPoolData(
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  blockNumber?: number,
  blockTimestamp?: number,
): Promise<{
  liquidityPoolAggregator: LiquidityPoolAggregator;
  token0Instance: Token;
  token1Instance: Token;
} | null> {
  const poolId = PoolId(chainId, poolAddress);
  // Load liquidity pool aggregator and token instances efficiently
  const liquidityPoolAggregator =
    await context.LiquidityPoolAggregator.get(poolId);

  // Load token instances concurrently using the pool's token IDs
  const [token0Instance, token1Instance] = await Promise.all([
    liquidityPoolAggregator
      ? context.Token.get(liquidityPoolAggregator.token0_id)
      : Promise.resolve(undefined),
    liquidityPoolAggregator
      ? context.Token.get(liquidityPoolAggregator.token1_id)
      : Promise.resolve(undefined),
  ]);

  // Handle missing data errors
  if (!liquidityPoolAggregator) {
    context.log.error(
      `LiquidityPoolAggregator ${poolId} not found on chain ${chainId}`,
    );
    return null;
  }

  if (!token0Instance || !token1Instance) {
    context.log.error(`Token not found for pool ${poolId} on chain ${chainId}`);
    return null;
  }

  // Refresh token prices if block data is provided
  // refreshTokenPrice will decide internally if refresh is needed
  let updatedToken0 = token0Instance;
  let updatedToken1 = token1Instance;
  if (blockNumber !== undefined && blockTimestamp !== undefined) {
    const roundedBlockNumber = roundBlockToInterval(blockNumber, chainId);

    // Wrap each refresh in a promise that catches errors individually
    const token0Refresh = refreshTokenPrice(
      token0Instance,
      roundedBlockNumber,
      blockTimestamp,
      chainId,
      context,
    ).catch((error) => {
      context.log.error(
        `Error refreshing token0 price for ${token0Instance.address} on chain ${chainId}: ${error}`,
      );
      return token0Instance; // Return original on error
    });

    const token1Refresh = refreshTokenPrice(
      token1Instance,
      roundedBlockNumber,
      blockTimestamp,
      chainId,
      context,
    ).catch((error) => {
      context.log.error(
        `Error refreshing token1 price for ${token1Instance.address} on chain ${chainId}: ${error}`,
      );
      return token1Instance; // Return original on error
    });

    [updatedToken0, updatedToken1] = await Promise.all([
      token0Refresh,
      token1Refresh,
    ]);
  }

  return {
    liquidityPoolAggregator,
    token0Instance: updatedToken0,
    token1Instance: updatedToken1,
  };
}

/**
 * Attempts to load pool data, and if not found, checks if it's a RootCLPool
 * and loads the corresponding leaf pool data instead.
 *
 * @param poolAddress - The pool address to load
 * @param chainId - The chain ID
 * @param context - The handler context
 * @param blockNumber - Optional block number for price refresh
 * @param blockTimestamp - Optional block timestamp for price refresh
 * @returns Pool data (either direct or from leaf pool) or null if not found
 */
export async function loadPoolDataOrRootCLPool(
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  blockNumber?: number,
  blockTimestamp?: number,
): Promise<{
  liquidityPoolAggregator: LiquidityPoolAggregator;
  token0Instance: Token;
  token1Instance: Token;
} | null> {
  const poolData = await loadPoolData(
    poolAddress,
    chainId,
    context,
    blockNumber,
    blockTimestamp,
  );

  if (poolData) {
    return poolData;
  }

  context.log.warn(
    `Pool data not found for pool ${poolAddress} on chain ${chainId}. Might be a RootCLPool therefore we must get the actual Pool (on leaf chain) through the RootPool_LeafPool mapping`,
  );

  const rootPoolLeafPools =
    (await context.RootPool_LeafPool.getWhere?.rootPoolAddress?.eq(
      poolAddress,
    )) ?? [];

  if (rootPoolLeafPools.length !== 1) {
    context.log.error(
      `Expected exactly one RootPool_LeafPool for pool ${poolAddress} on chain ${chainId}`,
    );
    return null;
  }

  const rootPoolLeafPool = rootPoolLeafPools[0];
  const leafPoolAddress = rootPoolLeafPool.leafPoolAddress;
  const leafChainId = rootPoolLeafPool.leafChainId;
  const leafPoolData = await loadPoolData(
    leafPoolAddress,
    leafChainId,
    context,
    blockNumber,
    blockTimestamp,
  );

  if (!leafPoolData) {
    context.log.error(
      `Leaf pool data not found for pool ${leafPoolAddress} on chain ${leafChainId}`,
    );
    return null;
  }

  return leafPoolData;
}

/**
 * Generic function to find a pool by any indexed address field
 * @param address - The address to search for
 * @param chainId - The chain ID
 * @param context - The handler context
 * @param field - The field to search by
 * @returns The pool entity if found, null otherwise
 */
export async function findPoolByField(
  address: string,
  chainId: number,
  context: handlerContext,
  field: PoolAddressField,
): Promise<LiquidityPoolAggregator | null> {
  // Query pools by the specified field using the indexed field
  const pools =
    await context.LiquidityPoolAggregator.getWhere[field].eq(address);

  // Filter by chainId and return the first match (should be unique)
  const matchingPool = pools.find((pool) => pool.chainId === chainId);
  return matchingPool || null;
}

/**
 * Find a pool by its gauge address using direct database query
 * @param gaugeAddress - The gauge address to search for
 * @param chainId - The chain ID
 * @param context - The handler context
 * @returns The pool entity if found, null otherwise
 */
export async function findPoolByGaugeAddress(
  gaugeAddress: string,
  chainId: number,
  context: handlerContext,
): Promise<LiquidityPoolAggregator | null> {
  return findPoolByField(
    gaugeAddress,
    chainId,
    context,
    PoolAddressField.GAUGE_ADDRESS,
  );
}

/**
 * Creates a new LiquidityPoolAggregator entity with default values
 * @param params - Parameters for creating the pool entity
 * @returns A new LiquidityPoolAggregator entity
 */
export function createLiquidityPoolAggregatorEntity(params: {
  poolAddress: string;
  chainId: number;
  isCL: boolean;
  isStable: boolean;
  token0Address: string;
  token1Address: string;
  token0Symbol: string;
  token1Symbol: string;
  timestamp: Date;
  tickSpacing?: number; // For CL pools
  CLGaugeConfig?: CLGaugeConfig | null; // For CL pools
  baseFee: bigint;
  currentFee: bigint;
}): LiquidityPoolAggregator {
  const {
    poolAddress,
    chainId,
    isCL,
    isStable,
    token0Address,
    token1Address,
    token0Symbol,
    token1Symbol,
    timestamp,
    tickSpacing,
    CLGaugeConfig,
    baseFee,
    currentFee,
  } = params;

  return {
    id: PoolId(chainId, poolAddress),
    poolAddress: poolAddress,
    chainId: chainId,
    isCL: isCL,
    name: generatePoolName(
      token0Symbol,
      token1Symbol,
      isStable,
      isCL ? (tickSpacing ?? 0) : 0,
    ),
    token0_id: TokenIdByChain(token0Address, chainId),
    token1_id: TokenIdByChain(token1Address, chainId),
    token0_address: token0Address,
    token1_address: token1Address,
    isStable: isStable,
    tickSpacing: tickSpacing ? BigInt(tickSpacing) : 0n, // 0 for non-CL pools
    reserve0: 0n,
    reserve1: 0n,
    totalLPTokenSupply: 0n,
    totalLiquidityUSD: 0n,
    totalVolume0: 0n,
    totalVolume1: 0n,
    totalVolumeUSD: 0n,
    totalFeesGenerated0: 0n,
    totalFeesGenerated1: 0n,
    totalFeesGeneratedUSD: 0n,
    totalVolumeUSDWhitelisted: 0n,
    totalUnstakedFeesCollected0: 0n,
    totalUnstakedFeesCollected1: 0n,
    totalStakedFeesCollected0: 0n,
    totalStakedFeesCollected1: 0n,
    totalUnstakedFeesCollectedUSD: 0n,
    totalStakedFeesCollectedUSD: 0n,
    totalFeesUSDWhitelisted: 0n,
    numberOfSwaps: 0n,
    token0Price: 0n,
    token1Price: 0n,
    totalEmissions: 0n,
    totalEmissionsUSD: 0n,
    totalBribesUSD: 0n,
    totalVotesDeposited: 0n,
    totalVotesDepositedUSD: 0n,
    gaugeIsAlive: false,
    lastUpdatedTimestamp: timestamp,
    lastSnapshotTimestamp: timestamp,
    // CL Pool specific fields (set to 0 for regular pools)
    feeProtocol0: 0n,
    feeProtocol1: 0n,
    observationCardinalityNext: 0n,
    sqrtPriceX96: 0n,
    tick: 0n,
    totalFlashLoanFees0: 0n,
    totalFlashLoanFees1: 0n,
    totalFlashLoanFeesUSD: 0n,
    totalFlashLoanVolumeUSD: 0n,
    numberOfFlashLoans: 0n,
    // Gauge fields
    numberOfGaugeDeposits: 0n,
    numberOfGaugeWithdrawals: 0n,
    numberOfGaugeRewardClaims: 0n,
    totalGaugeRewardsClaimedUSD: 0n,
    totalGaugeRewardsClaimed: 0n,
    currentLiquidityStaked: 0n,
    currentLiquidityStakedUSD: 0n,
    // Voting Reward fields
    bribeVotingRewardAddress: "",
    totalBribeClaimed: 0n,
    totalBribeClaimedUSD: 0n,
    feeVotingRewardAddress: "",
    totalFeeRewardClaimed: 0n,
    totalFeeRewardClaimedUSD: 0n,
    veNFTamountStaked: 0n,
    // Pool Launcher relationship (undefined for pools not launched via PoolLauncher)
    poolLauncherPoolId: undefined,
    // Voting fields
    gaugeAddress: "",
    // Set to undefined if CLGaugeConfig does not exist (i.e before the deployment of NewCLGaugeFactory which introduces emissions caps per gauge)
    // Otherwise, set to defaultEmissionCap
    gaugeEmissionsCap: CLGaugeConfig
      ? CLGaugeConfig.defaultEmissionsCap
      : isCL
        ? undefined
        : 0n,
    // Dynamic Fee fields
    baseFee: baseFee,
    feeCap: undefined,
    scalingFactor: undefined,
    currentFee: currentFee,
    rootPoolMatchingHash: `${chainId}_${token0Address}_${token1Address}_${(tickSpacing ? BigInt(tickSpacing) : 0n).toString()}`,
  };
}
