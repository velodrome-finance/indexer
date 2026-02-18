import type {
  CLPoolMintEvent,
  NFPM_Transfer_event,
  NonFungiblePosition,
  handlerContext,
} from "generated";
import {
  type PoolData,
  loadPoolData,
} from "../../Aggregators/LiquidityPoolAggregator";
import { updateNonFungiblePosition } from "../../Aggregators/NonFungiblePosition";
import { NonFungiblePositionId, ZERO_ADDRESS } from "../../Constants";
import { calculatePositionAmountsFromLiquidity } from "../../Helpers";
import {
  LiquidityChangeType,
  attributeLiquidityChangeToUserStatsPerPool,
  findPositionByTokenId,
} from "./NFPMCommonLogic";

/**
 * Creates a definitive NonFungiblePosition entity from a CLPoolMintEvent and deletes the temporary event.
 * Creates a new entity with stable ID `${chainId}_${poolAddress}_${tokenId}` using data from the CLPoolMintEvent.
 *
 * @param mintEvent - The CLPoolMintEvent to create position from
 * @param tokenId - The actual token ID from the NFPM.Transfer event
 * @param owner - The owner address from the NFPM.Transfer event
 * @param chainId - The chain ID
 * @param blockTimestamp - The block timestamp
 * @param context - The handler context for database operations
 * @returns The newly created stable position entity
 */
export async function createPositionFromCLPoolMint(
  mintEvent: CLPoolMintEvent,
  tokenId: bigint,
  owner: string,
  chainId: number,
  blockTimestamp: number,
  context: handlerContext,
): Promise<void> {
  // Create definitive NonFungiblePosition with stable ID: chainId_poolAddress_tokenId
  const stableId = NonFungiblePositionId(chainId, mintEvent.pool, tokenId);

  // Create new entity with stable ID, using data from CLPoolMintEvent
  const position: NonFungiblePosition = {
    id: stableId,
    chainId: mintEvent.chainId,
    tokenId: tokenId,
    owner: owner,
    pool: mintEvent.pool,
    tickUpper: mintEvent.tickUpper,
    tickLower: mintEvent.tickLower,
    token0: mintEvent.token0,
    token1: mintEvent.token1,
    // Liquidity will be set by IncreaseLiquidity event. IncreaseLiquidity event always
    // comes after Transfer event. If we assigned here the liquidity value from the CLPool Mint event,
    // we would be double counting the minted liquidity (1st time from Mint event, 2nd time from IncreaseLiquidity event)
    liquidity: 0n,
    mintTransactionHash: mintEvent.transactionHash,
    mintLogIndex: mintEvent.logIndex,
    lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
  };

  context.NonFungiblePosition.set(position);

  // Delete consumed CLPoolMintEvent immediately
  context.CLPoolMintEvent.deleteUnsafe(mintEvent.id);
}

/**
 * Handles a mint transfer (from == 0x0) using logIndex-based matching.
 * Finds the matching CLPoolMintEvent and creates a definitive NonFungiblePosition.
 *
 * Process:
 * 1. Check if position already exists (early return if found)
 * 2. Query CLPoolMintEvent by transaction hash
 * 3. Filter by: chainId, logIndex < transferLogIndex, not consumed
 * 4. Select closest preceding mint by logIndex (deterministic for multiple mints)
 * 5. Create definitive position and delete CLPoolMintEvent
 *
 * @param event - The NFPM.Transfer event (mint case)
 * @param context - The handler context
 * @param existingPositions - Array of existing positions found by tokenId (pre-queried)
 */
