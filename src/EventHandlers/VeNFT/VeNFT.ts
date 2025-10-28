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

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  if (!veNFTAggregator) {
    context.log.error(
      `VeNFTAggregator ${tokenId} not found during VeNFT withdraw on chain ${event.chainId}`,
    );
    return;
  }

  // Process withdraw event using business logic
  const result = await processVeNFTEvent(event, veNFTAggregator);

  // Apply VeNFT aggregator updates
  updateVeNFTAggregator(
    result.veNFTAggregatorDiff,
    veNFTAggregator,
    new Date(event.block.timestamp * 1000),
    context,
  );
});

VeNFT.Transfer.handler(async ({ event, context }) => {
  const tokenId = event.params.tokenId;

  const veNFTAggregator = await context.VeNFTAggregator.get(
    VeNFTId(event.chainId, tokenId),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  if (!veNFTAggregator) {
    context.log.error(
      `VeNFTAggregator ${tokenId} not found during VeNFT transfer on chain ${event.chainId}`,
    );
    return;
  }

  // Process transfer event using business logic
  const result = await processVeNFTEvent(event, veNFTAggregator);

  // Apply VeNFT aggregator updates
  updateVeNFTAggregator(
    result.veNFTAggregatorDiff,
    veNFTAggregator,
    new Date(event.block.timestamp * 1000),
    context,
  );
});

VeNFT.Deposit.handler(async ({ event, context }) => {
  const tokenId = event.params.tokenId;

  let veNFTAggregator = await context.VeNFTAggregator.get(
    VeNFTId(event.chainId, tokenId),
  );

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  // If no existing VeNFT, create a new one for the diff
  if (!veNFTAggregator) {
    veNFTAggregator = {
      id: VeNFTId(event.chainId, tokenId),
      chainId: event.chainId,
      tokenId: tokenId,
      owner: "",
      locktime: 0n,
      lastUpdatedTimestamp: new Date(0),
      totalValueLocked: 0n,
      isAlive: true,
    };
  }

  // Process deposit event using business logic
  const result = await processVeNFTEvent(event, veNFTAggregator);

  // Apply VeNFT aggregator updates
  updateVeNFTAggregator(
    result.veNFTAggregatorDiff,
    veNFTAggregator,
    new Date(event.block.timestamp * 1000),
    context,
  );
});
