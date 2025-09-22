import { CLPool } from "generated";
import type {
  CLPool_Burn,
  CLPool_Collect,
  CLPool_CollectFees,
  CLPool_CollectFees_event,
  CLPool_Collect_event,
  CLPool_Flash,
  CLPool_IncreaseObservationCardinalityNext,
  CLPool_Initialize,
  CLPool_Mint,
  CLPool_Mint_event,
  CLPool_SetFeeProtocol,
  CLPool_Swap,
  CLPool_Swap_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { updateLiquidityPoolAggregator } from "../Aggregators/LiquidityPoolAggregator";
import { normalizeTokenAmountTo1e18 } from "../Helpers";
import { multiplyBase1e18 } from "../Maths";
import { fetchPoolLoaderData } from "../Pools/common";
import { processCLPoolCollect } from "./CLPool/CLPoolCollectLogic";
import { processCLPoolMint } from "./CLPool/CLPoolMintLogic";
import { processCLPoolSwap } from "./CLPool/CLPoolSwapLogic";
import { updateCLPoolLiquidity } from "./CLPool/updateCLPoolLiquidity";

/**
 * Updates the fee-related metrics for a Concentrated Liquidity Pool.
 *
 * This function calculates the total fees collected in both tokens and USD value.
 * The USD values are computed by:
 * 1. Normalizing token amounts to 18 decimals
 * 2. Multiplying by the token's USD price
 *
 * @param liquidityPoolAggregator - The current state of the liquidity pool
 * @param event - The event containing fee collection data (amount0, amount1)
 * @param token0Instance - Token instance for token0, containing decimals and price data
 * @param token1Instance - Token instance for token1, containing decimals and price data
 *
 * @returns {Object} Updated fee metrics
 * @returns {bigint} .totalFees0 - Cumulative fees collected in token0
 * @returns {bigint} .totalFees1 - Cumulative fees collected in token1
 * @returns {bigint} .totalFeesUSD - Cumulative fees collected in USD
 */
function updateCLPoolFees(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  event: CLPool_Swap_event | CLPool_CollectFees_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
) {
  const tokenUpdateData = {
    totalFees0: liquidityPoolAggregator.totalFees0,
    totalFees1: liquidityPoolAggregator.totalFees1,
    totalFeesUSD: liquidityPoolAggregator.totalFeesUSD,
    totalFeesUSDWhitelisted: liquidityPoolAggregator.totalFeesUSDWhitelisted,
  };

  tokenUpdateData.totalFees0 += event.params.amount0;
  tokenUpdateData.totalFees1 += event.params.amount1;

  if (token0Instance) {
    const normalizedFees0 = normalizeTokenAmountTo1e18(
      event.params.amount0,
      Number(token0Instance.decimals),
    );

    const token0fees = multiplyBase1e18(
      normalizedFees0,
      token0Instance.pricePerUSDNew,
    );
    tokenUpdateData.totalFeesUSD += token0fees;
    tokenUpdateData.totalFeesUSDWhitelisted += token0Instance.isWhitelisted
      ? token0fees
      : 0n;
  }

  if (token1Instance) {
    const normalizedFees1 = normalizeTokenAmountTo1e18(
      event.params.amount1,
      Number(token1Instance.decimals),
    );
    const token1fees = multiplyBase1e18(
      normalizedFees1,
      token1Instance.pricePerUSDNew,
    );
    tokenUpdateData.totalFeesUSD += token1fees;
    tokenUpdateData.totalFeesUSDWhitelisted += token1Instance.isWhitelisted
      ? token1fees
      : 0n;
  }

  return tokenUpdateData;
}

/**
 * Updates the liquidity-related metrics for a Concentrated Liquidity Pool.
 *
 * This function calculates both addition and subtraction of liquidity to handle
 * various pool operations (mint, burn, collect). For each token:
 * 1. Normalizes reserve amounts to 18 decimals
 * 2. Calculates USD value using token prices
 * 3. Computes both addition and subtraction scenarios
 *
 * @param liquidityPoolAggregator - The current state of the liquidity pool
 * @param event - The event containing liquidity change data (amount0, amount1)
 * @param token0Instance - Token instance for token0, containing decimals and price data
 * @param token1Instance - Token instance for token1, containing decimals and price data
 *
 * @returns {Object} Updated liquidity metrics
 */

CLPool.Burn.handlerWithLoader({
  loader: async ({ event, context }) => {
    return null;
  },
  handler: async ({ event, context, loaderReturn }) => {
    const entity: CLPool_Burn = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      owner: event.params.owner,
      tickLower: event.params.tickLower,
      tickUpper: event.params.tickUpper,
      amount: event.params.amount,
      amount0: event.params.amount0,
      amount1: event.params.amount1,
      sourceAddress: event.srcAddress,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
      transactionHash: event.transaction.hash,
    };

    context.CLPool_Burn.set(entity);
  },
});

CLPool.Collect.handlerWithLoader({
  loader: async ({ event, context }) => {
    return fetchPoolLoaderData(event.srcAddress, context, event.chainId);
  },
  handler: async ({ event, context, loaderReturn }) => {
    // Process the collect event
    const result = processCLPoolCollect(event, loaderReturn);

    // Apply the result to the database
    context.CLPool_Collect.set(result.CLPoolCollectEntity);

    // Handle errors
    if (result.error) {
      context.log.error(result.error);
      return;
    }

    // Apply liquidity pool updates
    if (result.liquidityPoolDiff) {
      // We need to get the original liquidityPoolAggregator from loaderReturn
      if (loaderReturn._type === "success") {
        const { liquidityPoolAggregator } = loaderReturn;

        updateLiquidityPoolAggregator(
          result.liquidityPoolDiff,
          liquidityPoolAggregator,
          result.liquidityPoolDiff.lastUpdatedTimestamp,
          context,
          event.block.number,
        );
      }
    }
  },
});

