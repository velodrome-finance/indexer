import { NFPM } from "generated";
import { updateNonFungiblePosition } from "../../Aggregators/NonFungiblePosition";
import { toChecksumAddress } from "../../Constants";
import {
  cleanupOrphanedPlaceholders,
  findNonFungiblePositionByTXHashAndAmounts,
  getSqrtPriceX96AndTokens,
  getTokensForPosition,
  processDecreaseLiquidity,
  processIncreaseLiquidity,
  processTransfer,
} from "./NFPMLogic";

/**
 * @title NonfungiblePositionManager
 * @notice This contract manages non-fungible tokens (NFTs) that represent positions in a liquidity pool.
 * It extends the ERC721 standard, allowing these positions to be transferred and managed as NFTs.
 * The contract provides functionalities for minting, increasing, and decreasing liquidity, as well as collecting fees.
 */

/**
 * @event Transfer
 * @notice Emitted when an NFT is transferred, including when a new NFT is minted.
 * @param {address} from - The address of the previous owner of the token. For minting, this is the zero address.
 * @param {address} to - The address of the new owner of the token.
 * @param {uint256} tokenId - The ID of the token being transferred.
 */
NFPM.Transfer.handler(async ({ event, context }) => {
  const isMint =
    event.params.from === "0x0000000000000000000000000000000000000000";

  // Try to find position by tokenId first (in case it already exists)
  let position = await context.NonFungiblePosition.getWhere.tokenId.eq(
    event.params.tokenId,
  );
  // Filter by chainId to ensure we get the position from the correct chain
  if (position && position.length > 0) {
    position = position.filter((pos) => pos.chainId === event.chainId);
  }

  // If not found and this is a mint, look for placeholder by transaction hash
  if ((!position || position.length === 0) && isMint) {
    const positions =
      await context.NonFungiblePosition.getWhere.mintTransactionHash.eq(
        event.transaction.hash,
      );

    if (positions && positions.length > 0) {
      // Find placeholder with matching ID pattern and tokenId = 0n (placeholder marker)
      // Placeholder ID format: ${chainId}_${txHash}_${logIndex}
      // Placeholder tokenId is set to 0n to mark it as a placeholder
      const placeholderIdPrefix = `${event.chainId}_${event.transaction.hash.slice(2)}_`;
      const matchingPlaceholders = positions.filter(
        (pos) => pos.id.startsWith(placeholderIdPrefix) && pos.tokenId === 0n, // Placeholder marker
      );

      // If multiple placeholders match (multiple mints in same transaction),
      // we need another way to match. Since we can't use logIndex comparison anymore,
      // we'll take the first one found. In practice, there should only be one placeholder per mint.
      // If there are multiple, they should be matched by amounts in IncreaseLiquidity.
      const placeholderPosition = matchingPlaceholders[0];

      if (placeholderPosition) {
        position = [placeholderPosition];
      }
    }
  }

  if (!position || position.length === 0) {
    context.log.error(
      `NonFungiblePosition with tokenId ${event.params.tokenId} not found during transfer on chain ${event.chainId}`,
    );
    return;
  }

  // Use the first matching position (should be unique)
  const currentPosition = position[0];

  // Get token entities to calculate USD value
  const [token0, token1] = await getTokensForPosition(
    event.chainId,
    currentPosition,
    context,
  );

  // Process transfer logic
  const nonFungiblePositionDiff = processTransfer(
    toChecksumAddress(event.params.to),
    currentPosition,
    event.params.tokenId,
    token0,
    token1,
    event.block.timestamp,
  );

  // Update position in place - keep the same ID (placeholder ID), just update tokenId and other fields
  updateNonFungiblePosition(nonFungiblePositionDiff, currentPosition, context);

  // Clean up orphaned placeholders from the same transaction
  await cleanupOrphanedPlaceholders(event.transaction.hash, context);
});

// This event is emitted when mints and liquidity increases
// However, mint-related entity creation of NonFungiblePosition is handled CLPool module
NFPM.IncreaseLiquidity.handler(async ({ event, context }) => {
  // Try to find position by tokenId first
  let positions = await context.NonFungiblePosition.getWhere.tokenId.eq(
    event.params.tokenId,
  );
  // Filter by chainId to ensure we get the position from the correct chain
  if (positions && positions.length > 0) {
    positions = positions.filter((pos) => pos.chainId === event.chainId);
  }

  // If not found, try to find by transaction hash and matching amounts (for mint case)
  if (!positions || positions.length === 0) {
    const position = await findNonFungiblePositionByTXHashAndAmounts(
      event.transaction.hash,
      event.params.amount0,
      event.params.amount1,
      context,
    );
    if (position) {
      positions = [position];
    }
  }

  if (!positions || positions.length === 0) {
    context.log.error(
      `NonFungiblePosition with tokenId ${event.params.tokenId} not found during increase liquidity on chain ${event.chainId} or event is from a mint action.`,
    );
    return;
  }

  const position = positions[0];

  // Get sqrtPriceX96 and tokens in parallel
  const [sqrtPriceX96, token0, token1] = await getSqrtPriceX96AndTokens(
    event.chainId,
    position,
    event.block.number,
    context,
  );

  // Process increase liquidity logic
  const nonFungiblePositionDiff = processIncreaseLiquidity(
    event,
    position,
    sqrtPriceX96,
    token0,
    token1,
  );

  // Update position with result
  updateNonFungiblePosition(nonFungiblePositionDiff, position, context);

  // Clean up orphaned placeholders
  await cleanupOrphanedPlaceholders(event.transaction.hash, context);
});

NFPM.DecreaseLiquidity.handler(async ({ event, context }) => {
  // Get position by tokenId
  // Transfer should have already run and updated the placeholder, so position should exist when a DecreaseLiquidity event is processed
  // Filter by chainId to avoid cross-chain collisions (same tokenId can exist on different chains)
  let positions = await context.NonFungiblePosition.getWhere.tokenId.eq(
    event.params.tokenId,
  );
  // Filter by chainId to ensure we get the position from the correct chain
  if (positions && positions.length > 0) {
    positions = positions.filter((pos) => pos.chainId === event.chainId);
  }

  // This should never happen
  if (!positions || positions.length === 0) {
    context.log.error(
      `NonFungiblePosition with tokenId ${event.params.tokenId} not found during decrease liquidity on chain ${event.chainId}`,
    );
    return;
  }

  const position = positions[0];

  // Get sqrtPriceX96 and tokens in parallel
  const [sqrtPriceX96, token0, token1] = await getSqrtPriceX96AndTokens(
    event.chainId,
    position,
    event.block.number,
    context,
  );

  // Process decrease liquidity logic
  const nonFungiblePositionDiff = processDecreaseLiquidity(
    event,
    position,
    sqrtPriceX96,
    token0,
    token1,
  );

  updateNonFungiblePosition(nonFungiblePositionDiff, position, context);

  await cleanupOrphanedPlaceholders(event.transaction.hash, context);
});
