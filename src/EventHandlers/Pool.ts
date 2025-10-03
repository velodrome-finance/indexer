import { Pool } from "generated";

import {
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../Aggregators/LiquidityPoolAggregator";
import {
  loadUserData,
  updateUserPoolFeeContribution,
  updateUserPoolLiquidityActivity,
} from "../Aggregators/UserStatsPerPool";
import { processPoolLiquidityEvent } from "./Pool/PoolBurnAndMintLogic";
import { processPoolFees } from "./Pool/PoolFeesLogic";
import { processPoolSwap } from "./Pool/PoolSwapLogic";
import { processPoolSync } from "./Pool/PoolSyncLogic";

Pool.Mint.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);

  if (!poolData) {
    return;
  }

  // Load user data with event timestamp for actual processing
  const userData = await loadUserData(
    event.params.sender,
    event.srcAddress,
    event.chainId,
    context,
    new Date(event.block.timestamp * 1000),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
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
    context,
  );

  const { liquidityPoolDiff, userLiquidityDiff } = result;

  if (liquidityPoolDiff) {
    // Apply liquidity pool updates
    updateLiquidityPoolAggregator(
      liquidityPoolDiff,
      liquidityPoolAggregator,
      liquidityPoolDiff.lastUpdatedTimestamp as Date,
      context,
      event.block.number,
    );
  }

  // Update user pool liquidity activity
  if (userLiquidityDiff) {
    await updateUserPoolLiquidityActivity(
      userData,
      userLiquidityDiff.netLiquidityAddedUSD,
      userLiquidityDiff.timestamp,
      context,
    );
  }
});

Pool.Burn.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    event.params.sender,
    event.srcAddress,
    event.chainId,
    context,
    new Date(event.block.timestamp * 1000),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  // Process burn event using shared logic
  const result = await processPoolLiquidityEvent(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
    event.params.amount0,
    event.params.amount1,
    context,
  );

  const { liquidityPoolDiff, userLiquidityDiff } = result;

  // Apply liquidity pool updates
  if (liquidityPoolDiff) {
    updateLiquidityPoolAggregator(
      liquidityPoolDiff,
      liquidityPoolAggregator,
      liquidityPoolDiff.lastUpdatedTimestamp as Date,
      context,
      event.block.number,
    );
  }

  // Update user pool liquidity activity
  if (userLiquidityDiff) {
    await updateUserPoolLiquidityActivity(
      userData,
      userLiquidityDiff.netLiquidityAddedUSD,
      userLiquidityDiff.timestamp,
      context,
    );
  }
});

Pool.Fees.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    event.params.sender,
    event.srcAddress,
    event.chainId,
    context,
    new Date(event.block.timestamp * 1000),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  // Create loader return object for compatibility with existing logic
  const loaderReturn = {
    _type: "success" as const,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
  };

  // Process the fees event
  const result = await processPoolFees(event, loaderReturn, context);

  // Handle errors
  if (result.error) {
    context.log.error(result.error);
    return;
  }

  // Apply liquidity pool updates
  if (result.liquidityPoolDiff?.lastUpdatedTimestamp) {
    updateLiquidityPoolAggregator(
      result.liquidityPoolDiff,
      liquidityPoolAggregator,
      result.liquidityPoolDiff.lastUpdatedTimestamp,
      context,
      event.block.number,
    );
  }

  // Update user pool fee contribution
  if (result.userDiff) {
    await updateUserPoolFeeContribution(
      userData,
      result.userDiff.feesContributedUSD,
      result.userDiff.feesContributed0,
      result.userDiff.feesContributed1,
      result.userDiff.timestamp,
      context,
    );
  }
});

Pool.Swap.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  // Create loader return object for compatibility with existing logic
  const loaderReturn = {
    _type: "success" as const,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
  };

  // Process the swap event
  const result = await processPoolSwap(event, loaderReturn, context);

  // Apply the result to the database
  context.Pool_Swap.set(result.PoolSwapEntity);

  // Handle errors
  if (result.error) {
    context.log.error(result.error);
    return;
  }

  // Apply liquidity pool updates
  if (result.liquidityPoolDiff?.lastUpdatedTimestamp) {
    updateLiquidityPoolAggregator(
      result.liquidityPoolDiff,
      liquidityPoolAggregator,
      result.liquidityPoolDiff.lastUpdatedTimestamp,
      context,
      event.block.number,
    );
  }
});

/**
 * Sync event handler.
 * @notice This event is triggered by Uniswap V2 factory when a new LP position is created, and updates the reserves for the pool.
 */
Pool.Sync.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  // Create loader return object for compatibility with existing logic
  const loaderReturn = {
    _type: "success" as const,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
  };

  // Process the sync event
  const result = await processPoolSync(event, loaderReturn, context);

  // Apply the result to the database
  context.Pool_Sync.set(result.PoolSyncEntity);

  // Handle errors
  if (result.error) {
    context.log.error(result.error);
    return;
  }

  // Apply liquidity pool updates
  if (result.liquidityPoolDiff?.lastUpdatedTimestamp) {
    updateLiquidityPoolAggregator(
      result.liquidityPoolDiff,
      liquidityPoolAggregator,
      result.liquidityPoolDiff.lastUpdatedTimestamp,
      context,
      event.block.number,
    );
  }
});
