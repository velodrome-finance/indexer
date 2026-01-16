import type {
  LiquidityPoolAggregator,
  Pool_Transfer_event,
  handlerContext,
} from "generated";
import { updateLiquidityPoolAggregator } from "../../Aggregators/LiquidityPoolAggregator";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import { ZERO_ADDRESS } from "../../Constants";

/**
 * Update pool totalLPTokenSupply based on mint/burn transfers
 * @param isMint - Whether this is a mint transfer (from == 0x0)
 * @param isBurn - Whether this is a burn transfer (to == 0x0)
 * @param value - The LP token amount transferred
 * @param liquidityPoolAggregator - The pool aggregator entity
 * @param timestamp - Event timestamp
 * @param context - Handler context
 * @param blockNumber - Block number
 * @internal
 */
export async function _updatePoolTotalSupply(
  isMint: boolean,
  isBurn: boolean,
  value: bigint,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  timestamp: Date,
  context: handlerContext,
  blockNumber: number,
): Promise<void> {
  let incrementalTotalLPSupply = 0n;
  if (isMint) {
    incrementalTotalLPSupply = value;
  } else if (isBurn) {
    incrementalTotalLPSupply = -value;
  }

  const poolDiff = {
    incrementalTotalLPSupply: incrementalTotalLPSupply,
    lastUpdatedTimestamp: timestamp,
  };

  if (incrementalTotalLPSupply !== 0n) {
    await updateLiquidityPoolAggregator(
      poolDiff,
      liquidityPoolAggregator,
      timestamp,
      context,
      blockNumber,
    );
  }
}

/**
 * Update user LP balances based on transfer type (mint, burn, or regular transfer)
 * @param isMint - Whether this is a mint transfer (from == 0x0)
 * @param isBurn - Whether this is a burn transfer (to == 0x0)
 * @param from - Transfer sender address
 * @param to - Transfer recipient address
 * @param value - The LP token amount transferred
 * @param poolAddress - Pool address
 * @param chainId - Chain ID
 * @param context - Handler context
 * @param timestamp - Event timestamp
 * @internal
 */
export async function _updateUserLpBalances(
  isMint: boolean,
  isBurn: boolean,
  from: string,
  to: string,
  value: bigint,
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  timestamp: Date,
): Promise<void> {
  if (isMint) {
    // Mint: add to recipient
    const recipientData = await loadOrCreateUserData(
      to,
      poolAddress,
      chainId,
      context,
      timestamp,
    );

    const userDiff = {
      incrementalLpBalance: value,
      lastActivityTimestamp: timestamp,
    };

    await updateUserStatsPerPool(userDiff, recipientData, context);
  } else if (isBurn) {
    // Burn: subtract from sender
    const senderData = await loadOrCreateUserData(
      from,
      poolAddress,
      chainId,
      context,
      timestamp,
    );

    const userDiff = {
      incrementalLpBalance: -value,
      lastActivityTimestamp: timestamp,
    };

    await updateUserStatsPerPool(userDiff, senderData, context);
  } else {
    // Regular transfer: update both
    // Handle self-transfer case (from === to) to avoid conflicting updates
    if (from.toLowerCase() === to.toLowerCase()) {
      // Self-transfer: only update lastActivityTimestamp, balance remains unchanged
      const userData = await loadOrCreateUserData(
        from,
        poolAddress,
        chainId,
        context,
        timestamp,
      );

      const userDiff = {
        incrementalLpBalance: 0n,
        lastActivityTimestamp: timestamp,
      };

      await updateUserStatsPerPool(userDiff, userData, context);
    } else {
      // Regular transfer between different addresses
      const [senderData, recipientData] = await Promise.all([
        loadOrCreateUserData(from, poolAddress, chainId, context, timestamp),
        loadOrCreateUserData(to, poolAddress, chainId, context, timestamp),
      ]);

      const userDiffFrom = {
        incrementalLpBalance: -value,
        lastActivityTimestamp: timestamp,
      };
      const userDiffTo = {
        incrementalLpBalance: value,
        lastActivityTimestamp: timestamp,
      };

      await Promise.all([
        updateUserStatsPerPool(userDiffFrom, senderData, context),
        updateUserStatsPerPool(userDiffTo, recipientData, context),
      ]);
    }
  }
}

/**
 * Store mint/burn transfer in PoolTransferInTx entity for later Mint/Burn event matching
 * Only stores mint/burn transfers (not regular transfers) to reduce storage
 * @param isMint - Whether this is a mint transfer (from == 0x0)
 * @param isBurn - Whether this is a burn transfer (to == 0x0)
 * @param chainId - Chain ID
 * @param txHash - Transaction hash
 * @param poolAddress - Pool address
 * @param logIndex - Event log index
 * @param blockNumber - Block number
 * @param from - Transfer sender address
 * @param to - Transfer recipient address
 * @param value - The LP token amount transferred
 * @param timestamp - Event timestamp
 * @param context - Handler context
 * @internal
 */
export function _storeTransferForMatching(
  isMint: boolean,
  isBurn: boolean,
  chainId: number,
  txHash: string,
  poolAddress: string,
  logIndex: number,
  blockNumber: number,
  from: string,
  to: string,
  value: bigint,
  timestamp: Date,
  context: handlerContext,
): void {
  // Only store mint/burn transfers (not regular transfers) to reduce storage
  if (isMint || isBurn) {
    const transferId = `${chainId}-${txHash}-${poolAddress}-${logIndex}`;
    context.PoolTransferInTx.set({
      id: transferId,
      chainId: chainId,
      txHash: txHash,
      pool: poolAddress,
      logIndex: logIndex,
      blockNumber: BigInt(blockNumber),
      from: from,
      to: to,
      value: value,
      isMint: isMint,
      isBurn: isBurn,
      consumedByLogIndex: undefined, // Initially unused
      timestamp: timestamp,
    });
  }
}

/**
 * Process Pool Transfer event
 * Handles LP token transfers (mint, burn, regular transfers)
 * Updates pool totalLPTokenSupply, user LP balances, and stores mint/burn transfers for matching
 */
export async function processPoolTransfer(
  event: Pool_Transfer_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  timestamp: Date,
): Promise<void> {
  const { from, to, value } = event.params;
  const txHash = event.transaction.hash;
  const logIndex = event.logIndex;
  const isMint = from === ZERO_ADDRESS;
  const isBurn = to === ZERO_ADDRESS;

  // 1. Update pool totalLPTokenSupply
  await _updatePoolTotalSupply(
    isMint,
    isBurn,
    value,
    liquidityPoolAggregator,
    timestamp,
    context,
    event.block.number,
  );

  // 2. Update user LP balances
  await _updateUserLpBalances(
    isMint,
    isBurn,
    from,
    to,
    value,
    poolAddress,
    chainId,
    context,
    timestamp,
  );

  // 3. Store transfer in temporary entity for Mint/Burn matching
  _storeTransferForMatching(
    isMint,
    isBurn,
    chainId,
    txHash,
    poolAddress,
    logIndex,
    event.block.number,
    from,
    to,
    value,
    timestamp,
    context,
  );
}
