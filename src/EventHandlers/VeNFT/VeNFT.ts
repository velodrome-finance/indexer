import { indexer } from "envio";
import { VeNFTId, ZERO_ADDRESS } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import {
  handleMintTransfer,
  processVeNFTDeposit,
  processVeNFTDepositManaged,
  processVeNFTLockPermanent,
  processVeNFTMerge,
  processVeNFTSplit,
  processVeNFTTransfer,
  processVeNFTUnlockPermanent,
  processVeNFTWithdraw,
  processVeNFTWithdrawManaged,
} from "./VeNFTLogic";

indexer.onEvent(
  { contract: "VeNFT", event: "Withdraw" },
  async ({ event, context }) => {
    const tokenId = event.params.tokenId;

    const veNFTState = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
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
  },
);

// This event normally appears before Deposit event, therefore it is the one actually responsible
// for creating the VeNFTState entity
indexer.onEvent(
  { contract: "VeNFT", event: "Transfer" },
  async ({ event, context }) => {
    const veNFTState = await handleMintTransfer(event, context);

    // If the event is a mint transfer, there is no reassignment of votes to do, so we can return early
    if (!veNFTState || event.params.from === ZERO_ADDRESS) {
      return;
    }

    // Process transfer event using business logic
    await processVeNFTTransfer(event, veNFTState, context);
  },
);

indexer.onEvent(
  { contract: "VeNFT", event: "Deposit" },
  async ({ event, context }) => {
    const tokenId = event.params.tokenId;

    const veNFTState = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
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
  },
);

indexer.onEvent(
  { contract: "VeNFT", event: "Merge" },
  async ({ event, context }) => {
    const fromState = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
      VeNFTId(event.chainId, event.params._from),
    );
    const toState = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
      VeNFTId(event.chainId, event.params._to),
    );

    if (!fromState || !toState) {
      context.log.error(
        `[VeNFT.Merge] VeNFTState missing during VeNFT merge on chain ${event.chainId}: from=${event.params._from.toString()} exists=${Boolean(fromState)} to=${event.params._to.toString()} exists=${Boolean(toState)}`,
      );
      return;
    }

    await processVeNFTMerge(event, fromState, toState, context);
  },
);

indexer.onEvent(
  { contract: "VeNFT", event: "Split" },
  async ({ event, context }) => {
    const fromState = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
      VeNFTId(event.chainId, event.params._from),
    );
    const token1State = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
      VeNFTId(event.chainId, event.params._tokenId1),
    );
    const token2State = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
      VeNFTId(event.chainId, event.params._tokenId2),
    );

    if (!fromState || !token1State || !token2State) {
      context.log.error(
        `[VeNFT.Split] VeNFTState missing during VeNFT split on chain ${event.chainId}: from=${event.params._from.toString()} exists=${Boolean(fromState)} token1=${event.params._tokenId1.toString()} exists=${Boolean(token1State)} token2=${event.params._tokenId2.toString()} exists=${Boolean(token2State)}`,
      );
      return;
    }

    await processVeNFTSplit(
      event,
      fromState,
      token1State,
      token2State,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "VeNFT", event: "DepositManaged" },
  async ({ event, context }) => {
    const tokenState = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
      VeNFTId(event.chainId, event.params._tokenId),
    );
    const managedState = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
      VeNFTId(event.chainId, event.params._mTokenId),
    );

    if (!tokenState || !managedState) {
      context.log.error(
        `[VeNFT.DepositManaged] VeNFTState missing during VeNFT depositManaged on chain ${event.chainId}: token=${event.params._tokenId.toString()} exists=${Boolean(tokenState)} managed=${event.params._mTokenId.toString()} exists=${Boolean(managedState)}`,
      );
      return;
    }

    await processVeNFTDepositManaged(event, tokenState, managedState, context);
  },
);

indexer.onEvent(
  { contract: "VeNFT", event: "LockPermanent" },
  async ({ event, context }) => {
    const veNFTState = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
      VeNFTId(event.chainId, event.params._tokenId),
    );

    if (!veNFTState) {
      context.log.error(
        `[VeNFT.LockPermanent] VeNFTState ${event.params._tokenId} not found during VeNFT lockPermanent on chain ${event.chainId}`,
      );
      return;
    }

    await processVeNFTLockPermanent(event, veNFTState, context);
  },
);

indexer.onEvent(
  { contract: "VeNFT", event: "UnlockPermanent" },
  async ({ event, context }) => {
    const veNFTState = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
      VeNFTId(event.chainId, event.params._tokenId),
    );

    if (!veNFTState) {
      context.log.error(
        `[VeNFT.UnlockPermanent] VeNFTState ${event.params._tokenId} not found during VeNFT unlockPermanent on chain ${event.chainId}`,
      );
      return;
    }

    await processVeNFTUnlockPermanent(event, veNFTState, context);
  },
);

indexer.onEvent(
  { contract: "VeNFT", event: "WithdrawManaged" },
  async ({ event, context }) => {
    const tokenState = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
      VeNFTId(event.chainId, event.params._tokenId),
    );
    const managedState = await getRehydrated(
      context.VeNFTState,
      "VeNFTState",
      VeNFTId(event.chainId, event.params._mTokenId),
    );

    if (!tokenState || !managedState) {
      context.log.error(
        `[VeNFT.WithdrawManaged] VeNFTState missing during VeNFT withdrawManaged on chain ${event.chainId}: token=${event.params._tokenId.toString()} exists=${Boolean(tokenState)} managed=${event.params._mTokenId.toString()} exists=${Boolean(managedState)}`,
      );
      return;
    }

    await processVeNFTWithdrawManaged(event, tokenState, managedState, context);
  },
);
