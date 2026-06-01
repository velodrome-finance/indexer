import { indexer } from "envio";
import { applyPositionToEdges } from "../Aggregators/CLStakedLiquidity";
import { createOUSDTSwapEntity } from "../Aggregators/OUSDTSwaps";
import { loadPoolData, updatePool } from "../Aggregators/Pool";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../Aggregators/UserStatsPerPool";
import {
  CLPoolMintEventId,
  OUSDT_ADDRESS,
  PoolId,
  TxCLPoolMintRegistryId,
} from "../Constants";
import { processCLPoolBurn } from "./CLPool/CLPoolBurnLogic";
import { processCLPoolCollectFees } from "./CLPool/CLPoolCollectFeesLogic";
import { processCLPoolCollect } from "./CLPool/CLPoolCollectLogic";
import { attributeDirectCLLiquidityChange } from "./CLPool/CLPoolDirectLiquidityLogic";
import { processCLPoolFlash } from "./CLPool/CLPoolFlashLogic";
import { processCLPoolMint } from "./CLPool/CLPoolMintLogic";
import { processCLPoolSwap } from "./CLPool/CLPoolSwapLogic";
import { LiquidityChangeType } from "./NFPM/NFPMCommonLogic";

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

indexer.onEvent(
  { contract: "CLPool", event: "Burn" },
  async ({ event, context }) => {
    // Updates pool reserves; NFPM-routed burns are attributed to the holder via
    // NFPM.DecreaseLiquidity, while direct (non-NFPM) burns are attributed to the
    // owner below via attributeDirectCLLiquidityChange (#790).
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

    const { liquidityPoolAggregator, token0Instance, token1Instance } =
      poolData;

    const result = await processCLPoolBurn(
      event,
      liquidityPoolAggregator,
      token0Instance,
      token1Instance,
      context,
    );
    // #803: maintain the total per-tick liquidityNet map on every Burn so the swap
    // path can integrate geometry over it. Burn removes liquidity → negative delta.
    const burnEdges = applyPositionToEdges(
      liquidityPoolAggregator.tickEdges,
      liquidityPoolAggregator.tickEdgeNets,
      event.params.tickLower,
      event.params.tickUpper,
      -event.params.amount,
    );
    if (burnEdges.rejected) {
      context.log.error(
        `[TICK_EDGE_DRIFT][CLPool.Burn] rejected=${burnEdges.rejected} pool=${event.srcAddress} chain=${event.chainId} tickLower=${event.params.tickLower} tickUpper=${event.params.tickUpper}`,
      );
    }
    result.liquidityPoolDiff.tickEdges = burnEdges.edges;
    result.liquidityPoolDiff.tickEdgeNets = burnEdges.nets;
    const timestamp = new Date(event.block.timestamp * 1000);

    await updatePool(
      result.liquidityPoolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.chainId,
      event.block.number,
    );

    await attributeDirectCLLiquidityChange(
      event.params.owner,
      event.srcAddress,
      poolData,
      context,
      event.params.amount0,
      event.params.amount1,
      event.block.timestamp,
      LiquidityChangeType.REMOVE,
    );
  },
);

/**
 * Handles Collect events for LPs that did NOT stake their LP tokens in the pool's gauge.
 * These LPs collect their fees directly from their positions without going through the gauge system.
 * These events do not impact the pool's reserves in the perspective of actual liquidity available for swaps.
 */
indexer.onEvent(
  { contract: "CLPool", event: "Collect" },
  async ({ event, context }) => {
    const timestamp = new Date(event.block.timestamp * 1000);
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
        timestamp,
      ),
    ]);

    if (!poolData) {
      return;
    }

    const { liquidityPoolAggregator, token0Instance, token1Instance } =
      poolData;

    // Process the collect event — isolates fees from burned principal
    const result = await processCLPoolCollect(
      event,
      token0Instance,
      token1Instance,
      context,
    );

    const poolDiff = result.liquidityPoolDiff;
    const userDiff = result.userLiquidityDiff;

    // Update pool and user entities
    await Promise.all([
      updatePool(
        poolDiff,
        liquidityPoolAggregator,
        timestamp,
        context,
        event.chainId,
        event.block.number,
      ),
      updateUserStatsPerPool(userDiff, userData, context, timestamp, poolData),
    ]);
  },
);

/**
 * Handles CollectFees events for LPs that staked their LP tokens in the pool's gauge.
 * These fees are collected from the gauge system, not directly from positions.
 * These events do not impact the pool's reserves in the perspective of actual liquidity available for swaps.
 */
indexer.onEvent(
  { contract: "CLPool", event: "CollectFees" },
  async ({ event, context }) => {
    const timestamp = new Date(event.block.timestamp * 1000);

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
        timestamp,
      ),
    ]);

    if (!poolData) {
      return;
    }

    const { liquidityPoolAggregator, token0Instance, token1Instance } =
      poolData;

    // Process the collect fees event
    const result = processCLPoolCollectFees(
      event,
      token0Instance,
      token1Instance,
    );

    const poolDiff = result.liquidityPoolDiff;
    const userDiff = result.userDiff;

    // Update pool and user entities
    await Promise.all([
      updatePool(
        poolDiff,
        liquidityPoolAggregator,
        timestamp,
        context,
        event.chainId,
        event.block.number,
      ),
      updateUserStatsPerPool(userDiff, userData, context, timestamp, poolData),
    ]);
  },
);

