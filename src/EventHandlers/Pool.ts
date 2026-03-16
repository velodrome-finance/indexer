import { Pool } from "generated";

import {
  loadPoolData,
  updateLiquidityPoolAggregator,
} from "../Aggregators/LiquidityPoolAggregator";
import { createOUSDTSwapEntity } from "../Aggregators/OUSDTSwaps";
import { OUSDT_ADDRESS } from "../Constants";
import { processPoolLiquidityEvent } from "./Pool/PoolBurnAndMintLogic";
import { processPoolClaim } from "./Pool/PoolClaimLogic";
import { processPoolFees } from "./Pool/PoolFeesLogic";
import { processPoolSwap } from "./Pool/PoolSwapLogic";
import { processPoolSync } from "./Pool/PoolSyncLogic";
import { processPoolTransfer } from "./Pool/PoolTransferLogic";

Pool.Mint.handler(async ({ event, context }) => {
  const poolAddress = event.srcAddress;
  const chainId = event.chainId;
  const timestamp = new Date(event.block.timestamp * 1000);

  // Load pool data
  const poolData = await loadPoolData(
    poolAddress,
    chainId,
    context,
    event.block.number,
    event.block.timestamp,
  );

  if (!poolData) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  // Process mint event using shared logic
  await processPoolLiquidityEvent(
    event,
    liquidityPoolAggregator,
    poolAddress,
    chainId,
    token0Instance,
    token1Instance,
    context,
    timestamp,
    event.block.number,
    true, // isMint
  );
});

Pool.Burn.handler(async ({ event, context }) => {
  const poolAddress = event.srcAddress;
  const chainId = event.chainId;
  const timestamp = new Date(event.block.timestamp * 1000);

  // Load pool data
  const poolData = await loadPoolData(
    poolAddress,
    chainId,
    context,
    event.block.number,
    event.block.timestamp,
  );

  if (!poolData) {
    return;
  }

  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;

  // Process burn event using shared logic
  await processPoolLiquidityEvent(
    event,
    liquidityPoolAggregator,
    poolAddress,
    chainId,
    token0Instance,
    token1Instance,
    context,
    timestamp,
    event.block.number,
    false, // isMint
  );
});

Pool.Fees.handler(async ({ event, context }) => {
  const timestamp = new Date(event.block.timestamp * 1000);

  // Load pool data
  // Pass block number and timestamp to refresh token prices
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

  // Process fees event
  const result = processPoolFees(event, token0Instance, token1Instance);

  const { liquidityPoolDiff } = result;

  // Update pool entity
  if (liquidityPoolDiff) {
    await updateLiquidityPoolAggregator(
      liquidityPoolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.chainId,
      event.block.number,
    );
  }
});

Pool.Swap.handler(async ({ event, context }) => {
  const timestamp = new Date(event.block.timestamp * 1000);

  // Load pool data
  // Pass block number and timestamp to refresh token prices
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

  // Process swap event
  const result = processPoolSwap(event, token0Instance, token1Instance);

  const { liquidityPoolDiff } = result;

  // Update pool entity
  await updateLiquidityPoolAggregator(
    liquidityPoolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    event.chainId,
    event.block.number,
  );

  // Create OUSDTSwaps entity only if oUSDT is involved
  if (
    token0Instance.address === OUSDT_ADDRESS ||
    token1Instance.address === OUSDT_ADDRESS
  ) {
    createOUSDTSwapEntity(
      event.transaction.hash,
      event.chainId,
      token0Instance,
      token1Instance,
      event.params.amount0In,
      event.params.amount0Out,
      event.params.amount1In,
      event.params.amount1Out,
      context,
    );
  }
});

/**
 * Sync event handler.
 * @notice This event is triggered by Uniswap V2 factory when a new LP position is created, and updates the reserves for the pool.
 */
Pool.Sync.handler(async ({ event, context }) => {
  // Load pool data and handle errors
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

  const { liquidityPoolDiff } = processPoolSync(
    event,
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
  );

  // Apply liquidity pool updates
  if (liquidityPoolDiff) {
    await updateLiquidityPoolAggregator(
      liquidityPoolDiff,
      liquidityPoolAggregator,
      liquidityPoolDiff.lastUpdatedTimestamp as Date,
      context,
      event.chainId,
      event.block.number,
    );
  }
});

Pool.Transfer.handler(async ({ event, context }) => {
  const poolAddress = event.srcAddress;
  const chainId = event.chainId;
  const timestamp = new Date(event.block.timestamp * 1000);

  // Load pool data
  const poolData = await loadPoolData(
    poolAddress,
    chainId,
    context,
    event.block.number,
    event.block.timestamp,
  );

  if (!poolData) {
    return;
  }

  const { liquidityPoolAggregator } = poolData;

  // Process transfer event using shared logic
  await processPoolTransfer(
    event,
    liquidityPoolAggregator,
    poolAddress,
    chainId,
    context,
    timestamp,
  );
});

Pool.Claim.handler(async ({ event, context }) => {
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

  const result = processPoolClaim(
    event,
    event.params.sender,
    liquidityPoolAggregator.gaugeAddress ?? "",
    token0Instance,
    token1Instance,
  );

  const timestamp = result.poolDiff.lastUpdatedTimestamp as Date;

  await updateLiquidityPoolAggregator(
    result.poolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    event.chainId,
    event.block.number,
  );
});
