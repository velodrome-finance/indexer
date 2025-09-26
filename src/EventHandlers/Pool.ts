import { Pool, type Pool_Burn, type Pool_Mint } from "generated";

import { updateLiquidityPoolAggregator } from "../Aggregators/LiquidityPoolAggregator";
import { updateUserFeeContribution } from "../Aggregators/Users";
import { fetchPoolLoaderData } from "../Pools/common";
import { processPoolFees } from "./Pool/PoolFeesLogic";
import { processPoolSwap } from "./Pool/PoolSwapLogic";
import { processPoolSync } from "./Pool/PoolSyncLogic";

Pool.Mint.handler(async ({ event, context }) => {
  const entity: Pool_Mint = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sender: event.params.sender,
    transactionHash: event.transaction.hash,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    sourceAddress: event.srcAddress,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
  };

  context.Pool_Mint.set(entity);
});

Pool.Burn.handler(async ({ event, context }) => {
  const entity: Pool_Burn = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sender: event.params.sender,
    to: event.params.to,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    sourceAddress: event.srcAddress,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
  };

  context.Pool_Burn.set(entity);
});

Pool.Fees.handler(async ({ event, context }) => {
  // Load liquidity pool aggregator and token instances efficiently
  const liquidityPoolAggregator = await context.LiquidityPoolAggregator.get(
    event.srcAddress,
  );

  // Load token instances concurrently using the pool's token IDs
  const [token0Instance, token1Instance] = await Promise.all([
    liquidityPoolAggregator
      ? context.Token.get(liquidityPoolAggregator.token0_id)
      : Promise.resolve(undefined),
    liquidityPoolAggregator
      ? context.Token.get(liquidityPoolAggregator.token1_id)
      : Promise.resolve(undefined),
  ]);

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  // Handle missing data errors
  if (!liquidityPoolAggregator) {
    context.log.error(
      `LiquidityPoolAggregator ${event.srcAddress} not found on chain ${event.chainId}`,
    );
    return;
  }

  if (!token0Instance || !token1Instance) {
    context.log.error(
      `Token not found for pool ${event.srcAddress} on chain ${event.chainId}`,
    );
    return;
  }

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

  // Apply user updates
  if (result.userDiff) {
    await updateUserFeeContribution(
      result.userDiff.userAddress,
      result.userDiff.chainId,
      result.userDiff.feesContributedUSD,
      result.userDiff.feesContributed0,
      result.userDiff.feesContributed1,
      result.userDiff.timestamp,
      context,
    );
  }
});

Pool.Swap.handler(async ({ event, context }) => {
  // Load liquidity pool aggregator and token instances efficiently
  const liquidityPoolAggregator = await context.LiquidityPoolAggregator.get(
    event.srcAddress,
  );

  // Load token instances concurrently using the pool's token IDs
  const [token0Instance, token1Instance] = await Promise.all([
    liquidityPoolAggregator
      ? context.Token.get(liquidityPoolAggregator.token0_id)
      : Promise.resolve(undefined),
    liquidityPoolAggregator
      ? context.Token.get(liquidityPoolAggregator.token1_id)
      : Promise.resolve(undefined),
  ]);

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  // Handle missing data errors
  if (!liquidityPoolAggregator) {
    context.log.error(
      `LiquidityPoolAggregator ${event.srcAddress} not found on chain ${event.chainId}`,
    );
    return;
  }

  if (!token0Instance || !token1Instance) {
    context.log.error(
      `Token not found for pool ${event.srcAddress} on chain ${event.chainId}`,
    );
    return;
  }

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
  // Load liquidity pool aggregator and token instances efficiently
  const liquidityPoolAggregator = await context.LiquidityPoolAggregator.get(
    event.srcAddress,
  );

  // Load token instances concurrently using the pool's token IDs
  const [token0Instance, token1Instance] = await Promise.all([
    liquidityPoolAggregator
      ? context.Token.get(liquidityPoolAggregator.token0_id)
      : Promise.resolve(undefined),
    liquidityPoolAggregator
      ? context.Token.get(liquidityPoolAggregator.token1_id)
      : Promise.resolve(undefined),
  ]);

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  // Handle missing data errors
  if (!liquidityPoolAggregator) {
    context.log.error(
      `LiquidityPoolAggregator ${event.srcAddress} not found on chain ${event.chainId}`,
    );
    return;
  }

  if (!token0Instance || !token1Instance) {
    context.log.error(
      `Token not found for pool ${event.srcAddress} on chain ${event.chainId}`,
    );
    return;
  }

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
