import {
  LiquidityPoolAggregator,
  LiquidityPoolAggregatorSnapshot,
  Dynamic_Fee_Swap_Module,
  handlerContext,
} from "./../src/Types.gen";
import { CHAIN_CONSTANTS } from "./../Constants";
import DynamicFeePoolABI from "./../../abis/DynamicFeeSwapModule.json";
import CLPoolABI from "./../../abis/CLPool.json";

const UPDATE_INTERVAL = 60 * 60 * 1000; // 1 hour
const DYNAMIC_FEE_MODULE_ADDRESS = "0xd9eE4FBeE92970509ec795062cA759F8B52d6720"; // CA for dynamic fee module
const DYNAMIC_FEE_START_BLOCK = 131341414; // Starting from this block to track dynamic fee pools

type DynamicFeeConfig = {
  baseFee: bigint;
  feeCap: bigint;
  scalingFactor: bigint;
}

type GaugeFees = {
  token0Fees: bigint;
  token1Fees: bigint;
}

/**
 * Get the dynamic fee config parameters for the dynamic fee pool.
 * @param poolAddress 
 * @param chainId 
 * @param blockNumber 
 * @returns {DynamicFeeConfig}
 */
async function getDynamicFeeConfig(poolAddress: string, chainId: number, blockNumber: number): Promise<DynamicFeeConfig> {
    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    const { result } = await ethClient.simulateContract({
        address: DYNAMIC_FEE_MODULE_ADDRESS as `0x${string}`,
        abi: DynamicFeePoolABI,
        functionName: 'dynamicFeeConfig',
        args: [poolAddress],
        blockNumber: BigInt(blockNumber),
    });
    const dynamicFeeConfig: DynamicFeeConfig = {
      baseFee: result[0],
      feeCap: result[1],
      scalingFactor: result[2]
    };
    return dynamicFeeConfig;
}

/**
 * Get the current fee for the dynamic fee pool.
 * @param poolAddress 
 * @param chainId 
 * @param blockNumber 
 * @returns {bigint}
 */
async function getCurrentFee(poolAddress: string, chainId: number, blockNumber: number) {
    const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
    const { result } = await ethClient.simulateContract({
        address: DYNAMIC_FEE_MODULE_ADDRESS as `0x${string}`,
        abi: DynamicFeePoolABI,
        functionName: 'getFee',
        args: [poolAddress],
        blockNumber: BigInt(blockNumber),
    });
    return result;
}

/**
 * Get the current accumulated gauge fees for the CL pool. Resets to zero after epoch flip.
 * @param poolAddress 
 * @param chainId 
 * @param blockNumber 
 * @returns {GaugeFees}
 */
export async function getCurrentAccumulatedFeeCL(poolAddress: string, chainId: number, blockNumber: number) {
  const ethClient = CHAIN_CONSTANTS[chainId].eth_client;
  const { result } = await ethClient.simulateContract({
    address: poolAddress as `0x${string}`,
    abi: CLPoolABI,
    functionName: 'gaugeFees',
    blockNumber: BigInt(blockNumber),
  });
  const gaugeFees: GaugeFees = {
    token0Fees: result[0],
    token1Fees: result[1],
  };
  return gaugeFees;
}

/**
 * Update the dynamic fee pools data from the swap module.
 * @param liquidityPoolAggregator 
 * @param context 
 * @param blockNumber 
 */
export async function updateDynamicFeePools(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  context: handlerContext,
  blockNumber: number
) {
  const poolAddress = liquidityPoolAggregator.id;
  const chainId = liquidityPoolAggregator.chainId;

  if (chainId === 10 && blockNumber >= DYNAMIC_FEE_START_BLOCK) {
    try {
      const dynamicFeeConfigData = await getDynamicFeeConfig(poolAddress, chainId, blockNumber);
      const currentFee = await getCurrentFee(poolAddress, chainId, blockNumber);

      const dynamicFeeConfig: Dynamic_Fee_Swap_Module = {
        ...dynamicFeeConfigData,
        currentFee,
        pool: poolAddress,
        timestamp: liquidityPoolAggregator.lastUpdatedTimestamp,
        chainId,
        blockNumber,
        id: `${chainId}-${poolAddress}-${blockNumber}`,
      }

      context.Dynamic_Fee_Swap_Module.set(dynamicFeeConfig);
    } catch (error) {
      // No error if the pool is not a dynamic fee pool
      return;
    }
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
  context: handlerContext
) {
  const chainId = liquidityPoolAggregator.chainId;

  const snapshot: LiquidityPoolAggregatorSnapshot = {
    ...liquidityPoolAggregator,
    pool: liquidityPoolAggregator.id,
    id: `${chainId}-${liquidityPoolAggregator.id}_${timestamp.getTime()}`,
    timestamp: liquidityPoolAggregator.lastUpdatedTimestamp,
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
  diff: any,
  current: LiquidityPoolAggregator,
  timestamp: Date,
  context: handlerContext,
  blockNumber: number
) {
  const updated: LiquidityPoolAggregator = {
    ...current,
    ...diff,
    lastUpdatedTimestamp: timestamp,
  };

  context.LiquidityPoolAggregator.set(updated);

  // Update the snapshot if the last update was more than 1 hour ago
  if (
    !current.lastSnapshotTimestamp ||
    (timestamp.getTime() - current.lastSnapshotTimestamp.getTime() >
    UPDATE_INTERVAL)
  ) {
    if (current.isCL) {
      try {
        const gaugeFees = await getCurrentAccumulatedFeeCL(current.id, current.chainId, blockNumber);
        const gaugeFeeUpdated: LiquidityPoolAggregator = {
          ...updated,
          gaugeFees0CurrentEpoch: gaugeFees.token0Fees,
          gaugeFees1CurrentEpoch: gaugeFees.token1Fees,
        };
        setLiquidityPoolAggregatorSnapshot(gaugeFeeUpdated, timestamp, context);
        return;
      } catch (error) {
        // No error if the pool is not a CL pool
      }
    }
    setLiquidityPoolAggregatorSnapshot(updated, timestamp, context);
  }
}