CLPool.CollectFees.handlerWithLoader({
  loader: async ({ event, context }) => {
    return fetchPoolLoaderData(event.srcAddress, context, event.chainId);
  },
  handler: async ({ event, context, loaderReturn }) => {
    const entity: CLPool_CollectFees = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      recipient: event.params.recipient,
      amount0: event.params.amount0,
      amount1: event.params.amount1,
      sourceAddress: event.srcAddress,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
      transactionHash: event.transaction.hash,
    };

    context.CLPool_CollectFees.set(entity);

    switch (loaderReturn._type) {
      case "success": {
        const { liquidityPoolAggregator, token0Instance, token1Instance } =
          loaderReturn;

        const tokenUpdateData = updateCLPoolLiquidity(
          liquidityPoolAggregator,
          event,
          token0Instance,
          token1Instance,
        );

        const tokenUpdateFeesData = updateCLPoolFees(
          liquidityPoolAggregator,
          event,
          token0Instance,
          token1Instance,
        );

        let liquidityPoolDiff = {
          reserve0: liquidityPoolAggregator.reserve0 - tokenUpdateData.reserve0,
          reserve1: liquidityPoolAggregator.reserve1 - tokenUpdateData.reserve1,
          totalLiquidityUSD: tokenUpdateData.subTotalLiquidityUSD,
          lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
        };

        liquidityPoolDiff = {
          ...liquidityPoolDiff,
          ...tokenUpdateFeesData,
        };

        updateLiquidityPoolAggregator(
          liquidityPoolDiff,
          liquidityPoolAggregator,
          new Date(event.block.timestamp * 1000),
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

CLPool.Flash.handler(async ({ event, context }) => {
  const entity: CLPool_Flash = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sender: event.params.sender,
    recipient: event.params.recipient,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    paid0: event.params.paid0,
    paid1: event.params.paid1,
    sourceAddress: event.srcAddress,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
  };

  context.CLPool_Flash.set(entity);
});

CLPool.IncreaseObservationCardinalityNext.handler(
  async ({ event, context }) => {
    const entity: CLPool_IncreaseObservationCardinalityNext = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      observationCardinalityNextOld: event.params.observationCardinalityNextOld,
      observationCardinalityNextNew: event.params.observationCardinalityNextNew,
      sourceAddress: event.srcAddress,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
      transactionHash: event.transaction.hash,
    };

    context.CLPool_IncreaseObservationCardinalityNext.set(entity);
  },
);

CLPool.Initialize.handler(async ({ event, context }) => {
  const entity: CLPool_Initialize = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sqrtPriceX96: event.params.sqrtPriceX96,
    tick: event.params.tick,
    sourceAddress: event.srcAddress,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
  };

  context.CLPool_Initialize.set(entity);
});

CLPool.Mint.handlerWithLoader({
  loader: async ({ event, context }) => {
    return fetchPoolLoaderData(event.srcAddress, context, event.chainId);
  },
  handler: async ({ event, context, loaderReturn }) => {
    // Process the mint event
    const result = processCLPoolMint(event, loaderReturn);

    // Apply the result to the database
    context.CLPool_Mint.set(result.CLPoolMintEntity);

    // Handle errors
    if (result.error) {
      context.log.error(result.error);
      return;
    }

    // Apply liquidity pool updates
    if (result.liquidityPoolDiff) {
      // We need to get the original liquidityPoolAggregator from loaderReturn
      if (loaderReturn._type === "success") {
        const { liquidityPoolAggregator } = loaderReturn;

        updateLiquidityPoolAggregator(
          result.liquidityPoolDiff,
          liquidityPoolAggregator,
          result.liquidityPoolDiff.lastUpdatedTimestamp,
          context,
          event.block.number,
        );
      }
    }
  },
});

CLPool.SetFeeProtocol.handler(async ({ event, context }) => {
  const entity: CLPool_SetFeeProtocol = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    feeProtocol0Old: event.params.feeProtocol0Old,
    feeProtocol1Old: event.params.feeProtocol1Old,
    feeProtocol0New: event.params.feeProtocol0New,
    feeProtocol1New: event.params.feeProtocol1New,
    sourceAddress: event.srcAddress,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
  };

  context.CLPool_SetFeeProtocol.set(entity);
});

CLPool.Swap.handlerWithLoader({
  loader: async ({ event, context }) => {
    return fetchPoolLoaderData(event.srcAddress, context, event.chainId);
  },
  handler: async ({ event, context, loaderReturn }) => {
    // Process the swap event
    const result = await processCLPoolSwap(event, loaderReturn, context);

    // Apply the result to the database
    context.CLPool_Swap.set(result.CLPoolSwapEntity);

    // Handle errors
    if (result.error) {
      context.log.error(result.error);
      return;
    }

    // Apply liquidity pool updates
    if (result.liquidityPoolDiff && result.liquidityPoolAggregator) {
      updateLiquidityPoolAggregator(
        result.liquidityPoolDiff,
        result.liquidityPoolAggregator,
        new Date(event.block.timestamp * 1000),
        context,
        event.block.number,
      );
    }
  },
});
