import {
  Pool,
  type Pool_Burn,
  type Pool_Fees,
  type Pool_Mint,
  type Pool_Swap,
  type Pool_Sync,
} from "generated";

import { updateLiquidityPoolAggregator } from "../Aggregators/LiquidityPoolAggregator";
import { fetchPoolLoaderData } from "../Pools/common";
import { normalizeTokenAmountTo1e18 } from "./../Helpers";
import { multiplyBase1e18 } from "./../Maths";
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
    const entity: Pool_Fees = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      sender: event.params.sender,
      amount0: event.params.amount0,
      amount1: event.params.amount1,
      sourceAddress: event.srcAddress,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
      transactionHash: event.transaction.hash,
    };

    context.Pool_Fees.set(entity);

    switch (loaderReturn._type) {
      case "success": {
        const { liquidityPoolAggregator, token0Instance, token1Instance } =
          loaderReturn;

        const tokenUpdateData = {
          totalFees0: event.params.amount0,
          totalFees1: event.params.amount1,
          totalFeesNormalized0: 0n,
          totalFeesNormalized1: 0n,
          totalFeesUSD: 0n,
          totalFeesUSDWhitelisted: 0n,
        };

        tokenUpdateData.totalFeesNormalized0 = normalizeTokenAmountTo1e18(
          event.params.amount0,
          Number(token0Instance.decimals),
        );
        const token0FeesUSD = multiplyBase1e18(
          tokenUpdateData.totalFeesNormalized0,
          token0Instance.pricePerUSDNew,
        );

        tokenUpdateData.totalFeesUSD += token0FeesUSD;
        tokenUpdateData.totalFeesUSDWhitelisted += token0Instance.isWhitelisted
          ? token0FeesUSD
          : 0n;

        tokenUpdateData.totalFees1 = event.params.amount1;
        tokenUpdateData.totalFeesNormalized1 = normalizeTokenAmountTo1e18(
          event.params.amount1,
          Number(token1Instance.decimals),
        );
        const token1FeesUSD = multiplyBase1e18(
          tokenUpdateData.totalFeesNormalized1,
          token1Instance.pricePerUSDNew,
        );
        tokenUpdateData.totalFeesUSD += token1FeesUSD;
        tokenUpdateData.totalFeesUSDWhitelisted += token1Instance.isWhitelisted
          ? token1FeesUSD
          : 0n;

        const liquidityPoolDiff = {
          totalFees0:
            liquidityPoolAggregator.totalFees0 + tokenUpdateData.totalFees0,
          totalFees1:
            liquidityPoolAggregator.totalFees1 + tokenUpdateData.totalFees1,
          totalFeesUSD:
            liquidityPoolAggregator.totalFeesUSD + tokenUpdateData.totalFeesUSD,
          totalFeesUSDWhitelisted:
            liquidityPoolAggregator.totalFeesUSDWhitelisted +
            tokenUpdateData.totalFeesUSDWhitelisted,
          lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
        };

        updateLiquidityPoolAggregator(
          liquidityPoolDiff,
          liquidityPoolAggregator,
          liquidityPoolDiff.lastUpdatedTimestamp,
          context,
          event.block.number,
        );
        return;
      }
      case "TokenNotFoundError":
        context.log.error(loaderReturn.message);
        return;
      case "LiquidityPoolAggregatorNotFoundError":
        context.log.error(loaderReturn.message);
        return;

      default: {
        const _exhaustiveCheck: never = loaderReturn;
        return _exhaustiveCheck;
      }
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
