import { CLPool } from "generated";
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
  // Load pool data and user data concurrently for better performance
  const [poolData, userData] = await Promise.all([
    loadPoolData(
      event.srcAddress,
      event.chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadOrCreateUserData(
      event.params.owner,
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

  // Process the burn event
  const result = processCLPoolBurn(event, token0Instance, token1Instance);

  const poolDiff = result.liquidityPoolDiff;
  const userDiff = result.userLiquidityDiff;

  const timestamp = new Date(event.block.timestamp * 1000);

  // Update pool and user entities
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.block.number,
    ),
    updateUserStatsPerPool(userDiff, userData, context),
  ]);
});

/**
 * Handles Collect events for LPs that did NOT stake their LP tokens in the pool's gauge.
 * These LPs collect their fees directly from their positions without going through the gauge system.
 * These events do not impact the pool's reserves in the perspective of actual liquidity available for swaps.
 */
CLPool.Collect.handler(async ({ event, context }) => {
  const [poolData, userData] = await Promise.all([
    loadPoolData(
      event.srcAddress,
      event.chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadOrCreateUserData(
      event.params.owner, // Fees should be attributed to the owner, not the recipient
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

  // Process the collect event
  const result = processCLPoolCollect(event, token0Instance, token1Instance);

  const poolDiff = result.liquidityPoolDiff;
  const userDiff = result.userLiquidityDiff;

  const timestamp = new Date(event.block.timestamp * 1000);

  // Update pool and user entities
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.block.number,
    ),
    updateUserStatsPerPool(userDiff, userData, context),
  ]);
});

/**
 * Handles CollectFees events for LPs that staked their LP tokens in the pool's gauge.
 * These fees are collected from the gauge system, not directly from positions.
 * These events do not impact the pool's reserves in the perspective of actual liquidity available for swaps.
 */
CLPool.CollectFees.handler(async ({ event, context }) => {
  // Load pool data and user data concurrently for better performance
  // Token prices will be refreshed automatically if needed
  const [poolData, userData] = await Promise.all([
    loadPoolData(
      event.srcAddress,
      event.chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadOrCreateUserData(
      event.params.recipient,
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

  // Process the collect fees event
  const result = processCLPoolCollectFees(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
  );

  const poolDiff = result.liquidityPoolDiff;
  const userDiff = result.userDiff;

  const timestamp = new Date(event.block.timestamp * 1000);

  // Update pool and user entities
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.block.number,
    ),
    updateUserStatsPerPool(userDiff, userData, context),
  ]);
});

CLPool.Flash.handler(async ({ event, context }) => {
  // Load pool data and user data concurrently for better performance
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

  // Process the flash event
  const result = processCLPoolFlash(event, token0Instance, token1Instance);

  const poolDiff = result.liquidityPoolDiff;
  const userDiff = result.userFlashLoanDiff;

  const timestamp = new Date(event.block.timestamp * 1000);

  // Update pool and user entities (only update user if there's volume)
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.block.number,
    ),
    ...(userDiff.totalFlashLoanVolumeUSD > 0n
      ? [updateUserStatsPerPool(userDiff, userData, context)]
      : []),
  ]);
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
      event.block.number,
    );
  },
);

CLPool.Mint.handler(async ({ event, context }) => {
  // Load pool data and user data concurrently for better performance
  const [poolData, userData] = await Promise.all([
    loadPoolData(
      event.srcAddress,
      event.chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadOrCreateUserData(
      event.params.owner,
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

  // Process the mint event
  const result = processCLPoolMint(event, token0Instance, token1Instance);

  const poolDiff = result.liquidityPoolDiff;
  const userDiff = {
    ...result.userLiquidityDiff,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  const timestamp = new Date(event.block.timestamp * 1000);

  // Update pool and user entities
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.block.number,
    ),
    updateUserStatsPerPool(userDiff, userData, context),
  ]);

  // Create NonFungiblePosition entity
  // Use transaction hash and logIndex to make placeholder ID unique per event
  // Format: ${chainId}_${fullTxHash}_${logIndex} (without 0x prefix)
  const id = `${event.chainId}_${event.transaction.hash.slice(2)}_${event.logIndex}`;
  context.NonFungiblePosition.set({
    id: id, // permanent, never changes
    chainId: event.chainId,
    tokenId: 0n, // Placeholder marker (0n) - actual tokenId will be set by NFPM.Transfer or NFPM.IncreaseLiquidity
    owner: event.params.owner,
    pool: event.srcAddress,
    tickUpper: event.params.tickUpper,
    tickLower: event.params.tickLower,
    token0: token0Instance.address,
    token1: token1Instance.address,
    liquidity: event.params.amount, // Store liquidity value from CLPool.Mint
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    amountUSD: userDiff.currentLiquidityUSD,
    mintTransactionHash: event.transaction.hash,
    lastUpdatedTimestamp: timestamp,
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
    event.block.number,
  );
});

CLPool.Swap.handler(async ({ event, context }) => {
  // Load pool data and user data concurrently for better performance
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

  // Process the swap event
  const result = await processCLPoolSwap(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
    context,
  );

  const poolDiff = result.liquidityPoolDiff;
  const userDiff = result.userSwapDiff;

  const timestamp = new Date(event.block.timestamp * 1000);

  // Update pool and user entities
  await Promise.all([
    updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.block.number,
    ),
    updateUserStatsPerPool(userDiff, userData, context),
  ]);

  // Create OUSDTSwaps entity

  if (
    poolData.token0Instance.address === OUSDT_ADDRESS ||
    poolData.token1Instance.address === OUSDT_ADDRESS
  ) {
    // Convert CLPool int256 amounts to In/Out format
    const amount0In = event.params.amount0 > 0n ? event.params.amount0 : 0n;
    const amount0Out = event.params.amount0 < 0n ? -event.params.amount0 : 0n;
    const amount1In = event.params.amount1 > 0n ? event.params.amount1 : 0n;
    const amount1Out = event.params.amount1 < 0n ? -event.params.amount1 : 0n;

    createOUSDTSwapEntity(
      event.transaction.hash,
      event.chainId,
      poolData.token0Instance,
      poolData.token1Instance,
      amount0In,
      amount0Out,
      amount1In,
      amount1Out,
      context,
    );
  }
});
