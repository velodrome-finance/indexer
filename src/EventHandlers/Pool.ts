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

Pool.Fees.handlerWithLoader({
  loader: async ({ event, context }) => {
    return fetchPoolLoaderData(event.srcAddress, context, event.chainId);
  },
  handler: async ({ event, context, loaderReturn }) => {
    // Process the fees event
    const result = await processPoolFees(event, loaderReturn, context);

    // Handle errors
    if (result.error) {
      context.log.error(result.error);
      return;
    }

    // Apply liquidity pool updates
    if (
      result.liquidityPoolDiff &&
      loaderReturn._type === "success" &&
      result.liquidityPoolDiff.lastUpdatedTimestamp
    ) {
      updateLiquidityPoolAggregator(
        result.liquidityPoolDiff,
        loaderReturn.liquidityPoolAggregator,
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
  },
});

Pool.Swap.handlerWithLoader({
  loader: async ({ event, context }) => {
    return fetchPoolLoaderData(event.srcAddress, context, event.chainId);
  },
  handler: async ({ event, context, loaderReturn }) => {
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
    if (
      result.liquidityPoolDiff &&
      loaderReturn._type === "success" &&
      result.liquidityPoolDiff.lastUpdatedTimestamp
    ) {
      updateLiquidityPoolAggregator(
        result.liquidityPoolDiff,
        loaderReturn.liquidityPoolAggregator,
        result.liquidityPoolDiff.lastUpdatedTimestamp,
        context,
        event.block.number,
      );
    }
  },
});

/**
 * Sync event handler.
 * @notice This event is triggered by Uniswap V2 factory when a new LP position is created, and updates the reserves for the pool.
 */
Pool.Sync.handlerWithLoader({
  loader: async ({ event, context }) => {
    return fetchPoolLoaderData(event.srcAddress, context, event.chainId);
  },
  handler: async ({ event, context, loaderReturn }) => {
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
    if (
      result.liquidityPoolDiff &&
      loaderReturn._type === "success" &&
      result.liquidityPoolDiff.lastUpdatedTimestamp
    ) {
      updateLiquidityPoolAggregator(
        result.liquidityPoolDiff,
        loaderReturn.liquidityPoolAggregator,
        result.liquidityPoolDiff.lastUpdatedTimestamp,
        context,
        event.block.number,
      );
    }
  },
});