export async function handleMintTransfer(
  event: NFPM_Transfer_event,
  context: handlerContext,
  existingPositions: NonFungiblePosition[],
): Promise<void> {
  // If position already exists, nothing to do (shouldn't happen for new mints)
  if (existingPositions.length > 0) {
    return;
  }

  // Query CLPoolMintEvent by transaction hash
  const mintEvents = await context.CLPoolMintEvent.getWhere.transactionHash.eq(
    event.transaction.hash,
  );

  // Filter by: chainId, logIndex < transferLogIndex, not consumed
  const matchingEvents =
    mintEvents?.filter(
      (m: CLPoolMintEvent) =>
        m.chainId === event.chainId &&
        !m.consumedByTokenId &&
        m.logIndex < event.logIndex,
    ) ?? [];

  if (matchingEvents.length > 0) {
    // Select closest preceding mint by logIndex (deterministic for multiple mints)
    //
    // Why this selection strategy is necessary:
    // 1. A single transaction can contain multiple CLPool.Mint events (e.g., user mints positions in multiple pools)
    // 2. Each NFPM.Transfer (mint) event must match with the correct CLPool.Mint event
    // 3. Events are processed in logIndex order within a transaction
    // 4. The Transfer event should match with the most recent (closest) preceding Mint event
    //
    // Example transaction with multiple mints:
    //   logIndex 10: CLPool.Mint (pool A) → creates CLPoolMintEvent A
    //   logIndex 20: CLPool.Mint (pool B) → creates CLPoolMintEvent B
    //   logIndex 30: NFPM.Transfer (mint, pool A) → should match CLPoolMintEvent A (logIndex 10)
    //   logIndex 40: NFPM.Transfer (mint, pool B) → should match CLPoolMintEvent B (logIndex 20)
    //
    // By selecting the maximum logIndex from matchingEvents (which are already filtered to logIndex < transferLogIndex),
    // we get the closest preceding mint, ensuring deterministic and correct matching.
    const mintEvent = matchingEvents.reduce(
      (prev: CLPoolMintEvent, current: CLPoolMintEvent) =>
        current.logIndex > prev.logIndex ? current : prev,
    );

    // Create definitive position and delete CLPoolMintEvent entity
    await createPositionFromCLPoolMint(
      mintEvent,
      event.params.tokenId,
      event.params.to,
      event.chainId,
      event.block.timestamp,
      context,
    );
    return;
  }

  context.log.warn(
    `No CLPoolMintEvent found for NFPM.Transfer(mint) tokenId ${event.params.tokenId} in tx ${event.transaction.hash}`,
  );
}

/**
 * Returns true when the transfer is to or from the pool's gauge (stake/unstake).
 * In that case we do not update owner or UserStatsPerPool.
 * @param from - The sender address
 * @param to - The recipient address
 * @param gaugeAddress - The address of the pool's gauge
 * @returns True if the transfer is to or from the pool's gauge, false otherwise
 */
export function isGaugeTransfer(
  from: string,
  to: string,
  gaugeAddress: string | undefined,
): boolean {
  if (!gaugeAddress) return false;
  return from === gaugeAddress || to === gaugeAddress;
}

/**
 * Attributes the position's token0/token1 amounts to UserStatsPerPool: REMOVE from sender, ADD to recipient (if not zero address).
 * No-op if sqrtPriceX96 is missing/zero.
 *
 * @param event - The NFPM.Transfer event
 * @param position - The NonFungiblePosition entity
 * @param context - The handler context
 * @param poolData - The pool data
 */
export async function attributeTransferToUserStatsPerPool(
  event: NFPM_Transfer_event,
  position: NonFungiblePosition,
  context: handlerContext,
  poolData: PoolData,
): Promise<void> {
  const sqrtPriceX96 = poolData.liquidityPoolAggregator.sqrtPriceX96;
  if (sqrtPriceX96 === undefined || sqrtPriceX96 === 0n) {
    return;
  }

  const { amount0, amount1 } = calculatePositionAmountsFromLiquidity(
    position.liquidity,
    sqrtPriceX96,
    position.tickLower,
    position.tickUpper,
  );

  // Self-transfers have no net effect on user stats
  if (event.params.from === event.params.to) {
    return;
  }

  // Removing amount0/amount1 from sender and (if not zero address) adding to recipient, in parallel
  const promises = [
    attributeLiquidityChangeToUserStatsPerPool(
      event.params.from, // sender
      position.pool,
      poolData,
      context,
      amount0,
      amount1,
      event.block.timestamp,
      LiquidityChangeType.REMOVE,
    ),
  ];

  if (event.params.to !== ZERO_ADDRESS) {
    promises.push(
      attributeLiquidityChangeToUserStatsPerPool(
        event.params.to, // recipient
        position.pool,
        poolData,
        context,
        amount0,
        amount1,
        event.block.timestamp,
        LiquidityChangeType.ADD,
      ),
    );
  }

  await Promise.all(promises);
}

