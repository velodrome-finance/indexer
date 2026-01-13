import { Pool } from "generated";

import {
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../Aggregators/LiquidityPoolAggregator";
import { createOUSDTSwapEntity } from "../Aggregators/OUSDTSwaps";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../Aggregators/UserStatsPerPool";
import { OUSDT_ADDRESS } from "../Constants";
import { processPoolLiquidityEvent } from "./Pool/PoolBurnAndMintLogic";
import { processPoolFees } from "./Pool/PoolFeesLogic";
import { processPoolSwap } from "./Pool/PoolSwapLogic";
import { processPoolSync } from "./Pool/PoolSyncLogic";

Pool.Mint.handler(async ({ event, context }) => {
  // Load pool data and user data concurrently for better performance
  // Pass block number and timestamp to refresh token prices
  const [poolData, userData] = await Promise.all([
    loadPoolData(
      event.srcAddress,
      event.chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadOrCreateUserData(
      event.params.sender,
      event.srcAddress,
      event.chainId,
      context,
      new Date(event.block.timestamp * 1000),
    ),
  ]);

  if (!poolData) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  // Process mint event using shared logic
  const result = await processPoolLiquidityEvent(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
    event.params.amount0,
    event.params.amount1,
  );

  const { liquidityPoolDiff, userLiquidityDiff } = result;

  const timestamp = new Date(event.block.timestamp * 1000);

  // Update pool and user entities in parallel
  await Promise.all([
    updateLiquidityPoolAggregator(
      liquidityPoolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.block.number,
    ),
    userLiquidityDiff
      ? updateUserStatsPerPool(userLiquidityDiff, userData, context)
      : Promise.resolve(),
  ]);
});

Pool.Burn.handler(async ({ event, context }) => {
  // Load pool data and user data concurrently for better performance
  // Pass block number and timestamp to refresh token prices
  const [poolData, userData] = await Promise.all([
    loadPoolData(
      event.srcAddress,
      event.chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadOrCreateUserData(
      event.params.sender,
      event.srcAddress,
      event.chainId,
      context,
      new Date(event.block.timestamp * 1000),
    ),
  ]);

  if (!poolData) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  // Process burn event using shared logic
  const result = processPoolLiquidityEvent(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
    event.params.amount0,
    event.params.amount1,
  );

  const { liquidityPoolDiff, userLiquidityDiff } = result;

  const timestamp = new Date(event.block.timestamp * 1000);

  // Update pool and user entities in parallel
  await Promise.all([
    updateLiquidityPoolAggregator(
      liquidityPoolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.block.number,
    ),
    userLiquidityDiff
      ? updateUserStatsPerPool(userLiquidityDiff, userData, context)
      : Promise.resolve(),
  ]);
});

Pool.Fees.handler(async ({ event, context }) => {
  // Load pool data and user data concurrently for better performance
  // Pass block number and timestamp to refresh token prices
  const [poolData, userData] = await Promise.all([
    loadPoolData(
      event.srcAddress,
      event.chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadOrCreateUserData(
      event.params.sender,
      event.srcAddress,
      event.chainId,
      context,
      new Date(event.block.timestamp * 1000),
    ),
  ]);

  if (!poolData) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  // Process fees event
  const result = processPoolFees(event, token0Instance, token1Instance);

  const { liquidityPoolDiff, userDiff } = result;

  const timestamp = new Date(event.block.timestamp * 1000);

  // Update pool and user entities in parallel
  await Promise.all([
    liquidityPoolDiff
      ? updateLiquidityPoolAggregator(
          liquidityPoolDiff,
          liquidityPoolAggregator,
          timestamp,
          context,
          event.block.number,
        )
      : Promise.resolve(),
    userDiff
      ? updateUserStatsPerPool(userDiff, userData, context)
      : Promise.resolve(),
  ]);
});

Pool.Swap.handler(async ({ event, context }) => {
  // Load pool data and user data concurrently for better performance
  // Pass block number and timestamp to refresh token prices
  const [poolData, userData] = await Promise.all([
    loadPoolData(
      event.srcAddress,
      event.chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadOrCreateUserData(
      event.params.sender,
      event.srcAddress,
      event.chainId,
      context,
      new Date(event.block.timestamp * 1000),
    ),
  ]);

  if (!poolData) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  // Process swap event
  const result = processPoolSwap(event, token0Instance, token1Instance);

  const { liquidityPoolDiff, userSwapDiff } = result;

  const timestamp = new Date(event.block.timestamp * 1000);

  // Update pool and user entities in parallel
  await Promise.all([
    updateLiquidityPoolAggregator(
      liquidityPoolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.block.number,
    ),
    updateUserStatsPerPool(userSwapDiff, userData, context),
  ]);

  // Create OUSDTSwaps entity only if oUSDT is involved
  if (
    token0Instance.address === OUSDT_ADDRESS ||
    token1Instance.address === OUSDT_ADDRESS
  ) {
    createOUSDTSwapEntity(
      event.transaction.hash,
      event.chainId,
      token0Instance,
      token1Instance,
      event.params.amount0In,
      event.params.amount0Out,
      event.params.amount1In,
      event.params.amount1Out,
      context,
    );
  }
});

/**
 * Sync event handler.
 * @notice This event is triggered by Uniswap V2 factory when a new LP position is created, and updates the reserves for the pool.
 */
Pool.Sync.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(
    event.srcAddress,
    event.chainId,
    context,
    event.block.number,
    event.block.timestamp,
  );
  if (!poolData) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  const { liquidityPoolDiff } = processPoolSync(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
  );

  // Apply liquidity pool updates
  if (liquidityPoolDiff) {
    await updateLiquidityPoolAggregator(
      liquidityPoolDiff,
      liquidityPoolAggregator,
      liquidityPoolDiff.lastUpdatedTimestamp as Date,
      context,
      event.block.number,
    );
  }
});
