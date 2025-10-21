import { Pool } from "generated";

import {
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../Aggregators/LiquidityPoolAggregator";
import {
  loadUserData,
  updateUserStatsPerPool,
} from "../Aggregators/UserStatsPerPool";
import { toChecksumAddress } from "../Constants";
import { processPoolLiquidityEvent } from "./Pool/PoolBurnAndMintLogic";
import { processPoolFees } from "./Pool/PoolFeesLogic";
import { processPoolSwap } from "./Pool/PoolSwapLogic";
import { processPoolSync } from "./Pool/PoolSyncLogic";

Pool.Mint.handler(async ({ event, context }) => {
  // Convert addresses to checksum format once
  const senderChecksummedAddress = toChecksumAddress(event.params.sender);
  const srcAddressChecksummed = toChecksumAddress(event.srcAddress);

  // Load pool data and handle errors
  const poolData = await loadPoolData(
    srcAddressChecksummed,
    event.chainId,
    context,
  );

  if (!poolData) {
    return;
  }

  // Load user data with event timestamp for actual processing
  const userData = await loadUserData(
    senderChecksummedAddress,
    srcAddressChecksummed,
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
    await updateUserStatsPerPool(
      userLiquidityDiff,
      userData,
      userLiquidityDiff.lastActivityTimestamp,
      context,
    );
  }
});

Pool.Burn.handler(async ({ event, context }) => {
  // Convert addresses to checksum format once
  const senderChecksummedAddress = toChecksumAddress(event.params.sender);
  const srcAddressChecksummed = toChecksumAddress(event.srcAddress);

  // Load pool data and handle errors
  const poolData = await loadPoolData(
    srcAddressChecksummed,
    event.chainId,
    context,
  );
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    senderChecksummedAddress,
    srcAddressChecksummed,
    event.chainId,
    context,
    new Date(event.block.timestamp * 1000),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  const { liquidityPoolDiff, userLiquidityDiff } =
    await processPoolLiquidityEvent(
      event,
      liquidityPoolAggregator,
      token0Instance,
      token1Instance,
      event.params.amount0,
      event.params.amount1,
      context,
    );

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
    await updateUserStatsPerPool(
      userLiquidityDiff,
      userData,
      userLiquidityDiff.lastActivityTimestamp,
      context,
    );
  }
});

Pool.Fees.handler(async ({ event, context }) => {
  // Convert addresses to checksum format once
  const senderChecksummedAddress = toChecksumAddress(event.params.sender);
  const srcAddressChecksummed = toChecksumAddress(event.srcAddress);

  // Load pool data and handle errors
  const poolData = await loadPoolData(
    srcAddressChecksummed,
    event.chainId,
    context,
  );
  if (!poolData) {
    return;
  }

  // Load user data
  const userData = await loadUserData(
    senderChecksummedAddress,
    srcAddressChecksummed,
    event.chainId,
    context,
    new Date(event.block.timestamp * 1000),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  const { liquidityPoolDiff, userDiff } = await processPoolFees(
    event,
    token0Instance,
    token1Instance,
    context,
  );

  if (liquidityPoolDiff) {
    updateLiquidityPoolAggregator(
      liquidityPoolDiff,
      liquidityPoolAggregator,
      liquidityPoolDiff.lastUpdatedTimestamp as Date,
      context,
      event.block.number,
    );
  }

  if (userDiff) {
    await updateUserStatsPerPool(
      userDiff,
      userData,
      userDiff.lastActivityTimestamp,
      context,
    );
  }
});

Pool.Swap.handler(async ({ event, context }) => {
  // Convert addresses to checksum format once
  const senderChecksummedAddress = toChecksumAddress(event.params.sender);
  const srcAddressChecksummed = toChecksumAddress(event.srcAddress);

  // Load pool data and handle errors
  const poolData = await loadPoolData(
    srcAddressChecksummed,
    event.chainId,
    context,
  );
  if (!poolData) {
    return;
  }

  // Load user data with event timestamp for actual processing
  const userData = await loadUserData(
    senderChecksummedAddress,
    srcAddressChecksummed,
    event.chainId,
    context,
    new Date(event.block.timestamp * 1000),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  const { liquidityPoolDiff, userSwapDiff } = await processPoolSwap(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
    context,
  );

  if (liquidityPoolDiff) {
    updateLiquidityPoolAggregator(
      liquidityPoolDiff,
      liquidityPoolAggregator,
      liquidityPoolDiff.lastUpdatedTimestamp as Date,
      context,
      event.block.number,
    );
  }

  if (userSwapDiff) {
    await updateUserStatsPerPool(
      userSwapDiff,
      userData,
      userSwapDiff.lastActivityTimestamp,
      context,
    );
  }
});

/**
 * Sync event handler.
 * @notice This event is triggered by Uniswap V2 factory when a new LP position is created, and updates the reserves for the pool.
 */
Pool.Sync.handler(async ({ event, context }) => {
  // Convert addresses to checksum format once
  const srcAddressChecksummed = toChecksumAddress(event.srcAddress);

  // Load pool data and handle errors
  const poolData = await loadPoolData(
    srcAddressChecksummed,
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

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  const { liquidityPoolDiff } = await processPoolSync(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
    context,
  );

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
});
