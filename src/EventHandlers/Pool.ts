import { type EvmEvent, indexer } from "envio";

import { createOUSDTSwapEntity } from "../Aggregators/OUSDTSwaps";
import { loadPoolData, updatePool } from "../Aggregators/Pool";
import {
  loadOrCreateUserData,
  preloadUserStatsPerPoolUpdate,
  updateUserStatsPerPool,
} from "../Aggregators/UserStatsPerPool";
import { OUSDT_ADDRESS, V2SwapFeesInTxId } from "../Constants";
import type { handlerContext } from "../EntityTypes";
import {
  processPoolLiquidityEvent,
  processPoolMintWithRecipient,
} from "./Pool/PoolBurnAndMintLogic";
import { processPoolClaim } from "./Pool/PoolClaimLogic";
import { processPoolFees } from "./Pool/PoolFeesLogic";
import { processPoolSwap } from "./Pool/PoolSwapLogic";
import { processPoolSync } from "./Pool/PoolSyncLogic";
import { processPoolTransfer } from "./Pool/PoolTransferLogic";
import { resolveSwapInitiator } from "./SwapInitiatorSharedLogic";

indexer.onEvent(
  { contract: "Pool", event: "Mint" },
  async ({ event, context }) => {
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

    // Process mint event using shared logic
    await processPoolLiquidityEvent(
      event,
      poolData,
      poolAddress,
      chainId,
      context,
      timestamp,
      event.block.number,
      true, // isMint
    );
  },
);

// Superchain-leaf V2 pools emit a 4-arg Mint(sender, to, amount0, amount1)
// instead of the canonical 3-arg form, so Pool.Mint never fired on those chains
// and per-LP added* counters stayed 0 (#886). The recipient is in the event, so
// this path skips Transfer matching and attributes directly to `to`.
indexer.onEvent(
  { contract: "Pool", event: "MintWithRecipient" },
  async ({ event, context }) => {
    const poolAddress = event.srcAddress;
    const chainId = event.chainId;
    const timestamp = new Date(event.block.timestamp * 1000);

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

    await processPoolMintWithRecipient(
      event,
      poolData,
      poolAddress,
      chainId,
      context,
      timestamp,
      event.block.number,
    );
  },
);

indexer.onEvent(
  { contract: "Pool", event: "Burn" },
  async ({ event, context }) => {
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

    // Process burn event using shared logic
    await processPoolLiquidityEvent(
      event,
      poolData,
      poolAddress,
      chainId,
      context,
      timestamp,
      event.block.number,
      false, // isMint
    );
  },
);

indexer.onEvent(
  { contract: "Pool", event: "Fees" },
  async ({ event, context }) => {
    const timestamp = new Date(event.block.timestamp * 1000);

    // Load pool data and user data concurrently for better performance
    // Pass block number and timestamp to refresh token prices
    const [poolData, userData] = await Promise.all([
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
    ]);

    if (!poolData) {
      return;
    }

    // Hand the swap's fee to its Swap event (emitted after this one in the
    // same tx), which values it with both legs (V2SwapFeesInTx).
    const pendingFeeId = V2SwapFeesInTxId(
      event.chainId,
      event.transaction.hash,
      event.srcAddress,
    );

    if (context.isPreload) {
      // The rest is arithmetic on rows already loaded plus the user's
      // snapshot-time reads; issue those and skip the arithmetic.
      await Promise.all([
        preloadUserStatsPerPoolUpdate(userData, timestamp, context, poolData),
        context.V2SwapFeesInTx.get(pendingFeeId),
      ]);
      return;
    }

    const pendingFee = await context.V2SwapFeesInTx.get(pendingFeeId);
    context.V2SwapFeesInTx.set({
      id: pendingFeeId,
      fee0: (pendingFee?.fee0 ?? 0n) + event.params.amount0,
      fee1: (pendingFee?.fee1 ?? 0n) + event.params.amount1,
    });

    const { liquidityPoolAggregator, token0Instance, token1Instance } =
      poolData;

    // Process fees event
    const result = processPoolFees(event, token0Instance, token1Instance);

    const { liquidityPoolDiff, userDiff } = result;

    // Update pool and user entities in parallel
    await Promise.all([
      liquidityPoolDiff
        ? updatePool(
            liquidityPoolDiff,
            liquidityPoolAggregator,
            timestamp,
            context,
            event.chainId,
            event.block.number,
          )
        : Promise.resolve(),
      userDiff
        ? updateUserStatsPerPool(
            userDiff,
            userData,
            context,
            timestamp,
            poolData,
          )
        : Promise.resolve(),
    ]);
  },
);

