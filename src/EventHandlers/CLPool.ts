import { CLPool } from "generated";
import type {
  CLPool_Burn,
  CLPool_Flash,
  CLPool_IncreaseObservationCardinalityNext,
  CLPool_Initialize,
  CLPool_SetFeeProtocol,
} from "generated";
import { updateLiquidityPoolAggregator } from "../Aggregators/LiquidityPoolAggregator";
import { fetchPoolLoaderData } from "../Pools/common";
import { processCLPoolCollectFees } from "./CLPool/CLPoolCollectFeesLogic";
import { processCLPoolCollect } from "./CLPool/CLPoolCollectLogic";
import { processCLPoolMint } from "./CLPool/CLPoolMintLogic";
import { processCLPoolSwap } from "./CLPool/CLPoolSwapLogic";

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

CLPool.Burn.handler(async ({ event, context }) => {
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
});

CLPool.Collect.handler(async ({ event, context }) => {
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
    updateLiquidityPoolAggregator(
      result.liquidityPoolDiff,
      liquidityPoolAggregator,
      result.liquidityPoolDiff.lastUpdatedTimestamp,
      context,
      event.block.number,
    );
  }
});

CLPool.CollectFees.handler(async ({ event, context }) => {
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

  // Process the collect fees event
  const result = processCLPoolCollectFees(event, loaderReturn);

  // Apply the result to the database
  context.CLPool_CollectFees.set(result.CLPoolCollectFeesEntity);

  // Handle errors
  if (result.error) {
    context.log.error(result.error);
    return;
  }

  // Apply liquidity pool updates
  if (result.liquidityPoolDiff) {
    updateLiquidityPoolAggregator(
      result.liquidityPoolDiff,
      liquidityPoolAggregator,
      result.liquidityPoolDiff.lastUpdatedTimestamp,
      context,
      event.block.number,
    );
  }
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

CLPool.Mint.handler(async ({ event, context }) => {
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
    updateLiquidityPoolAggregator(
      result.liquidityPoolDiff,
      liquidityPoolAggregator,
      result.liquidityPoolDiff.lastUpdatedTimestamp,
      context,
      event.block.number,
    );
  }
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

CLPool.Swap.handler(async ({ event, context }) => {
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
});
