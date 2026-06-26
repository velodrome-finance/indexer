import type { EvmEvent, PoolTransferInTx, Token } from "envio";
import { type PoolData, updatePool } from "../../Aggregators/Pool";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import { TxPoolTransferRegistryId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import { calculateTotalUSD } from "../../Helpers";

export interface AttributionResult {
  recipient: string | undefined;
  totalLiquidityUSD: bigint;
  /** Raw token0 amount from the Mint/Burn event (#810). */
  amount0: bigint;
  /** Raw token1 amount from the Mint/Burn event (#810). */
  amount1: bigint;
}

/**
 * Fetch mint/burn transfers for a (tx, pool) via the per-(tx, pool) registry,
 * then PK-get each transfer by id. Replaces the old
 * `PoolTransferInTx.getWhere({ txHash })` index scan.
 *
 * Registry rows may contain ids whose entities were deleted by a prior
 * consumption in the same tx; those get filtered out. The chainId/pool filter
 * is retained as a safety belt even though the key already scopes by both.
 *
 * @param txHash - Transaction hash
 * @param chainId - Chain ID
 * @param poolAddress - Pool address
 * @param isMint - Whether this is a Mint event (true) or Burn event (false)
 * @param context - Handler context
 * @returns Filtered transfers for the (chainId, tx, pool) event type
 */
export async function getTransfersInTx(
  txHash: string,
  chainId: number,
  poolAddress: string,
  isMint: boolean,
  context: handlerContext,
): Promise<PoolTransferInTx[]> {
  const registryId = TxPoolTransferRegistryId(chainId, txHash, poolAddress);
  const registry = await context.TxPoolTransferRegistry.get(registryId);
  if (!registry || registry.transferIds.length === 0) {
    return [];
  }

  const transfers = (
    await Promise.all(
      registry.transferIds.map((id) =>
        getRehydrated(context.PoolTransferInTx, "PoolTransferInTx", id),
      ),
    )
  ).filter((t): t is PoolTransferInTx => t !== undefined);

  return transfers.filter(
    (t) =>
      t.chainId === chainId &&
      t.pool === poolAddress &&
      (isMint ? t.isMint === true : t.isBurn === true),
  );
}

/**
 * Remove a consumed transfer id from the per-(tx, pool) registry and delete
 * the registry row when it empties. Paired with the PoolTransferInTx
 * deletion in findTransferAndAttribute so the registry doesn't leak rows.
 *
 * @param registryId - TxPoolTransferRegistryId for the (chainId, tx, pool)
 * @param transferId - The PoolTransferInTx id that was consumed
 * @param context - Handler context
 * @returns Promise that resolves once the registry update is staged
 */
async function pruneRegistryOnConsume(
  registryId: string,
  transferId: string,
  context: handlerContext,
): Promise<void> {
  const registry = await context.TxPoolTransferRegistry.get(registryId);
  if (!registry) return;
  const remaining = registry.transferIds.filter((id) => id !== transferId);
  if (remaining.length === 0) {
    context.TxPoolTransferRegistry.deleteUnsafe(registryId);
  } else {
    context.TxPoolTransferRegistry.set({
      id: registryId,
      transferIds: remaining,
    });
  }
}

/**
 * Filter transfers to only those that precede the Mint/Burn event and are eligible for matching
 * @param transfersInTx - Transfers in the transaction
 * @param eventLogIndex - Log index of the Mint/Burn event
 * @returns Eligible preceding transfers
 */
export function getPrecedingTransfers(
  transfersInTx: PoolTransferInTx[],
  eventLogIndex: number,
): PoolTransferInTx[] {
  // Consumed transfers are deleted (see findTransferAndAttribute), so
  // presence in transfersInTx already implies "not consumed".
  return transfersInTx.filter(
    (t) => t.logIndex < eventLogIndex && t.value > 0n,
  );
}

/**
 * Find the closest preceding transfer (largest logIndex)
 * @param precedingTransfers - Eligible preceding transfers
 * @returns The closest preceding transfer
 */
export function findClosestPrecedingTransfer(
  precedingTransfers: PoolTransferInTx[],
): PoolTransferInTx {
  return precedingTransfers.reduce((prev, curr) =>
    curr.logIndex > prev.logIndex ? curr : prev,
  );
}

/**
 * Extract recipient address from matched transfer, handling address(1) edge case for mints
 * @param matchedTransfer - The matched transfer
 * @param precedingTransfers - All preceding transfers (for address(1) fallback)
 * @param isMint - Whether this is a Mint event (true) or Burn event (false)
 * @returns The recipient address and potentially updated matched transfer
 */
export function extractRecipientAddress(
  matchedTransfer: PoolTransferInTx,
  precedingTransfers: PoolTransferInTx[],
  isMint: boolean,
): { recipient: string; matchedTransfer: PoolTransferInTx } {
  const ADDRESS_ONE = "0x0000000000000000000000000000000000000001";
  let recipient: string;
  let finalMatchedTransfer = matchedTransfer;

  if (isMint) {
    recipient = matchedTransfer.to;
    // Edge case: Skip address(1) MINIMUM_LIQUIDITY mint if there's another mint
    if (recipient === ADDRESS_ONE && precedingTransfers.length > 1) {
      // Find the next closest (should be the user mint)
      const otherTransfers = precedingTransfers.filter(
        (t) => t.to !== ADDRESS_ONE,
      );
      if (otherTransfers.length > 0) {
        finalMatchedTransfer = otherTransfers.reduce((prev, curr) =>
          curr.logIndex > prev.logIndex ? curr : prev,
        );
        recipient = finalMatchedTransfer.to;
      }
    }
  } else {
    recipient = matchedTransfer.from;
  }

  return { recipient, matchedTransfer: finalMatchedTransfer };
}

/**
 * Find matching Transfer event and attribute USD to actual user
 * Works for both Mint and Burn events
 * @param event - Mint or Burn event
 * @param poolAddress - Pool address
 * @param chainId - Chain ID
 * @param txHash - Transaction hash
 * @param eventLogIndex - Log index of the Mint/Burn event
 * @param isMint - Whether this is a Mint event (true) or Burn event (false)
 * @param token0Instance - Token0 instance
 * @param token1Instance - Token1 instance
 * @param context - Handler context
 * @returns User address, total liquidity USD, and the raw token0/token1 event amounts, or undefined if no match found
 */
export async function findTransferAndAttribute(
  event: EvmEvent<"Pool", "Mint"> | EvmEvent<"Pool", "Burn">,
  poolAddress: string,
  chainId: number,
  txHash: string,
  eventLogIndex: number,
  isMint: boolean,
  token0Instance: Token,
  token1Instance: Token,
  context: handlerContext,
): Promise<AttributionResult | undefined> {
  // Find matching Transfer event
  // Rule: Find Transfer where isMint/isBurn matches, logIndex < eventLogIndex, same tx+pool+chainId
  // Stricter matching: value > 0, and prefer non-address(1) transfers for mints
  // Lookup is a PK read on TxPoolTransferRegistry, then PK gets per transfer id.
  const transfersInTx = await getTransfersInTx(
    txHash,
    chainId,
    poolAddress,
    isMint,
    context,
  );

  // Filter to transfers before this event with value > 0 and not already consumed
  const precedingTransfers = getPrecedingTransfers(
    transfersInTx,
    eventLogIndex,
  );

  if (precedingTransfers.length === 0) {
    // Fallback: Log and skip user attribution
    // This handles cases where Transfer handler hasn't run yet (shouldn't happen)
    const eventType = isMint ? "Mint" : "Burn";
    context.log.warn(
      `[PoolBurnAndMintLogic] No matching Transfer found for ${eventType} event in tx ${txHash} at logIndex ${eventLogIndex} on chain ${chainId}. Skipping USD attribution.`,
    );
    return undefined;
  }

  // Get the closest preceding transfer (largest logIndex)
  let matchedTransfer = findClosestPrecedingTransfer(precedingTransfers);

  // Extract recipient address, handling address(1) edge case for mints
  const { recipient, matchedTransfer: finalMatchedTransfer } =
    extractRecipientAddress(matchedTransfer, precedingTransfers, isMint);
  matchedTransfer = finalMatchedTransfer;

  // Consume the matched transfer: delete it and prune its id from the
  // per-(tx, pool) registry. Symmetric with the CL mint registry cleanup path
  // (#628) — avoids accumulating stale PoolTransferInTx rows since this file
  // is the only reader (grep-verified in #629).
  context.PoolTransferInTx.deleteUnsafe(matchedTransfer.id);
  await pruneRegistryOnConsume(
    TxPoolTransferRegistryId(chainId, txHash, poolAddress),
    matchedTransfer.id,
    context,
  );

  // Calculate USD value
  const totalLiquidityUSD = calculateTotalUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  return {
    recipient,
    totalLiquidityUSD,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
  };
}

/**
 * Process Pool Mint or Burn event with Transfer matching and USD attribution
 * @param event - Mint or Burn event
 * @param poolData - Preloaded pool data (aggregator + token instances)
 * @param poolAddress - Pool address
 * @param chainId - Chain ID
 * @param context - Handler context
 * @param timestamp - Event timestamp
 * @param blockNumber - Block number
 * @param isMint - Whether this is a Mint event (true) or Burn event (false)
 */
export async function processPoolLiquidityEvent(
  event: EvmEvent<"Pool", "Mint"> | EvmEvent<"Pool", "Burn">,
  poolData: PoolData,
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  timestamp: Date,
  blockNumber: number,
  isMint: boolean,
): Promise<void> {
  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;
  const txHash = event.transaction.hash;
  const eventLogIndex = event.logIndex;

  // Find matching Transfer and get user address + USD value
  const attributionResult = await findTransferAndAttribute(
    event,
    poolAddress,
    chainId,
    txHash,
    eventLogIndex,
    isMint,
    token0Instance,
    token1Instance,
    context,
  );

  // Mint and burn always call _update on the contract, which emits a Sync event
  // in the same tx. Sync owns reserves, totalLiquidityUSD (computed from those
  // reserves), AND the pool-internal price ratio (token0Price/token1Price,
  // derived from reserves — #783). So this handler only bumps the activity
  // timestamp; it must not echo token oracle prices into the ratio.
  const poolDiff = {
    lastUpdatedTimestamp: timestamp,
  };

  await updatePool(
    poolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    chainId,
    blockNumber,
  );

  // Update user stats (actual user, not router) if we found a match.
  if (attributionResult?.recipient) {
    await attributeLiquidityDelta(
      attributionResult.recipient,
      attributionResult.totalLiquidityUSD,
      attributionResult.amount0,
      attributionResult.amount1,
      isMint,
      poolData,
      poolAddress,
      chainId,
      context,
      timestamp,
    );
  }
}

/**
 * Attribute a per-LP liquidity delta (USD + raw token0/1 amounts) to the
 * recipient's UserStatsPerPool. This is the shared tail of both V2 liquidity
 * paths: the canonical 3-arg Mint/Burn (recipient resolved by Transfer
 * matching) and the superchain-leaf 4-arg Mint (recipient carried in the event
 * itself, #886). This is the ONLY place the V2 per-LP liquidity deltas are set:
 * incrementalTotalLiquidityAdded/RemovedUSD plus the raw added/removed token0/1
 * amounts (#810), mirroring the CL/NFPM path in NFPMCommonLogic.
 *
 * @param recipient - The actual LP whose stats advance (not the router)
 * @param totalLiquidityUSD - USD value of the deposited/withdrawn amounts
 * @param amount0 - Raw token0 amount from the Mint/Burn event
 * @param amount1 - Raw token1 amount from the Mint/Burn event
 * @param isMint - Whether this is a Mint (added) or Burn (removed)
 * @param poolData - Preloaded pool data (aggregator + token instances)
 * @param poolAddress - Pool address
 * @param chainId - Chain ID
 * @param context - Handler context
 * @param timestamp - Event timestamp
 * @returns Promise that resolves once the UserStatsPerPool upsert is staged
 */
export async function attributeLiquidityDelta(
  recipient: string,
  totalLiquidityUSD: bigint,
  amount0: bigint,
  amount1: bigint,
  isMint: boolean,
  poolData: PoolData,
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  timestamp: Date,
): Promise<void> {
  const userData = await loadOrCreateUserData(
    recipient,
    poolAddress,
    chainId,
    context,
    timestamp,
  );

  const userDiff = isMint
    ? {
        incrementalTotalLiquidityAddedUSD: totalLiquidityUSD,
        incrementalTotalLiquidityAddedToken0: amount0,
        incrementalTotalLiquidityAddedToken1: amount1,
        lastActivityTimestamp: timestamp,
      }
    : {
        incrementalTotalLiquidityRemovedUSD: totalLiquidityUSD,
        incrementalTotalLiquidityRemovedToken0: amount0,
        incrementalTotalLiquidityRemovedToken1: amount1,
        lastActivityTimestamp: timestamp,
      };

  await updateUserStatsPerPool(
    userDiff,
    userData,
    context,
    timestamp,
    poolData,
  );
}

/**
 * Process the superchain-leaf 4-arg Pool Mint (#886). Leaf V2 pools emit
 * `Mint(address indexed sender, address indexed to, uint256 amount0, uint256 amount1)`
 * (distinct topic0 from the canonical 3-arg Mint), carrying the LP recipient
 * directly — so no Transfer matching is needed. Canonical OP/Base pools emit
 * the 3-arg Mint instead, making the two mutually exclusive per pool (no double
 * count). Bumps only the pool activity timestamp (the paired Sync still owns
 * reserves, totalLiquidityUSD and the price ratio — #783), then attributes the
 * added liquidity to `event.params.to`. Finally purges the mint-side
 * PoolTransferInTx rows for this (tx, pool): they are written by
 * processPoolTransfer for the 3-arg Mint's Transfer matching, which never fires
 * on leaf chains, so without this they would accumulate unbounded.
 *
 * @param event - The 4-arg MintWithRecipient event
 * @param poolData - Preloaded pool data (aggregator + token instances)
 * @param poolAddress - Pool address
 * @param chainId - Chain ID
 * @param context - Handler context
 * @param timestamp - Event timestamp
 * @param blockNumber - Block number
 * @returns Promise that resolves once the pool bump, user upsert and mint-transfer purge are staged
 */
export async function processPoolMintWithRecipient(
  event: EvmEvent<"Pool", "MintWithRecipient">,
  poolData: PoolData,
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  timestamp: Date,
  blockNumber: number,
): Promise<void> {
  const { liquidityPoolAggregator, token0Instance, token1Instance } = poolData;
  const txHash = event.transaction.hash;

  await updatePool(
    { lastUpdatedTimestamp: timestamp },
    liquidityPoolAggregator,
    timestamp,
    context,
    chainId,
    blockNumber,
  );

  const totalLiquidityUSD = calculateTotalUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  await attributeLiquidityDelta(
    event.params.to,
    totalLiquidityUSD,
    event.params.amount0,
    event.params.amount1,
    true, // isMint
    poolData,
    poolAddress,
    chainId,
    context,
    timestamp,
  );

  // Consume the mint-side PoolTransferInTx rows for this (tx, pool) so they
  // don't leak. processPoolTransfer records every LP-token mint Transfer for
  // the canonical 3-arg Mint's Transfer matching, but that handler never fires
  // on superchain-leaf chains (they emit only this 4-arg form), so nothing else
  // would ever delete them — they would accumulate unbounded. The recipient is
  // already in the event, so we don't need them for matching; just purge.
  // Burn rows (isBurn) are left untouched for the Burn handler.
  const registryId = TxPoolTransferRegistryId(chainId, txHash, poolAddress);
  const mintTransfers = await getTransfersInTx(
    txHash,
    chainId,
    poolAddress,
    true, // isMint
    context,
  );
  for (const transfer of mintTransfers) {
    context.PoolTransferInTx.deleteUnsafe(transfer.id);
    await pruneRegistryOnConsume(registryId, transfer.id, context);
  }
}
