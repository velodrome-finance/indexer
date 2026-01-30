import type {
  LiquidityPoolAggregator,
  PoolTransferInTx,
  Pool_Burn_event,
  Pool_Mint_event,
  Token,
  handlerContext,
} from "generated";
import { updateLiquidityPoolAggregator } from "../../Aggregators/LiquidityPoolAggregator";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import { calculateTotalLiquidityUSD } from "../../Helpers";

export interface AttributionResult {
  recipient: string | undefined;
  totalLiquidityUSD: bigint;
}

/**
 * Query transfers by indexed fields (txHash is indexed, most selective)
 * Then filter in memory by chainId, pool, and event type
 * @param txHash - Transaction hash (indexed)
 * @param chainId - Chain ID
 * @param poolAddress - Pool address
 * @param isMint - Whether this is a Mint event (true) or Burn event (false)
 * @param context - Handler context
 * @returns Filtered transfers in the transaction
 */
export async function getTransfersInTx(
  txHash: string,
  chainId: number,
  poolAddress: string,
  isMint: boolean,
  context: handlerContext,
): Promise<PoolTransferInTx[]> {
  // Query by txHash
  const transfersInTxHash =
    await context.PoolTransferInTx.getWhere.txHash.eq(txHash);

  // Filter in memory by chainId, pool, and event type
  return transfersInTxHash.filter(
    (t) =>
      t.chainId === chainId &&
      t.pool === poolAddress &&
      (isMint ? t.isMint === true : t.isBurn === true),
  );
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
  return transfersInTx.filter(
    (t) =>
      t.logIndex < eventLogIndex &&
      t.value > 0n &&
      (t.consumedByLogIndex === null || t.consumedByLogIndex === undefined),
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
 * @returns User address and total liquidity USD, or undefined if no match found
 */
export async function findTransferAndAttribute(
  event: Pool_Mint_event | Pool_Burn_event,
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
  // Query by txHash (indexed, most selective) then filter by chainId, pool, and event type
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

  // Mark the matched transfer as consumed by this event
  context.PoolTransferInTx.set({
    ...matchedTransfer,
    consumedByLogIndex: eventLogIndex,
  });

  // Calculate USD value
  const totalLiquidityUSD = calculateTotalLiquidityUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  return {
    recipient,
    totalLiquidityUSD,
  };
}

/**
 * Process Pool Mint or Burn event with Transfer matching and USD attribution
 * @param event - Mint or Burn event
 * @param liquidityPoolAggregator - Pool aggregator entity
 * @param poolAddress - Pool address
 * @param chainId - Chain ID
 * @param token0Instance - Token0 instance
 * @param token1Instance - Token1 instance
 * @param context - Handler context
 * @param timestamp - Event timestamp
 * @param blockNumber - Block number
 * @param isMint - Whether this is a Mint event (true) or Burn event (false)
 */
export async function processPoolLiquidityEvent(
  event: Pool_Mint_event | Pool_Burn_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  poolAddress: string,
  chainId: number,
  token0Instance: Token,
  token1Instance: Token,
  context: handlerContext,
  timestamp: Date,
  blockNumber: number,
  isMint: boolean,
): Promise<void> {
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

  // Update pool metrics (token prices only)
  // DO NOT update incrementalCurrentLiquidityUSD here - TVL is computed from reserves in Sync handler
  // No updates to reserves are needed - Sync events handle reserve updates
  // Mint and burn functions always call _update method on the contract which always emits Sync event
  const poolDiff = {
    token0Price: token0Instance.pricePerUSDNew,
    token1Price: token1Instance.pricePerUSDNew,
    lastUpdatedTimestamp: timestamp,
  };

  await updateLiquidityPoolAggregator(
    poolDiff,
    liquidityPoolAggregator,
    timestamp,
    context,
    chainId,
    blockNumber,
  );

  // Update user stats (actual user, not router) if we found a match
  // This is the ONLY place where incrementalTotalLiquidityAddedUSD/RemovedUSD is set
  if (attributionResult?.recipient) {
    const userData = await loadOrCreateUserData(
      attributionResult.recipient,
      poolAddress,
      chainId,
      context,
      timestamp,
    );

    const userDiff = isMint
      ? {
          incrementalTotalLiquidityAddedUSD:
            attributionResult.totalLiquidityUSD,
          lastActivityTimestamp: timestamp,
        }
      : {
          incrementalTotalLiquidityRemovedUSD:
            attributionResult.totalLiquidityUSD,
          lastActivityTimestamp: timestamp,
        };

    await updateUserStatsPerPool(userDiff, userData, context);
  }
}
