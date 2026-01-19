import type {
  CLPoolMintEvent,
  NFPM_Transfer_event,
  NonFungiblePosition,
  handlerContext,
} from "generated";
import { updateNonFungiblePosition } from "../../Aggregators/NonFungiblePosition";
import { loadOrCreateUserData } from "../../Aggregators/UserStatsPerPool";
import { toChecksumAddress } from "../../Constants";
import { findPositionByTokenId } from "./NFPMCommonLogic";

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
 * @internal
 */
export async function _createPositionFromCLPoolMint(
  mintEvent: CLPoolMintEvent,
  tokenId: bigint,
  owner: string,
  chainId: number,
  blockTimestamp: number,
  context: handlerContext,
): Promise<void> {
  // Create definitive NonFungiblePosition with stable ID: ${chainId}_${poolAddress}_${tokenId}
  const stableId = `${chainId}_${mintEvent.pool}_${tokenId}`;

  // Create new entity with stable ID, using data from CLPoolMintEvent
  const position: NonFungiblePosition = {
    id: stableId,
    chainId: mintEvent.chainId,
    tokenId: tokenId,
    owner: toChecksumAddress(owner),
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
 * @internal
 */
export async function _handleMintTransfer(
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
    await _createPositionFromCLPoolMint(
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
 * Handles a regular transfer (from != 0x0).
 * Updates the owner of an existing position. The position ID remains the same.
 *
 * @param event - The NFPM.Transfer event (regular transfer case)
 * @param positions - The existing positions. Only one position should be found.
 * @param context - The handler context
 * @internal
 */
export function _handleRegularTransfer(
  event: NFPM_Transfer_event,
  positions: NonFungiblePosition[],
  context: handlerContext,
): void {
  // Use the first matching position (should be unique)
  const currentPosition = positions[0];

  const nonFungiblePositionDiff = {
    owner: toChecksumAddress(event.params.to),
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Position already has stable ID, just update owner
  updateNonFungiblePosition(nonFungiblePositionDiff, currentPosition, context);
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

  const isMint =
    event.params.from === "0x0000000000000000000000000000000000000000";

  if (isMint) {
    // Handle mint transfer: find appropriate CLPoolMintEvent entity and
    // create NonFungiblePosition entity with stable ID
    await _handleMintTransfer(event, context, positions);
    return;
  }

  // Handle regular transfer: update owner of existing position
  if (positions.length === 0) {
    context.log.error(
      `NonFungiblePosition with tokenId ${event.params.tokenId} not found during transfer on chain ${event.chainId}`,
    );
    return;
  }

  _handleRegularTransfer(event, positions, context);
}
