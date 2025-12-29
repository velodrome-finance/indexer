import { VeNFT } from "generated";
import {
  VeNFTId,
  updateVeNFTAggregator,
} from "../../Aggregators/VeNFTAggregator";
import { processVeNFTEvent } from "./VeNFTLogic";

VeNFT.Withdraw.handler(async ({ event, context }) => {
  const tokenId = event.params.tokenId;

  const veNFTAggregator = await context.VeNFTAggregator.get(
    VeNFTId(event.chainId, tokenId),
  );

  if (!veNFTAggregator) {
    context.log.error(
      `VeNFTAggregator ${tokenId} not found during VeNFT withdraw on chain ${event.chainId}`,
    );
    return;
  }

  // Process withdraw event using business logic
  const veNFTAggregatorDiff = await processVeNFTEvent(event, veNFTAggregator);

  // Apply VeNFT aggregator updates
  updateVeNFTAggregator(
    veNFTAggregatorDiff,
    veNFTAggregator,
    new Date(event.block.timestamp * 1000),
    context,
  );
});

// This event normally appears before Deposit event, therefore it is the one actually responsible
// For creating the VeNFTAggregator entity
VeNFT.Transfer.handler(async ({ event, context }) => {
  const tokenId = event.params.tokenId;

  // VeNFT minting operation
  if (event.params.from === "0x0000000000000000000000000000000000000000") {
    context.VeNFTAggregator.set({
      id: VeNFTId(event.chainId, tokenId),
      chainId: event.chainId,
      tokenId: tokenId,
      owner: event.params.to,
      locktime: 0n, // This is going to be updated in the Deposit event
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      totalValueLocked: 0n, // This is going to be updated in the Deposit event
      isAlive: true,
    });

    return;
  }

  const veNFTAggregator = await context.VeNFTAggregator.get(
    VeNFTId(event.chainId, tokenId),
  );

  if (!veNFTAggregator) {
    context.log.error(
      `VeNFTAggregator ${tokenId} not found during VeNFT transfer on chain ${event.chainId}`,
    );
    return;
  }

  // Process transfer event using business logic
  const veNFTAggregatorDiff = await processVeNFTEvent(event, veNFTAggregator);

  // Apply VeNFT aggregator updates
  updateVeNFTAggregator(
    veNFTAggregatorDiff,
    veNFTAggregator,
    new Date(event.block.timestamp * 1000),
    context,
  );
});

VeNFT.Deposit.handler(async ({ event, context }) => {
  const tokenId = event.params.tokenId;

  const veNFTAggregator = await context.VeNFTAggregator.get(
    VeNFTId(event.chainId, tokenId),
  );

  // Should exist because Transfer event typically come before Deposit event
  if (!veNFTAggregator) {
    context.log.error(
      `VeNFTAggregator ${tokenId} not found during VeNFT deposit on chain ${event.chainId}`,
    );
    return;
  }

  // Process deposit event using business logic
  const veNFTAggregatorDiff = await processVeNFTEvent(event, veNFTAggregator);

  // Apply VeNFT aggregator updates
  updateVeNFTAggregator(
    veNFTAggregatorDiff,
    veNFTAggregator,
    new Date(event.block.timestamp * 1000),
    context,
  );
});
