import { VeNFT } from "generated";
import { VeNFTId } from "../../Aggregators/VeNFTState";
import { ZERO_ADDRESS } from "../../Constants";
import {
  handleMintTransfer,
  processVeNFTDeposit,
  processVeNFTTransfer,
  processVeNFTWithdraw,
} from "./VeNFTLogic";

VeNFT.Withdraw.handler(async ({ event, context }) => {
  const tokenId = event.params.tokenId;

  const veNFTState = await context.VeNFTState.get(
    VeNFTId(event.chainId, tokenId),
  );

  if (!veNFTState) {
    context.log.error(
      `VeNFTState ${tokenId} not found during VeNFT withdraw on chain ${event.chainId}`,
    );
    return;
  }

  // Process withdraw event using business logic
  await processVeNFTWithdraw(event, veNFTState, context);
});

// This event normally appears before Deposit event, therefore it is the one actually responsible
// for creating the VeNFTState entity
VeNFT.Transfer.handler(async ({ event, context }) => {
  const veNFTState = await handleMintTransfer(event, context);

  // If the event is a mint transfer, there is no reassignment of votes to do, so we can return early
  if (!veNFTState || event.params.from === ZERO_ADDRESS) {
    return;
  }

  // Process transfer event using business logic
  await processVeNFTTransfer(event, veNFTState, context);
});

VeNFT.Deposit.handler(async ({ event, context }) => {
  const tokenId = event.params.tokenId;

  const veNFTState = await context.VeNFTState.get(
    VeNFTId(event.chainId, tokenId),
  );

  // Should exist because Transfer event typically come before Deposit event
  if (!veNFTState) {
    context.log.error(
      `VeNFTState ${tokenId} not found during VeNFT deposit on chain ${event.chainId}`,
    );
    return;
  }

  // Process deposit event using business logic
  await processVeNFTDeposit(event, veNFTState, context);
});
