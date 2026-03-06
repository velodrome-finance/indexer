import { VeNFT } from "generated";
import { VeNFTId, ZERO_ADDRESS } from "../../Constants";
import {
  handleMintTransfer,
  processVeNFTDeposit,
  processVeNFTDepositManaged,
  processVeNFTMerge,
  processVeNFTSplit,
  processVeNFTTransfer,
  processVeNFTWithdraw,
  processVeNFTWithdrawManaged,
} from "./VeNFTLogic";

VeNFT.Withdraw.handler(async ({ event, context }) => {
  const tokenId = event.params.tokenId;

  const veNFTState = await context.VeNFTState.get(
    VeNFTId(event.chainId, tokenId),
  );

  if (!veNFTState) {
    context.log.error(
      `[VeNFT.Withdraw] VeNFTState ${tokenId} not found during VeNFT withdraw on chain ${event.chainId}`,
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
      `[VeNFT.Deposit] VeNFTState ${tokenId} not found during VeNFT deposit on chain ${event.chainId}`,
    );
    return;
  }

  // Process deposit event using business logic
  await processVeNFTDeposit(event, veNFTState, context);
});

VeNFT.Merge.handler(async ({ event, context }) => {
  const fromState = await context.VeNFTState.get(
    VeNFTId(event.chainId, event.params._from),
  );
  const toState = await context.VeNFTState.get(
    VeNFTId(event.chainId, event.params._to),
  );

  if (!fromState || !toState) {
    context.log.error(
      `[VeNFT.Merge] VeNFTState missing during VeNFT merge on chain ${event.chainId}: from=${event.params._from.toString()} exists=${Boolean(fromState)} to=${event.params._to.toString()} exists=${Boolean(toState)}`,
    );
    return;
  }

  await processVeNFTMerge(event, fromState, toState, context);
});

VeNFT.Split.handler(async ({ event, context }) => {
  const fromState = await context.VeNFTState.get(
    VeNFTId(event.chainId, event.params._from),
  );
  const token1State = await context.VeNFTState.get(
    VeNFTId(event.chainId, event.params._tokenId1),
  );
  const token2State = await context.VeNFTState.get(
    VeNFTId(event.chainId, event.params._tokenId2),
  );

  if (!fromState || !token1State || !token2State) {
    context.log.error(
      `[VeNFT.Split] VeNFTState missing during VeNFT split on chain ${event.chainId}: from=${event.params._from.toString()} exists=${Boolean(fromState)} token1=${event.params._tokenId1.toString()} exists=${Boolean(token1State)} token2=${event.params._tokenId2.toString()} exists=${Boolean(token2State)}`,
    );
    return;
  }

  await processVeNFTSplit(event, fromState, token1State, token2State, context);
});

VeNFT.DepositManaged.handler(async ({ event, context }) => {
  const tokenState = await context.VeNFTState.get(
    VeNFTId(event.chainId, event.params._tokenId),
  );
  const managedState = await context.VeNFTState.get(
    VeNFTId(event.chainId, event.params._mTokenId),
  );

  if (!tokenState || !managedState) {
    context.log.error(
      `[VeNFT.DepositManaged] VeNFTState missing during VeNFT depositManaged on chain ${event.chainId}: token=${event.params._tokenId.toString()} exists=${Boolean(tokenState)} managed=${event.params._mTokenId.toString()} exists=${Boolean(managedState)}`,
    );
    return;
  }

  await processVeNFTDepositManaged(event, tokenState, managedState, context);
});

VeNFT.WithdrawManaged.handler(async ({ event, context }) => {
  const tokenState = await context.VeNFTState.get(
    VeNFTId(event.chainId, event.params._tokenId),
  );
  const managedState = await context.VeNFTState.get(
    VeNFTId(event.chainId, event.params._mTokenId),
  );

  if (!tokenState || !managedState) {
    context.log.error(
      `[VeNFT.WithdrawManaged] VeNFTState missing during VeNFT withdrawManaged on chain ${event.chainId}: token=${event.params._tokenId.toString()} exists=${Boolean(tokenState)} managed=${event.params._mTokenId.toString()} exists=${Boolean(managedState)}`,
    );
    return;
  }

  await processVeNFTWithdrawManaged(event, tokenState, managedState, context);
});
