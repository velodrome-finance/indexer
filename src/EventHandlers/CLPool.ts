import { CLPool } from "generated";
import {
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../Aggregators/LiquidityPoolAggregator";
import { createOUSDTSwapEntity } from "../Aggregators/OUSDTSwaps";
import {
  loadUserData,
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
    loadPoolData(event.srcAddress, event.chainId, context),
    loadUserData(
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
  const result = await processCLPoolBurn(
    event,
    token0Instance,
    token1Instance,
    context,
  );

  // Apply liquidity pool updates
  await updateLiquidityPoolAggregator(
    result.liquidityPoolDiff,
    liquidityPoolAggregator,
    result.liquidityPoolDiff.lastUpdatedTimestamp,
    context,
    event.block.number,
  );

  // Update user pool liquidity activity
  const updatedUserStatsfields = {
    currentLiquidityUSD: result.userLiquidityDiff.netLiquidityAddedUSD,
  };

  await updateUserStatsPerPool(
    updatedUserStatsfields,
    userData,
    result.userLiquidityDiff.timestamp,
    context,
  );
});

CLPool.Collect.handler(async ({ event, context }) => {
  // Load pool data and user data concurrently for better performance
  const [poolData, userData] = await Promise.all([
    loadPoolData(event.srcAddress, event.chainId, context),
    loadUserData(
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

  // Process the collect event
  const result = await processCLPoolCollect(
    event,
    token0Instance,
    token1Instance,
    context,
  );

  // Apply liquidity pool updates
  await updateLiquidityPoolAggregator(
    result.liquidityPoolDiff,
    liquidityPoolAggregator,
    result.liquidityPoolDiff.lastUpdatedTimestamp,
    context,
    event.block.number,
  );

  // Update user pool fee contribution
  const updatedUserStatsfields = {
    totalFeesContributed0: result.userLiquidityDiff.totalFeesContributed0,
    totalFeesContributed1: result.userLiquidityDiff.totalFeesContributed1,
    totalFeesContributedUSD: result.userLiquidityDiff.totalFeesContributedUSD,
  };

  await updateUserStatsPerPool(
    updatedUserStatsfields,
    userData,
    result.userLiquidityDiff.timestamp,
    context,
  );
});

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
    loadUserData(
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

  // Apply liquidity pool updates
  await updateLiquidityPoolAggregator(
    result.liquidityPoolDiff,
    liquidityPoolAggregator,
    result.liquidityPoolDiff.lastUpdatedTimestamp,
    context,
    event.block.number,
  );

  // Update user pool fee contribution
  const updatedUserStatsfields = {
    totalFeesContributedUSD: result.liquidityPoolDiff.totalFeesUSD,
    totalFeesContributed0: result.liquidityPoolDiff.totalFees0,
    totalFeesContributed1: result.liquidityPoolDiff.totalFees1,
  };

  await updateUserStatsPerPool(
    updatedUserStatsfields,
    userData,
    new Date(event.block.timestamp * 1000),
    context,
  );
});

CLPool.Flash.handler(async ({ event, context }) => {
  // Load pool data and user data concurrently for better performance
  const [poolData, userData] = await Promise.all([
    loadPoolData(event.srcAddress, event.chainId, context),
    loadUserData(
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
  const result = await processCLPoolFlash(
    event,
    token0Instance,
    token1Instance,
    context,
  );

  // Apply liquidity pool updates
  await updateLiquidityPoolAggregator(
    result.liquidityPoolDiff,
    liquidityPoolAggregator,
    result.liquidityPoolDiff.lastUpdatedTimestamp,
    context,
    event.block.number,
  );

  // Update user pool flash loan activity
  if (result.userFlashLoanDiff.totalFlashLoanVolumeUSD > 0n) {
    const updatedUserStatsfields = {
      numberOfFlashLoans: result.userFlashLoanDiff.numberOfFlashLoans,
      totalFlashLoanVolumeUSD: result.userFlashLoanDiff.totalFlashLoanVolumeUSD,
    };

    await updateUserStatsPerPool(
      updatedUserStatsfields,
      userData,
      result.userFlashLoanDiff.timestamp,
      context,
    );
  }
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
    loadPoolData(event.srcAddress, event.chainId, context),
    loadUserData(
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
  const result = await processCLPoolMint(
    event,
    token0Instance,
    token1Instance,
    context,
  );

  // Apply liquidity pool updates
  await updateLiquidityPoolAggregator(
    result.liquidityPoolDiff,
    liquidityPoolAggregator,
    result.liquidityPoolDiff.lastUpdatedTimestamp,
    context,
    event.block.number,
  );

  // Update user pool liquidity activity
  const updatedUserStatsfields = {
    currentLiquidityUSD: result.userLiquidityDiff.netLiquidityAddedUSD,
  };

  await updateUserStatsPerPool(
    updatedUserStatsfields,
    userData,
    result.userLiquidityDiff.timestamp,
    context,
  );

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
    amountUSD: result.userLiquidityDiff.netLiquidityAddedUSD,
    mintTransactionHash: event.transaction.hash,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
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
    loadPoolData(event.srcAddress, event.chainId, context),
    loadUserData(
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

  // Apply liquidity pool updates
  await updateLiquidityPoolAggregator(
    result.liquidityPoolDiff,
    liquidityPoolAggregator,
    new Date(event.block.timestamp * 1000),
    context,
    event.block.number,
  );

  // Update user swap activity
  const updatedUserStatsfields = {
    numberOfSwaps: result.userSwapDiff.numberOfSwaps,
    totalSwapVolumeUSD: result.userSwapDiff.totalSwapVolumeUSD,
  };

  await updateUserStatsPerPool(
    updatedUserStatsfields,
    userData,
    result.userSwapDiff.timestamp,
    context,
  );

  // Create oUSDTSwaps entity

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