indexer.onEvent(
  { contract: "CLPool", event: "Flash" },
  async ({ event, context }) => {
    const timestamp = new Date(event.block.timestamp * 1000);

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
        timestamp,
      ),
    ]);

    if (!poolData) {
      return;
    }

    const { liquidityPoolAggregator, token0Instance, token1Instance } =
      poolData;

    // Process the flash event
    const result = processCLPoolFlash(event, token0Instance, token1Instance);

    const poolDiff = result.liquidityPoolDiff;
    const userDiff = result.userFlashLoanDiff;

    // Update pool and user entities (only update user if there's volume)
    await Promise.all([
      updatePool(
        poolDiff,
        liquidityPoolAggregator,
        timestamp,
        context,
        event.chainId,
        event.block.number,
      ),
      ...((userDiff.incrementalTotalFlashLoanVolumeUSD ?? 0n) > 0n
        ? [
            updateUserStatsPerPool(
              userDiff,
              userData,
              context,
              timestamp,
              poolData,
            ),
          ]
        : []),
    ]);
  },
);

indexer.onEvent(
  { contract: "CLPool", event: "IncreaseObservationCardinalityNext" },
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

    await updatePool(
      cardinalityDiff,
      liquidityPoolAggregator,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  },
);

// Slipstream's CLFactory.createPool initializes the pool inside the same
// function call that deploys it, so CLPool.Initialize is always emitted at a
// LOWER log index than CLFactory.PoolCreated within the same tx. The
// aggregator therefore does not exist yet when Initialize runs — buffer the
// opening sqrtPriceX96/tick into CLPoolPendingInitialize so PoolCreated can
// apply it on creation and delete the entry. Closes the pre-first-swap
// dead-zone where NFPM handlers silently dropped range math for positions
// minted before any swap had occurred (see velodrome-finance/indexer#654).
indexer.onEvent(
  { contract: "CLPool", event: "Initialize" },
  async ({ event, context }) => {
    context.CLPoolPendingInitialize.set({
      id: PoolId(event.chainId, event.srcAddress),
      chainId: event.chainId,
      poolAddress: event.srcAddress,
      sqrtPriceX96: event.params.sqrtPriceX96,
      tick: event.params.tick,
    });
  },
);

indexer.onEvent(
  { contract: "CLPool", event: "Mint" },
  async ({ event, context }) => {
    // Updates pool reserves; NFPM-routed mints are attributed to the holder via
    // NFPM.Transfer (mint) and NFPM.IncreaseLiquidity, while direct (non-NFPM)
    // mints are attributed to the owner below via attributeDirectCLLiquidityChange (#790).
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

    const { liquidityPoolAggregator, token0Instance, token1Instance } =
      poolData;

    const result = processCLPoolMint(
      event,
      liquidityPoolAggregator,
      token0Instance,
      token1Instance,
    );
    // #803: maintain the total per-tick liquidityNet map on every Mint so the swap
    // path can integrate geometry over it. Mint adds liquidity → positive delta.
    const mintEdges = applyPositionToEdges(
      liquidityPoolAggregator.tickEdges,
      liquidityPoolAggregator.tickEdgeNets,
      event.params.tickLower,
      event.params.tickUpper,
      event.params.amount,
    );
    if (mintEdges.rejected) {
      context.log.error(
        `[TICK_EDGE_DRIFT][CLPool.Mint] rejected=${mintEdges.rejected} pool=${event.srcAddress} chain=${event.chainId} tickLower=${event.params.tickLower} tickUpper=${event.params.tickUpper}`,
      );
    }
    result.liquidityPoolDiff.tickEdges = mintEdges.edges;
    result.liquidityPoolDiff.tickEdgeNets = mintEdges.nets;
    const timestamp = new Date(event.block.timestamp * 1000);

    await updatePool(
      result.liquidityPoolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.chainId,
      event.block.number,
    );

    await attributeDirectCLLiquidityChange(
      event.params.owner,
      event.srcAddress,
      poolData,
      context,
      event.params.amount0,
      event.params.amount1,
      event.block.timestamp,
      LiquidityChangeType.ADD,
    );

    // Store CLPool.Mint data for NFPM.Transfer (mint) to consume and attribute UserStatsPerPool to event.params.to
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

    // Per-tx registry so NFPM.Transfer(mint) can PK-lookup the mint ids for this
    // tx instead of running a getWhere scan on CLPoolMintEvent.transactionHash.
    const registryId = TxCLPoolMintRegistryId(
      event.chainId,
      event.transaction.hash,
    );
    const existingRegistry = await context.TxCLPoolMintRegistry.get(registryId);
    context.TxCLPoolMintRegistry.set({
      id: registryId,
      mintEventIds: existingRegistry
        ? [...existingRegistry.mintEventIds, mintEventId]
        : [mintEventId],
    });
  },
);

indexer.onEvent(
  { contract: "CLPool", event: "SetFeeProtocol" },
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

    // Update pool aggregator with new fee protocol settings
    const feeProtocolDiff = {
      feeProtocol0: event.params.feeProtocol0New,
      feeProtocol1: event.params.feeProtocol1New,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    };

    await updatePool(
      feeProtocolDiff,
      liquidityPoolAggregator,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  },
);

indexer.onEvent(
  { contract: "CLPool", event: "Swap" },
  async ({ event, context }) => {
    const timestamp = new Date(event.block.timestamp * 1000);

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
        timestamp,
      ),
    ]);

    if (!poolData) {
      return;
    }

    const { liquidityPoolAggregator, token0Instance, token1Instance } =
      poolData;

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

    // Update pool and user entities
    await Promise.all([
      updatePool(
        poolDiff,
        liquidityPoolAggregator,
        timestamp,
        context,
        event.chainId,
        event.block.number,
      ),
      updateUserStatsPerPool(userDiff, userData, context, timestamp, poolData),
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
  },
);