/**
 * Handles a regular transfer (from != 0x0).
 * If the transfer is to/from the pool's gauge, returns without updating owner or UserStatsPerPool.
 * Otherwise attributes position token0/token1 to UserStatsPerPool (remove from sender, add to recipient) then updates owner.
 *
 * @param event - The NFPM.Transfer event (regular transfer case)
 * @param positions - The existing positions. Only one position should be found.
 * @param context - The handler context
 */
export async function handleRegularTransfer(
  event: NFPM_Transfer_event,
  positions: NonFungiblePosition[],
  context: handlerContext,
): Promise<void> {
  if (positions.length === 0) {
    context.log.error(
      `[handleRegularTransfer] No positions provided for transfer of tokenId ${event.params.tokenId} on chain ${event.chainId}`,
    );
    return;
  }

  const position = positions[0];

  const poolData = await loadPoolData(
    position.pool,
    event.chainId,
    context,
    event.block.number,
    event.block.timestamp,
  );

  const isGauge = poolData
    ? isGaugeTransfer(
        event.params.from,
        event.params.to,
        poolData.liquidityPoolAggregator.gaugeAddress,
      )
    : false; // When poolData is null we cannot know if it's a gauge transfer; skip only attribution below, still update owner.
  if (isGauge) {
    context.log.info(
      `[NFPMTransferLogic] Transfer to/from gauge ${poolData?.liquidityPoolAggregator.gaugeAddress} on chain ${event.chainId} in tx ${event.transaction.hash}`,
    );
    return;
  }

  if (poolData) {
    await attributeTransferToUserStatsPerPool(
      event,
      position,
      context,
      poolData,
    );
  } else {
    context.log.warn(
      `[NFPMTransferLogic] Pool data not found for pool ${position.pool} during transfer on chain ${event.chainId} in tx ${event.transaction.hash}`,
    );
  }

  const nonFungiblePositionDiff = {
    owner: event.params.to,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };
  updateNonFungiblePosition(nonFungiblePositionDiff, position, context);
}

/**
 * Main function to process NFPM.Transfer events.
 * Handles both mint transfers (from == 0x0) and regular transfers (from != 0x0).
 *
 * For mint transfers:
 * - Finds matching placeholder created by CLPool.Mint
 * - Promotes placeholder to stable ID: ${chainId}_${poolAddress}_${tokenId}
 * - Deletes placeholder entity
 *
 * For regular transfers:
 * - Finds existing position by tokenId
 * - Updates owner field only
 *
 * @param event - The NFPM.Transfer event
 * @param context - The handler context
 */
export async function processNFPMTransfer(
  event: NFPM_Transfer_event,
  context: handlerContext,
): Promise<void> {
  const positions = await findPositionByTokenId(
    event.params.tokenId,
    event.chainId,
    context,
  );

  const isMint = event.params.from === ZERO_ADDRESS;

  if (isMint) {
    // Handle mint transfer: find appropriate CLPoolMintEvent entity and
    // create NonFungiblePosition entity with stable ID
    await handleMintTransfer(event, context, positions);
    return;
  }

  // Handle regular transfer: gauge check, token0/token1 accounting, then update owner
  if (positions.length === 0) {
    context.log.error(
      `NonFungiblePosition with tokenId ${event.params.tokenId} not found during transfer on chain ${event.chainId}`,
    );
    return;
  }

  await handleRegularTransfer(event, positions, context);
}
