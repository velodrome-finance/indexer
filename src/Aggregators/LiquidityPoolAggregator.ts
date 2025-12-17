import { TokenIdByChain } from "../Constants";
import { getCurrentAccumulatedFeeCL, getCurrentFee } from "../Effects/Index";
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

export type DynamicFeeConfig = {
  baseFee: bigint;
  feeCap: bigint;
  scalingFactor: bigint;
};

export type GaugeFees = {
  token0Fees: bigint;
  token1Fees: bigint;
};

/**
 * Update the dynamic fee pools data from the swap module.
 * @param liquidityPoolAggregator
 * @param context
 * @param blockNumber
 */
export async function updateDynamicFeePools(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  context: handlerContext,
  blockNumber: number,
) {
  const poolAddress = liquidityPoolAggregator.id;
  const chainId = liquidityPoolAggregator.chainId;

  const dynamicFeeGlobalConfigs =
    await context.DynamicFeeGlobalConfig.getWhere.chainId.eq(chainId);

  if (!dynamicFeeGlobalConfigs || dynamicFeeGlobalConfigs.length === 0) {
    context.log.warn(
      `No dynamic fee global config found for chain ${chainId}. No update to currentFee will be performed.`,
    );
    return;
  }

  const dynamicFeeModuleAddress = dynamicFeeGlobalConfigs[0].id;

  try {
    // base fee + dynamic fee
    const currentFee = await context.effect(getCurrentFee, {
      poolAddress,
      dynamicFeeModuleAddress,
      chainId,
      blockNumber,
    });

    // Update the current fee in the pool entity
    const updated: LiquidityPoolAggregator = {
      ...liquidityPoolAggregator,
      currentFee,
    };

    context.LiquidityPoolAggregator.set(updated);
  } catch (error) {
    // No error if the pool is not a dynamic fee pool
    return;
  }
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
    pool: liquidityPoolAggregator.id,
    id: `${chainId}-${liquidityPoolAggregator.id}_${timestamp.getTime()}`,
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
 */
export async function updateLiquidityPoolAggregator(
  diff: Partial<LiquidityPoolAggregator>,
  current: LiquidityPoolAggregator,
  timestamp: Date,
  context: handlerContext,
  blockNumber: number,
) {
  let updated: LiquidityPoolAggregator = {
    ...current,
    // Handle cumulative fields by adding diff values to current values
    reserve0: (diff.reserve0 ?? 0n) + current.reserve0,
    reserve1: (diff.reserve1 ?? 0n) + current.reserve1,
    totalLiquidityUSD:
      (diff.totalLiquidityUSD ?? 0n) + current.totalLiquidityUSD,
    totalVolume0: (diff.totalVolume0 ?? 0n) + current.totalVolume0,
    totalVolume1: (diff.totalVolume1 ?? 0n) + current.totalVolume1,
    totalVolumeUSD: (diff.totalVolumeUSD ?? 0n) + current.totalVolumeUSD,
    totalVolumeUSDWhitelisted:
      (diff.totalVolumeUSDWhitelisted ?? 0n) +
      current.totalVolumeUSDWhitelisted,
    gaugeFees0CurrentEpoch:
      (diff.gaugeFees0CurrentEpoch ?? 0n) + current.gaugeFees0CurrentEpoch,
    gaugeFees1CurrentEpoch:
      (diff.gaugeFees1CurrentEpoch ?? 0n) + current.gaugeFees1CurrentEpoch,
    totalFeesUSDWhitelisted:
      (diff.totalFeesUSDWhitelisted ?? 0n) + current.totalFeesUSDWhitelisted,
    // Unstaked fees (from Collect events - LPs that didn't stake)
    totalUnstakedFeesCollected0:
      (diff.totalUnstakedFeesCollected0 ?? 0n) +
      current.totalUnstakedFeesCollected0,
    totalUnstakedFeesCollected1:
      (diff.totalUnstakedFeesCollected1 ?? 0n) +
      current.totalUnstakedFeesCollected1,
    totalUnstakedFeesCollectedUSD:
      (diff.totalUnstakedFeesCollectedUSD ?? 0n) +
      current.totalUnstakedFeesCollectedUSD,
    // Staked fees (from CollectFees events - LPs that staked in gauge)
    totalStakedFeesCollected0:
      (diff.totalStakedFeesCollected0 ?? 0n) +
      current.totalStakedFeesCollected0,
    totalStakedFeesCollected1:
      (diff.totalStakedFeesCollected1 ?? 0n) +
      current.totalStakedFeesCollected1,
    totalStakedFeesCollectedUSD:
      (diff.totalStakedFeesCollectedUSD ?? 0n) +
      current.totalStakedFeesCollectedUSD,
    numberOfSwaps: (diff.numberOfSwaps ?? 0n) + current.numberOfSwaps,
    totalEmissions: (diff.totalEmissions ?? 0n) + current.totalEmissions,
    totalEmissionsUSD:
      (diff.totalEmissionsUSD ?? 0n) + current.totalEmissionsUSD,
    totalBribesUSD: (diff.totalBribesUSD ?? 0n) + current.totalBribesUSD,
    totalFlashLoanFees0:
      (diff.totalFlashLoanFees0 ?? 0n) + (current.totalFlashLoanFees0 ?? 0n),
    totalFlashLoanFees1:
      (diff.totalFlashLoanFees1 ?? 0n) + (current.totalFlashLoanFees1 ?? 0n),
    totalFlashLoanFeesUSD:
      (diff.totalFlashLoanFeesUSD ?? 0n) +
      (current.totalFlashLoanFeesUSD ?? 0n),
    totalFlashLoanVolumeUSD:
      (diff.totalFlashLoanVolumeUSD ?? 0n) +
      (current.totalFlashLoanVolumeUSD ?? 0n),
    numberOfFlashLoans:
      (diff.numberOfFlashLoans ?? 0n) + (current.numberOfFlashLoans ?? 0n),

    // Gauge fields - all cumulative
    numberOfGaugeDeposits:
      (diff.numberOfGaugeDeposits ?? 0n) + current.numberOfGaugeDeposits,
    numberOfGaugeWithdrawals:
      (diff.numberOfGaugeWithdrawals ?? 0n) + current.numberOfGaugeWithdrawals,
    numberOfGaugeRewardClaims:
      (diff.numberOfGaugeRewardClaims ?? 0n) +
      current.numberOfGaugeRewardClaims,
    totalGaugeRewardsClaimedUSD:
      (diff.totalGaugeRewardsClaimedUSD ?? 0n) +
      current.totalGaugeRewardsClaimedUSD,
    totalGaugeRewardsClaimed:
      (diff.totalGaugeRewardsClaimed ?? 0n) + current.totalGaugeRewardsClaimed,
    currentLiquidityStaked:
      (diff.currentLiquidityStaked ?? 0n) + current.currentLiquidityStaked,
    currentLiquidityStakedUSD:
      (diff.currentLiquidityStakedUSD ?? 0n) +
      current.currentLiquidityStakedUSD,

    // Handle non-cumulative fields (prices, timestamps, etc.) - use diff values directly
    token0Price: diff.token0Price ?? current.token0Price,
    token1Price: diff.token1Price ?? current.token1Price,
    token0IsWhitelisted:
      diff.token0IsWhitelisted ?? current.token0IsWhitelisted,
    token1IsWhitelisted:
      diff.token1IsWhitelisted ?? current.token1IsWhitelisted,
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
    totalVotesDeposited:
      diff.totalVotesDeposited ?? current.totalVotesDeposited,
    totalVotesDepositedUSD:
      diff.totalVotesDepositedUSD ?? current.totalVotesDepositedUSD,

    // Voting Reward Claims - cumulative fields
    totalBribeClaimed:
      (diff.totalBribeClaimed ?? 0n) + current.totalBribeClaimed,
    totalBribeClaimedUSD:
      (diff.totalBribeClaimedUSD ?? 0n) + current.totalBribeClaimedUSD,
    totalFeeRewardClaimed:
      (diff.totalFeeRewardClaimed ?? 0n) + current.totalFeeRewardClaimed,
    totalFeeRewardClaimedUSD:
      (diff.totalFeeRewardClaimedUSD ?? 0n) + current.totalFeeRewardClaimedUSD,
    veNFTamountStaked:
      diff.veNFTamountStaked !== undefined
        ? diff.veNFTamountStaked
        : current.veNFTamountStaked, // Direct replacement (absolute value from event)

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
    if (current.isCL) {
      try {
        const gaugeFees = await context.effect(getCurrentAccumulatedFeeCL, {
          poolAddress: current.id,
          chainId: current.chainId,
          blockNumber,
        });
        updated = {
          ...updated,
          gaugeFees0CurrentEpoch:
            gaugeFees.token0Fees !== 0n
              ? gaugeFees.token0Fees
              : current.gaugeFees0CurrentEpoch,
          gaugeFees1CurrentEpoch:
            gaugeFees.token1Fees !== 0n
              ? gaugeFees.token1Fees
              : current.gaugeFees1CurrentEpoch,
        };
      } catch (error) {
        // No error if the pool is not a CL pool
      }
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
 * @param srcAddress - The pool address
 * @param chainId - The chain ID
 * @param context - The handler context
 * @param blockNumber - Optional block number for price refresh
 * @param blockTimestamp - Optional block timestamp for price refresh
 */
export async function loadPoolData(
  srcAddress: string,
  chainId: number,
  context: handlerContext,
  blockNumber?: number,
  blockTimestamp?: number,
): Promise<{
  liquidityPoolAggregator: LiquidityPoolAggregator;
  token0Instance: Token;
  token1Instance: Token;
} | null> {
  // Load liquidity pool aggregator and token instances efficiently
  const liquidityPoolAggregator =
    await context.LiquidityPoolAggregator.get(srcAddress);

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
      `LiquidityPoolAggregator ${srcAddress} not found on chain ${chainId}`,
    );
    return null;
  }

  if (!token0Instance || !token1Instance) {
    context.log.error(
      `Token not found for pool ${srcAddress} on chain ${chainId}`,
    );
    return null;
  }

  // Refresh token prices if block data is provided
  // refreshTokenPrice will decide internally if refresh is needed
  let updatedToken0 = token0Instance;
  let updatedToken1 = token1Instance;
  if (blockNumber !== undefined && blockTimestamp !== undefined) {
    // Wrap each refresh in a promise that catches errors individually
    const token0Refresh = refreshTokenPrice(
      token0Instance,
      blockNumber,
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
      blockNumber,
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
    await context.RootPool_LeafPool.getWhere.rootPoolAddress.eq(poolAddress);

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
 * Enum for pool address field types
 */
export enum PoolAddressField {
  GAUGE_ADDRESS = "gaugeAddress",
  BRIBE_VOTING_REWARD_ADDRESS = "bribeVotingRewardAddress",
  FEE_VOTING_REWARD_ADDRESS = "feeVotingRewardAddress",
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
  token0IsWhitelisted: boolean;
  token1IsWhitelisted: boolean;
  timestamp: Date;
  tickSpacing?: number; // For CL pools
  CLGaugeConfig?: CLGaugeConfig | null; // For CL pools
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
    token0IsWhitelisted,
    token1IsWhitelisted,
    timestamp,
    tickSpacing,
    CLGaugeConfig,
  } = params;

  return {
    id: poolAddress,
    chainId,
    isCL,
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
    isStable,
    tickSpacing: tickSpacing ? BigInt(tickSpacing) : 0n, // 0 for non-CL pools
    reserve0: 0n,
    reserve1: 0n,
    totalLiquidityUSD: 0n,
    totalVolume0: 0n,
    totalVolume1: 0n,
    totalVolumeUSD: 0n,
    totalVolumeUSDWhitelisted: 0n,
    gaugeFees0CurrentEpoch: 0n,
    gaugeFees1CurrentEpoch: 0n,
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
    token0IsWhitelisted: token0IsWhitelisted,
    token1IsWhitelisted: token1IsWhitelisted,
    lastUpdatedTimestamp: timestamp,
    lastSnapshotTimestamp: timestamp,
    // CL Pool specific fields (set to 0 for regular pools)
    feeProtocol0: 0n,
    feeProtocol1: 0n,
    observationCardinalityNext: 0n,
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
    // Dynamic Fee fields (undefined initially)
    baseFee: undefined,
    feeCap: undefined,
    scalingFactor: undefined,
    currentFee: undefined,
    rootPoolMatchingHash: `${chainId}_${token0Address}_${token1Address}_${tickSpacing}`,
  };
}
