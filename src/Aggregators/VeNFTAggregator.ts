import type {
  VeNFT_Deposit,
  VeNFT_Transfer,
  VeNFT_Withdraw,
  handlerContext,
} from "generated";
import type { VeNFTAggregator } from "generated";

export const VeNFTId = (chainId: number, tokenId: bigint) =>
  `${chainId}_${tokenId}`;

export function depositVeNFT(
  deposit: VeNFT_Deposit,
  current: VeNFTAggregator | undefined,
  timestamp: Date,
  context: handlerContext,
) {
  const diff = {
    id: VeNFTId(deposit.chainId, deposit.tokenId),
    chainId: deposit.chainId,
    tokenId: deposit.tokenId,
    owner: "",
    locktime: deposit.locktime,
    lastUpdatedTimestamp: timestamp,
    totalValueLocked: deposit.value,
    isAlive: true,
    ...current,
  };
  if (current) {
    diff.totalValueLocked += current.totalValueLocked;
  }

  const veNFTAggregator: VeNFTAggregator = {
    ...current,
    ...diff,
    lastUpdatedTimestamp: timestamp,
  };
  context.VeNFTAggregator.set(veNFTAggregator);
}

export function withdrawVeNFT(
  withdraw: VeNFT_Withdraw,
  current: VeNFTAggregator | undefined,
  timestamp: Date,
  context: handlerContext,
) {
  const diff = {
    id: VeNFTId(withdraw.chainId, withdraw.tokenId),
    chainId: withdraw.chainId,
    tokenId: withdraw.tokenId,
    owner: "",
    locktime: 0n,
    lastUpdatedTimestamp: timestamp,
    totalValueLocked: 0n,
    isAlive: true,
    ...current,
  };
  if (current) {
    diff.totalValueLocked -= current.totalValueLocked;
  }

  const veNFTAggregator: VeNFTAggregator = {
    ...current,
    ...diff,
    lastUpdatedTimestamp: timestamp,
  };
  context.VeNFTAggregator.set(veNFTAggregator);
}

export function transferVeNFT(
  transfer: VeNFT_Transfer,
  current: VeNFTAggregator | undefined,
  timestamp: Date,
  context: handlerContext,
) {
  const diff = {
    id: VeNFTId(transfer.chainId, transfer.tokenId),
    chainId: transfer.chainId,
    tokenId: transfer.tokenId,
    owner: transfer.to,
    locktime: 0n,
    lastUpdatedTimestamp: timestamp,
    totalValueLocked: 0n,
    isAlive: true,
    ...current,
  };
  if (current) {
    diff.owner = transfer.to;
  }

  if (transfer.to === "0x0000000000000000000000000000000000000000") {
    diff.isAlive = false;
  }

  const veNFTAggregator: VeNFTAggregator = {
    ...current,
    ...diff,
    lastUpdatedTimestamp: timestamp,
  };
  context.VeNFTAggregator.set(veNFTAggregator);
}
