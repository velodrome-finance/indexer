import {
    VeNFT,
    VeNFT_Deposit,
    VeNFT_Withdraw,
    VeNFT_Transfer,
} from "generated";
import { VeNFTId, depositVeNFT, withdrawVeNFT, transferVeNFT } from "../Aggregators/VeNFTAggregator";

VeNFT.Withdraw.handlerWithLoader({
  loader: async ({ event, context }) => {
    const tokenId = event.params.tokenId;

    const veNFTAggregator = await context.VeNFTAggregator.get(VeNFTId(event.chainId, tokenId));

    if (!veNFTAggregator) {
      context.log.error(`VeNFTAggregator ${tokenId} not found during VeNFT transfer on chain ${event.chainId}`);
      return { };
    }

    return { veNFTAggregator };
  },
  handler: async ({ event, context, loaderReturn }) => {
    const { veNFTAggregator } = loaderReturn;
    const tokenId = event.params.tokenId;
    const entity_withdraw: VeNFT_Withdraw = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      provider: event.params.provider,
      tokenId: event.params.tokenId,
      value: event.params.value,
      ts: event.params.ts,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
      transactionHash: event.transaction.hash
    };

    context.VeNFT_Withdraw.set(entity_withdraw);

    withdrawVeNFT(entity_withdraw, veNFTAggregator, new Date(event.block.timestamp * 1000), context);
  },
});

VeNFT.Transfer.handlerWithLoader({
  loader: async ({ event, context }) => {
    const tokenId = event.params.tokenId;

    const veNFTAggregator = await context.VeNFTAggregator.get(VeNFTId(event.chainId, tokenId));

    if (!veNFTAggregator) {
      context.log.error(`VeNFTAggregator ${tokenId} not found during VeNFT transfer on chain ${event.chainId}`);
      return { };
    }

    return { veNFTAggregator };
  },
  handler: async ({ event, context, loaderReturn }) => {
    const { veNFTAggregator } = loaderReturn;
    const tokenId = event.params.tokenId;
    const entity_transfer: VeNFT_Transfer = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      from: event.params.from,
      to: event.params.to,
      tokenId: event.params.tokenId,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
      transactionHash: event.transaction.hash
    };

    context.VeNFT_Transfer.set(entity_transfer);

    transferVeNFT(entity_transfer, veNFTAggregator, new Date(event.block.timestamp * 1000), context);
  },
});

VeNFT.Deposit.handlerWithLoader({
  loader: async ({ event, context }) => {
    const tokenId = event.params.tokenId;

    const veNFTAggregator = await context.VeNFTAggregator.get(VeNFTId(event.chainId, tokenId));

    if (!veNFTAggregator) {
      context.log.error(`VeNFTAggregator ${tokenId} not found during VeNFT transfer on chain ${event.chainId}`);
      return { };
    }

    return { veNFTAggregator };
  },
  handler: async ({ event, context, loaderReturn }) => {
    const { veNFTAggregator } = loaderReturn;
    const tokenId = event.params.tokenId;

    const entity_deposit: VeNFT_Deposit = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      tokenId: event.params.tokenId,
      value: event.params.value,
      locktime: event.params.locktime,
      depositType: event.params.depositType,
      provider: event.params.provider,
      ts: event.params.ts,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
      transactionHash: event.transaction.hash
    };

    context.VeNFT_Deposit.set(entity_deposit);

    depositVeNFT(entity_deposit, veNFTAggregator, new Date(event.block.timestamp * 1000), context);
  },
});
