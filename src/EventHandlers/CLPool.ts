import { CLPool } from "generated";
import {
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../Aggregators/LiquidityPoolAggregator";
import {
  loadUserData,
  updateUserStatsPerPool,
} from "../Aggregators/UserStatsPerPool";
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

// TODO: Add logic to handle NonFungiblePosition entity creation for example (when minting a new position)

CLPool.Burn.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    event.params.owner,
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

  // Process the burn event
  const result = await processCLPoolBurn(
    event,
    token0Instance,
    token1Instance,
    context,
  );

  // Apply liquidity pool updates
  updateLiquidityPoolAggregator(
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
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    event.params.recipient,
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

  // Process the collect event
  const result = await processCLPoolCollect(
    event,
    token0Instance,
    token1Instance,
    context,
  );

  // Apply liquidity pool updates
  updateLiquidityPoolAggregator(
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
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    event.params.recipient,
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

  // Process the collect fees event
  const result = processCLPoolCollectFees(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
  );

  // Apply liquidity pool updates
  updateLiquidityPoolAggregator(
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

  // Process the flash event
  const result = await processCLPoolFlash(
    event,
    token0Instance,
    token1Instance,
    context,
  );

  // Apply liquidity pool updates
  updateLiquidityPoolAggregator(
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

    // Early return during preload phase after loading data
    if (context.isPreload) {
      return;
    }

    const { liquidityPoolAggregator } = poolData;

    // Update pool aggregator with new observation cardinality
    const cardinalityDiff = {
      observationCardinalityNext: event.params.observationCardinalityNextNew,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };

    updateLiquidityPoolAggregator(
      cardinalityDiff,
      liquidityPoolAggregator,
      new Date(event.block.timestamp * 1000),
      context,
      event.block.number,
    );
  },
);

CLPool.Mint.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    event.params.owner,
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

  // Process the mint event
  const result = await processCLPoolMint(
    event,
    token0Instance,
    token1Instance,
    context,
  );

  // Apply liquidity pool updates
  updateLiquidityPoolAggregator(
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

CLPool.SetFeeProtocol.handler(async ({ event, context }) => {
  // Load pool data and handle errors
  const poolData = await loadPoolData(event.srcAddress, event.chainId, context);
  if (!poolData) {
    return;
  }

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  // Update pool aggregator with new fee protocol settings
  const feeProtocolDiff = {
    feeProtocol0: event.params.feeProtocol0New,
    feeProtocol1: event.params.feeProtocol1New,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  updateLiquidityPoolAggregator(
    feeProtocolDiff,
    liquidityPoolAggregator,
    new Date(event.block.timestamp * 1000),
    context,
    event.block.number,
  );
});

CLPool.Swap.handler(async ({ event, context }) => {
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

  // Process the swap event
  const result = await processCLPoolSwap(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
    context,
  );

  // Apply liquidity pool updates
  updateLiquidityPoolAggregator(
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
});
