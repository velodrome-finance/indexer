import { indexer } from "envio";
import {
  applyPositionToEdges,
  deriveLiquidityInRange,
} from "../Aggregators/CLStakedLiquidity";
import { createOUSDTSwapEntity } from "../Aggregators/OUSDTSwaps";
import { loadPoolData, updatePool } from "../Aggregators/Pool";
import { loadPoolTickMap, setPoolTickMap } from "../Aggregators/PoolTickMap";
import {
  loadOrCreateUserData,
  preloadUserStatsPerPoolUpdate,
  updateUserStatsPerPool,
} from "../Aggregators/UserStatsPerPool";
import {
  CLPoolMintEventId,
  OUSDT_ADDRESS,
  POOL_DEPLOYMENT,
  PoolId,
  TxCLPoolMintRegistryId,
} from "../Constants";
import { shouldSnapshot } from "../Snapshots/Index";
import { processCLPoolBurn } from "./CLPool/CLPoolBurnLogic";
import { processCLPoolCollectFees } from "./CLPool/CLPoolCollectFeesLogic";
import { processCLPoolCollect } from "./CLPool/CLPoolCollectLogic";
import { attributeDirectCLLiquidityChange } from "./CLPool/CLPoolDirectLiquidityLogic";
import { processCLPoolFlash } from "./CLPool/CLPoolFlashLogic";
import { processCLPoolMint } from "./CLPool/CLPoolMintLogic";
import { processCLPoolSwap } from "./CLPool/CLPoolSwapLogic";
import { recordAeroNFPMMint } from "./NFPM/AeroNFPMLogic";
import { stageNFPMCollectFees } from "./NFPM/NFPMCollectLogic";
import { LiquidityChangeType } from "./NFPM/NFPMCommonLogic";
import { resolveSwapInitiator } from "./SwapInitiatorSharedLogic";

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
    const timestamp = new Date(event.block.timestamp * 1000);

    // A zero-amount burn is a "poke": the position owner refreshes its owed
    // fees before a collect (about two thirds of all burns). It moves no
    // liquidity and no tokens, so reserves, in-range liquidity, the tick map,
    // the burned-principal tracker (a missing tracker reads as zero) and the
    // owner's flows are all unchanged. The only things it could still update
    // are the Pool's bookkeeping: lastUpdatedTimestamp, a TVL revaluation at
    // refreshed token prices and, on the first event of a new hour, the hourly
    // PoolSnapshot. Keep the snapshot cadence (run the normal path when the
    // poke opens a new snapshot epoch) and skip the write otherwise.
    if (
      event.params.amount === 0n &&
      event.params.amount0 === 0n &&
      event.params.amount1 === 0n &&
      !shouldSnapshot(liquidityPoolAggregator.lastSnapshotTimestamp, timestamp)
    ) {
      return;
    }

    const result = await processCLPoolBurn(
      event,
      liquidityPoolAggregator,
      token0Instance,
      token1Instance,
      context,
    );
    // #803: maintain the total per-tick liquidityNet map on every Burn so the swap
    // path can integrate geometry over it. Burn removes liquidity → negative delta.
    // The map lives on PoolTickMap and is written only when it changes.
    if (event.params.amount !== 0n) {
      const tickMap = await loadPoolTickMap(
        liquidityPoolAggregator.id,
        context,
      );
      const burnEdges = applyPositionToEdges(
        tickMap.tickEdges,
        tickMap.tickEdgeNets,
        event.params.tickLower,
        event.params.tickUpper,
        -event.params.amount,
      );
      if (burnEdges.rejected) {
        context.log.error(
          `[TICK_EDGE_DRIFT][CLPool.Burn] rejected=${burnEdges.rejected} pool=${event.srcAddress} chain=${event.chainId} tickLower=${event.params.tickLower} tickUpper=${event.params.tickUpper}`,
        );
      }
      if (burnEdges.changed) {
        setPoolTickMap(
          tickMap,
          { tickEdges: burnEdges.edges, tickEdgeNets: burnEdges.nets },
          context,
        );
      }
      // Re-derive the staked in-range liquidity alongside the total one this
      // event moves. The swap path seeds its staked walk from the cached value
      // whenever 0 < staked < liquidityInRange; re-deriving here keeps a value
      // that updatePool once clamped to the old total (#891) from passing for
      // a derived one after the total grows.
      if (liquidityPoolAggregator.hasStakes) {
        result.liquidityPoolDiff.stakedLiquidityInRange =
          deriveLiquidityInRange(
            liquidityPoolAggregator.tick ?? 0n,
            tickMap.stakedTickEdges,
            tickMap.stakedTickEdgeNets,
          );
      }
    }

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

    // An NFPM position's `owner` here is the NFPM contract, which gets no
    // UserStatsPerPool row. The fees isolated here are handed to the NFPM's
    // Collect that follows in this tx (legacy NFPM or Aero NFPM), which knows
    // the tokenId and so the owner (NFPMCollectLogic.ts).
    const ownerIsNfpm =
      event.params.owner === liquidityPoolAggregator.nfpmAddress;
    const handToNfpmCollect = ownerIsNfpm;
    const creditOwner = !ownerIsNfpm;

    // Process the collect event — isolates fees from burned principal
    const [result, userData] = await Promise.all([
      processCLPoolCollect(event, token0Instance, token1Instance, context),
      creditOwner
        ? loadOrCreateUserData(
            event.params.owner, // Fees should be attributed to the owner, not the recipient
            event.srcAddress,
            event.chainId,
            context,
            timestamp,
          )
        : undefined,
    ]);

    const poolDiff = result.liquidityPoolDiff;
    const userDiff = result.userLiquidityDiff;

    if (handToNfpmCollect) {
      await stageNFPMCollectFees(
        event.chainId,
        event.transaction.hash,
        event.params.owner,
        event.srcAddress,
        userDiff.incrementalTotalUnstakedFeesCollected0 ?? 0n,
        userDiff.incrementalTotalUnstakedFeesCollected1 ?? 0n,
        userDiff.incrementalTotalUnstakedFeesCollectedUSD ?? 0n,
        context,
      );
    }

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
      ...(userData
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
    // The map lives on PoolTickMap and is written only when it changes.
    if (event.params.amount !== 0n) {
      const tickMap = await loadPoolTickMap(
        liquidityPoolAggregator.id,
        context,
      );
      const mintEdges = applyPositionToEdges(
        tickMap.tickEdges,
        tickMap.tickEdgeNets,
        event.params.tickLower,
        event.params.tickUpper,
        event.params.amount,
      );
      if (mintEdges.rejected) {
        context.log.error(
          `[TICK_EDGE_DRIFT][CLPool.Mint] rejected=${mintEdges.rejected} pool=${event.srcAddress} chain=${event.chainId} tickLower=${event.params.tickLower} tickUpper=${event.params.tickUpper}`,
        );
      }
      if (mintEdges.changed) {
        setPoolTickMap(
          tickMap,
          { tickEdges: mintEdges.edges, tickEdgeNets: mintEdges.nets },
          context,
        );
      }
      // Re-derive the staked in-range liquidity alongside the total one this
      // event moves. The swap path seeds its staked walk from the cached value
      // whenever 0 < staked < liquidityInRange; re-deriving here keeps a value
      // that updatePool once clamped to the old total (#891) from passing for
      // a derived one after the total grows.
      if (liquidityPoolAggregator.hasStakes) {
        result.liquidityPoolDiff.stakedLiquidityInRange =
          deriveLiquidityInRange(
            liquidityPoolAggregator.tick ?? 0n,
            tickMap.stakedTickEdges,
            tickMap.stakedTickEdgeNets,
          );
      }
    }
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

    // Aero pools: the Aero NFPM's IncreaseLiquidity carries the range, so only
    // the pool needs handing over, keyed by the values both events carry
    // (AeroNFPMLogic.ts). Direct (non-NFPM) mints were attributed above.
    if (liquidityPoolAggregator.deployment === POOL_DEPLOYMENT.AERO) {
      if (event.params.owner === liquidityPoolAggregator.nfpmAddress) {
        await recordAeroNFPMMint(
          event.chainId,
          event.transaction.hash,
          event.srcAddress,
          event.params.owner,
          event.params,
          event.logIndex,
          context,
        );
      }
      return;
    }

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

    // Load pool data, user data and the tick maps concurrently. The tick maps
    // are read-only here: a swap never changes them.
    const [poolData, userData, tickMap] = await Promise.all([
      loadPoolData(
        event.srcAddress,
        event.chainId,
        context,
        event.block.number,
        event.block.timestamp,
      ),
      loadOrCreateUserData(
        // #814: the tx signer, not params.sender (the router for routed swaps).
        resolveSwapInitiator(event),
        event.srcAddress,
        event.chainId,
        context,
        timestamp,
      ),
      loadPoolTickMap(PoolId(event.chainId, event.srcAddress), context),
    ]);

    if (!poolData) {
      return;
    }

    const isOUSDTPool =
      poolData.token0Instance.address === OUSDT_ADDRESS ||
      poolData.token1Instance.address === OUSDT_ADDRESS;

    if (context.isPreload) {
      // Everything below is arithmetic on rows already loaded, plus two reads:
      // the user's snapshot-time staked positions and the tx's oUSDT swap
      // registry. Issue those and skip the arithmetic (preload writes are no-ops).
      await Promise.all([
        preloadUserStatsPerPoolUpdate(userData, timestamp, context, poolData),
        isOUSDTPool
          ? context.TxOUSDTSwapRegistry.get(event.transaction.hash)
          : undefined,
      ]);
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
      tickMap,
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
    if (isOUSDTPool) {
      // Convert CLPool int256 amounts to In/Out format
      const amount0In = event.params.amount0 > 0n ? event.params.amount0 : 0n;
      const amount0Out = event.params.amount0 < 0n ? -event.params.amount0 : 0n;
      const amount1In = event.params.amount1 > 0n ? event.params.amount1 : 0n;
      const amount1Out = event.params.amount1 < 0n ? -event.params.amount1 : 0n;

      await createOUSDTSwapEntity(
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
