import { NFPM } from "generated";
import { toChecksumAddress } from "../../Constants";
import { calculateTotalLiquidityUSD } from "../../Helpers";

/**
 * @title NonfungiblePositionManager
 * @notice This contract manages non-fungible tokens (NFTs) that represent positions in a liquidity pool.
 * It extends the ERC721 standard, allowing these positions to be transferred and managed as NFTs.
 * The contract provides functionalities for minting, increasing, and decreasing liquidity, as well as collecting fees.
 */

const NonFungiblePositionId = (chainId: number, tokenId: bigint) =>
  `${chainId}_${tokenId}`;

/**
 * @event Transfer
 * @notice Emitted when an NFT is transferred, including when a new NFT is minted.
 * @param {address} from - The address of the previous owner of the token. For minting, this is the zero address.
 * @param {address} to - The address of the new owner of the token.
 * @param {uint256} tokenId - The ID of the token being transferred.
 */
NFPM.Transfer.handler(async ({ event, context }) => {
  const positionId = NonFungiblePositionId(event.chainId, event.params.tokenId);

  // Get current position by actual tokenId
  let position = await context.NonFungiblePosition.get(positionId);

  // If not found, this might be a mint event - look for placeholder position in same transaction
  if (
    !position &&
    event.params.from === "0x0000000000000000000000000000000000000000"
  ) {
    const positions =
      await context.NonFungiblePosition.getWhere.mintTransactionHash.eq(
        event.transaction.hash,
      );

    // Find position with placeholder tokenId that hasn't been updated yet
    // Placeholder ID format: ${chainId}_${txHash}_${logIndex}
    // Placeholder tokenId is set to CLPool.Mint logIndex (BigInt(event.logIndex))
    // Transfer event always comes after mint event, so we match by comparing logIndex values
    // Since placeholder.tokenId = CLPool.Mint logIndex, and CLPool.Mint comes before NFPM.Transfer,
    // we look for the placeholder with the highest tokenId (logIndex) that is still < Transfer logIndex
    const placeholderIdPrefix = `${event.chainId}_${event.transaction.hash.slice(2)}_`;
    const matchingPlaceholders = positions?.filter(
      (pos) =>
        pos.id.startsWith(placeholderIdPrefix) &&
        pos.tokenId < BigInt(event.logIndex), // CLPool.Mint must come before NFPM.Transfer
    );

    // If multiple placeholders match, take the one with the highest tokenId (closest to Transfer logIndex)
    // This handles the case where there are multiple mints in the same transaction
    const placeholderPosition = matchingPlaceholders?.reduce(
      (prev, current) => {
        if (!prev) return current;
        return current.tokenId > prev.tokenId ? current : prev;
      },
      undefined as (typeof matchingPlaceholders)[0] | undefined,
    );

    if (placeholderPosition) {
      // Use placeholder position data but with correct ID and tokenId
      position = {
        ...placeholderPosition,
        id: positionId,
        tokenId: event.params.tokenId,
      };
    }
  }

  if (!position) {
    context.log.error(
      `NonFungiblePosition ${positionId} not found during transfer on chain ${event.chainId}`,
    );
    return;
  }

  // Get token entities to calculate USD value
  const token0 = await context.Token.get(`${event.chainId}_${position.token0}`);
  const token1 = await context.Token.get(`${event.chainId}_${position.token1}`);

  const blockDatetime = new Date(event.block.timestamp * 1000);

  // Updating amountUSD given current prices of token0 and token1
  const NonFungiblePositionAmountUSD = calculateTotalLiquidityUSD(
    position.amount0,
    position.amount1,
    token0,
    token1,
  );

  // Update owner on transfer
  const updatedPosition = {
    ...position,
    owner: toChecksumAddress(event.params.to),
    amountUSD: NonFungiblePositionAmountUSD,
    lastUpdatedTimestamp: blockDatetime,
  };

  context.NonFungiblePosition.set(updatedPosition);
});

// This event is emitted when mints and liquidity increases
// However, mint-related entity creation of NonFungiblePosition is handled CLPool module
NFPM.IncreaseLiquidity.handler(async ({ event, context }) => {
  const positionId = NonFungiblePositionId(event.chainId, event.params.tokenId);

  // Start filtering by fetching NonFungiblePosition entity created in the same transaction hash
  const positions =
    await context.NonFungiblePosition.getWhere.mintTransactionHash.eq(
      event.transaction.hash,
    );

  if (!positions || positions.length === 0) {
    context.log.error(
      `NonFungiblePosition ${positionId} not found during increase liquidity on chain ${event.chainId} or event is from a mint action.`,
    );
    return;
  }

  // Filter by amount0 and amount1 to find the matching position
  // More robust filtering if, for example, there's more than 1 Mint event for the same transaction hash
  const matchingPosition = positions.find(
    (pos) =>
      pos.amount0 === event.params.amount0 &&
      pos.amount1 === event.params.amount1,
  );

  if (!matchingPosition) {
    context.log.error(
      `NonFungiblePosition with matching amounts (${event.params.amount0}, ${event.params.amount1}) not found during increase liquidity on chain ${event.chainId}.`,
    );
    return;
  }

  const position = matchingPosition;

  // Get token entities to calculate USD value
  const token0 = await context.Token.get(`${event.chainId}_${position.token0}`);
  const token1 = await context.Token.get(`${event.chainId}_${position.token1}`);

  const blockDatetime = new Date(event.block.timestamp * 1000);

  const newAmount0 = position.amount0 + event.params.amount0;
  const newAmount1 = position.amount1 + event.params.amount1;

  const NonFungiblePositionAmountUSD = calculateTotalLiquidityUSD(
    newAmount0,
    newAmount1,
    token0,
    token1,
  );

  // Update position with increased liquidity amounts
  const updatedPosition = {
    ...position,
    amount0: newAmount0,
    amount1: newAmount1,
    amountUSD: NonFungiblePositionAmountUSD,
    lastUpdatedTimestamp: blockDatetime,
  };
  context.NonFungiblePosition.set(updatedPosition);
});

NFPM.DecreaseLiquidity.handler(async ({ event, context }) => {
  const positionId = NonFungiblePositionId(event.chainId, event.params.tokenId);

  // Get position by actual tokenId
  // Transfer should have already run and updated the placeholder, so position should exist when a DecreaseLiquidity event is processed
  const position = await context.NonFungiblePosition.get(positionId);

  // This should never happen
  if (!position) {
    context.log.error(
      `NonFungiblePosition ${positionId} not found during decrease liquidity on chain ${event.chainId}`,
    );
    return;
  }

  // Get token entities to calculate USD value
  const token0 = await context.Token.get(`${event.chainId}_${position.token0}`);
  const token1 = await context.Token.get(`${event.chainId}_${position.token1}`);

  const blockDatetime = new Date(event.block.timestamp * 1000);

  // Update position with decreased liquidity amounts
  const newAmount0 = position.amount0 - event.params.amount0;
  const newAmount1 = position.amount1 - event.params.amount1;

  const NonFungiblePositionAmountUSD = calculateTotalLiquidityUSD(
    newAmount0,
    newAmount1,
    token0,
    token1,
  );

  const updatedPosition = {
    ...position,
    amount0: newAmount0,
    amount1: newAmount1,
    amountUSD: NonFungiblePositionAmountUSD,
    lastUpdatedTimestamp: blockDatetime,
  };
  context.NonFungiblePosition.set(updatedPosition);
});
