import { NFPM } from "generated";
import { processNFPMDecreaseLiquidity } from "./NFPMDecreaseLiquidityLogic";
import { processNFPMIncreaseLiquidity } from "./NFPMIncreaseLiquidityLogic";
import { processNFPMTransfer } from "./NFPMTransferLogic";

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
  await processNFPMTransfer(event, context);
});

// This event is emitted when mints and liquidity increases
// However, mint-related entity creation of NonFungiblePosition is handled CLPool module
NFPM.IncreaseLiquidity.handler(async ({ event, context }) => {
  await processNFPMIncreaseLiquidity(event, context);
});

NFPM.DecreaseLiquidity.handler(async ({ event, context }) => {
  await processNFPMDecreaseLiquidity(event, context);
});
