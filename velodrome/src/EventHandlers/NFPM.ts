import {
    NFPM,
    NFPM_Transfer,
    NFPM_IncreaseLiquidity,
    NFPM_DecreaseLiquidity,
} from "generated";

/**
 * @title NonfungiblePositionManager
 * @notice This contract manages non-fungible tokens (NFTs) that represent positions in a liquidity pool.
 * It extends the ERC721 standard, allowing these positions to be transferred and managed as NFTs.
 * The contract provides functionalities for minting, increasing, and decreasing liquidity, as well as collecting fees.
 */

/**
 * @title NFPM Transfer
 * @event Transfer
 * @notice Emitted when an NFT is transferred, including when a new NFT is minted.
 * @param {address} from - The address of the previous owner of the token. For minting, this is the zero address.
 * @param {address} to - The address of the new owner of the token.
 * @param {uint256} tokenId - The ID of the token being transferred.
 */
NFPM.Transfer.handler(async ({ event, context }) => {
  const blockDatetime = new Date(event.block.timestamp * 1000);
  const entity: NFPM_Transfer = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    transactionHash: event.transaction.hash,
    from: event.params.from,
    to: event.params.to,
    tokenId: event.params.tokenId,
    timestamp: blockDatetime,
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
  };

  context.NFPM_Transfer.set(entity);
});

NFPM.IncreaseLiquidity.handler(async ({ event, context }) => {
  const blockDatetime = new Date(event.block.timestamp * 1000);
  const entity: NFPM_IncreaseLiquidity = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    transactionHash: event.transaction.hash,
    tokenId: event.params.tokenId,
    liquidity: event.params.liquidity,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    timestamp: blockDatetime,
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
  };

  context.NFPM_IncreaseLiquidity.set(entity);
});

NFPM.DecreaseLiquidity.handler(async ({ event, context }) => {
  const blockDatetime = new Date(event.block.timestamp * 1000);
  const entity: NFPM_DecreaseLiquidity = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    transactionHash: event.transaction.hash,
    tokenId: event.params.tokenId,
    liquidity: event.params.liquidity,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    timestamp: blockDatetime,
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
  };

  context.NFPM_DecreaseLiquidity.set(entity);
});