indexer.onEvent(
  { contract: "Pool", event: "Swap" },
  async ({ event, context }) => {
    const timestamp = new Date(event.block.timestamp * 1000);

    // Load pool data and user data concurrently for better performance
    // Pass block number and timestamp to refresh token prices
    const [poolData, userData] = await Promise.all([
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
    ]);

    if (!poolData) {
      return;
    }

    const { liquidityPoolAggregator, token0Instance, token1Instance } =
      poolData;
    const isOUSDTPool =
      token0Instance.address === OUSDT_ADDRESS ||
      token1Instance.address === OUSDT_ADDRESS;

    // The fee this swap paid, from the Fees events it emitted just before.
    const pendingFeeId = V2SwapFeesInTxId(
      event.chainId,
      event.transaction.hash,
      event.srcAddress,
    );

    if (context.isPreload) {
      // The rest is arithmetic on rows already loaded plus three reads: the
      // user's snapshot-time staked positions, the swap's pending fee and the
      // tx's oUSDT swap registry. Issue those and skip the arithmetic.
      await Promise.all([
        preloadUserStatsPerPoolUpdate(userData, timestamp, context, poolData),
        context.V2SwapFeesInTx.get(pendingFeeId),
        isOUSDTPool
          ? context.TxOUSDTSwapRegistry.get(event.transaction.hash)
          : undefined,
      ]);
      return;
    }

    // No row: the swap emitted no Fees event, i.e. it paid no fee.
    const pendingFee = await context.V2SwapFeesInTx.get(pendingFeeId);
    if (pendingFee) context.V2SwapFeesInTx.deleteUnsafe(pendingFeeId);

    // Process swap event
    const result = processPoolSwap(
      event,
      liquidityPoolAggregator,
      token0Instance,
      token1Instance,
      { fee0: pendingFee?.fee0 ?? 0n, fee1: pendingFee?.fee1 ?? 0n },
    );

    const { liquidityPoolDiff, userSwapDiff } = result;

    // Update pool and user entities in parallel
    await Promise.all([
      updatePool(
        liquidityPoolDiff,
        liquidityPoolAggregator,
        timestamp,
        context,
        event.chainId,
        event.block.number,
      ),
      updateUserStatsPerPool(
        userSwapDiff,
        userData,
        context,
        timestamp,
        poolData,
      ),
    ]);

    // Create OUSDTSwaps entity only if oUSDT is involved
    if (isOUSDTPool) {
      await createOUSDTSwapEntity(
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
  },
);

/**
 * Sync event handler.
 * @notice This event is triggered by Uniswap V2 factory when a new LP position is created, and updates the reserves for the pool.
 */
indexer.onEvent(
  { contract: "Pool", event: "Sync" },
  async ({ event, context }) => {
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

    // The rest is arithmetic on rows already loaded (updatePool only re-reads
    // this pool's tokens), so the preload pass has nothing left to batch.
    if (context.isPreload) {
      return;
    }

    const { liquidityPoolAggregator, token0Instance, token1Instance } =
      poolData;

    const { liquidityPoolDiff } = processPoolSync(
      event,
      liquidityPoolAggregator,
      token0Instance,
      token1Instance,
    );

    // Apply liquidity pool updates
    if (liquidityPoolDiff) {
      await updatePool(
        liquidityPoolDiff,
        liquidityPoolAggregator,
        liquidityPoolDiff.lastUpdatedTimestamp as Date,
        context,
        event.chainId,
        event.block.number,
      );
    }
  },
);

indexer.onEvent(
  { contract: "Pool", event: "Transfer" },
  async ({ event, context }) => {
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
  },
);

/**
 * Credits a V2 fee claim to the pool and to the account whose fees were claimed.
 *
 * @param event - Legacy Claim or Aero ClaimWithAccount
 * @param claimant - Whose fees were claimed (legacy `sender`, Aero `account`)
 * @param context - Handler context
 * @returns Promise that resolves once the pool and user updates are staged
 */
async function handlePoolClaim(
  event: EvmEvent<"Pool", "Claim"> | EvmEvent<"Pool", "ClaimWithAccount">,
  claimant: string,
  context: handlerContext,
): Promise<void> {
  const [poolData, userData] = await Promise.all([
    loadPoolData(
      event.srcAddress,
      event.chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadOrCreateUserData(
      claimant,
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

  const result = processPoolClaim(
    event,
    claimant,
    liquidityPoolAggregator.gaugeAddress ?? "",
    token0Instance,
    token1Instance,
  );

  const timestamp = result.poolDiff.lastUpdatedTimestamp as Date;

  await Promise.all([
    updatePool(
      result.poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      event.chainId,
      event.block.number,
    ),
    updateUserStatsPerPool(
      result.userDiff,
      userData,
      context,
      timestamp,
      poolData,
    ),
  ]);
}

// Aero V2 pools: Claim(caller, account, recipient, …). The fees belong to
// `account` (an operator may claim on its behalf), so credit the account.
indexer.onEvent(
  { contract: "Pool", event: "ClaimWithAccount" },
  async ({ event, context }) => {
    await handlePoolClaim(event, event.params.account, context);
  },
);

indexer.onEvent(
  { contract: "Pool", event: "Claim" },
  async ({ event, context }) => {
    await handlePoolClaim(event, event.params.sender, context);
  },
);
