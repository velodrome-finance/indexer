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

  // Get current position
  const position = await context.NonFungiblePosition.get(positionId);

  if (!position) {
    context.log.error(
      `NonFungiblePosition ${positionId} not found during transfer on chain ${event.chainId}`,
    );
    return;
  }

  // Get token entities to calculate USD value
  const token0 = await context.Token.get(`${event.chainId}_${position.token0}`);
  const token1 = await context.Token.get(`${event.chainId}_${position.token1}`);

  if (context.isPreload) {
    return;
  }

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
    await context.NonFungiblePosition.getWhere.transactionHash.eq(
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

  if (context.isPreload) {
    return;
  }

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

  const position = await context.NonFungiblePosition.get(positionId);

  if (!position) {
    context.log.error(
      `NonFungiblePosition ${positionId} not found during decrease liquidity on chain ${event.chainId}`,
    );
    return;
  }

  // Get token entities to calculate USD value
  const token0 = await context.Token.get(`${event.chainId}_${position.token0}`);
  const token1 = await context.Token.get(`${event.chainId}_${position.token1}`);

  if (context.isPreload) {
    return;
  }

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
