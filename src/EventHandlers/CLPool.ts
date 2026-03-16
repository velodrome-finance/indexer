import { CLPool } from "generated";
import {
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../Aggregators/LiquidityPoolAggregator";
import { CLPoolMintEventId } from "../Constants";
import { processCLPoolBurn } from "./CLPool/CLPoolBurnLogic";
import { processCLPoolCollectFees } from "./CLPool/CLPoolCollectFeesLogic";
import { processCLPoolCollect } from "./CLPool/CLPoolCollectLogic";
import { processCLPoolFlash } from "./CLPool/CLPoolFlashLogic";
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
  // Pool-only update; user liquidity removed is attributed from NFPM.DecreaseLiquidity
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

  const result = processCLPoolBurn(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
  );
  const timestamp = new Date(event.block.timestamp * 1000);

  await updateLiquidityPoolAggregator(
    result.liquidityPoolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    event.chainId,
    event.block.number,
  );
});

/**
 * Handles Collect events for LPs that did NOT stake their LP tokens in the pool's gauge.
 * These LPs collect their fees directly from their positions without going through the gauge system.
 * These events do not impact the pool's reserves in the perspective of actual liquidity available for swaps.
 */
CLPool.Collect.handler(async ({ event, context }) => {
  const timestamp = new Date(event.block.timestamp * 1000);
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

  // Process the collect event
  const result = processCLPoolCollect(event, token0Instance, token1Instance);

  const poolDiff = result.liquidityPoolDiff;

  // Update pool entity
  await updateLiquidityPoolAggregator(
    poolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    event.chainId,
    event.block.number,
  );
});

/**
 * Handles CollectFees events for LPs that staked their LP tokens in the pool's gauge.
 * These fees are collected from the gauge system, not directly from positions.
 * These events do not impact the pool's reserves in the perspective of actual liquidity available for swaps.
 */
CLPool.CollectFees.handler(async ({ event, context }) => {
  const timestamp = new Date(event.block.timestamp * 1000);

  // Load pool data
  // Token prices will be refreshed automatically if needed
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

  // Process the collect fees event
  const result = processCLPoolCollectFees(
    event,
    token0Instance,
    token1Instance,
  );

  const poolDiff = result.liquidityPoolDiff;

  // Update pool entity
  await updateLiquidityPoolAggregator(
    poolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    event.chainId,
    event.block.number,
  );
});

CLPool.Flash.handler(async ({ event, context }) => {
  const timestamp = new Date(event.block.timestamp * 1000);

  // Load pool data
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

  // Process the flash event
  const result = processCLPoolFlash(event, token0Instance, token1Instance);

  const poolDiff = result.liquidityPoolDiff;

  // Update pool entity
  await updateLiquidityPoolAggregator(
    poolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    event.chainId,
    event.block.number,
  );
});

CLPool.IncreaseObservationCardinalityNext.handler(
  async ({ event, context }) => {
    // Load pool data and handle errors
    const poolData = await loadPoolData(
      event.srcAddress,
      event.chainId,
      context,
    );
    if (!poolData) {
      return;
    }

    const { liquidityPoolAggregator } = poolData;

    // Update pool aggregator with new observation cardinality
    const cardinalityDiff = {
      observationCardinalityNext: event.params.observationCardinalityNextNew,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };

    await updateLiquidityPoolAggregator(
      cardinalityDiff,
      liquidityPoolAggregator,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  },
);

CLPool.Mint.handler(async ({ event, context }) => {
  // Pool-only update; user liquidity added is attributed from NFPM.Transfer (mint) and NFPM.IncreaseLiquidity
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

  const result = processCLPoolMint(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
  );
  const timestamp = new Date(event.block.timestamp * 1000);

  await updateLiquidityPoolAggregator(
    result.liquidityPoolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    event.chainId,
    event.block.number,
  );

  // Store CLPool.Mint data for NFPM.Transfer (mint) to consume
  const mintEventId = CLPoolMintEventId(
    event.chainId,
    event.srcAddress,
    event.transaction.hash,
    event.logIndex,
  );
  context.CLPoolMintEvent.set({
    id: mintEventId,
    chainId: event.chainId,
    pool: event.srcAddress,
    owner: event.params.owner,
    tickLower: event.params.tickLower,
    tickUpper: event.params.tickUpper,
    liquidity: event.params.amount,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    token0: token0Instance.address,
    token1: token1Instance.address,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    consumedByTokenId: undefined,
    createdAt: timestamp,
  });
});

CLPool.SetFeeProtocol.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  // Update pool aggregator with new fee protocol settings
  const feeProtocolDiff = {
    feeProtocol0: event.params.feeProtocol0New,
    feeProtocol1: event.params.feeProtocol1New,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  await updateLiquidityPoolAggregator(
    feeProtocolDiff,
    liquidityPoolAggregator,
    new Date(event.block.timestamp * 1000),
    context,
    event.chainId,
    event.block.number,
  );
});

CLPool.Swap.handler(async ({ event, context }) => {
  const timestamp = new Date(event.block.timestamp * 1000);

  // Load pool data
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

  // Process the swap event
  const result = await processCLPoolSwap(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
    context,
  );

  const poolDiff = result.liquidityPoolDiff;

  // Update pool entity
  await updateLiquidityPoolAggregator(
    poolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    event.chainId,
    event.block.number,
  );

});
