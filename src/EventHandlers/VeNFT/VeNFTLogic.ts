import type {
  VeNFTAggregator,
  VeNFT_Deposit_event,
  VeNFT_Transfer_event,
  VeNFT_Withdraw_event,
} from "generated";
import { toChecksumAddress } from "../../Constants";

export interface VeNFTResult {
  veNFTAggregatorDiff: Partial<VeNFTAggregator>;
}

export type VeNFTEvent =
  | VeNFT_Deposit_event
  | VeNFT_Transfer_event
  | VeNFT_Withdraw_event;

/**
 * Type-safe event discriminators
 */
function isDepositEvent(event: VeNFTEvent): event is VeNFT_Deposit_event {
  return "locktime" in event.params;
}

function isTransferEvent(event: VeNFTEvent): event is VeNFT_Transfer_event {
  return "from" in event.params && "to" in event.params;
}

/**
 * Processes VeNFT events (deposit, transfer, withdraw)
 * Updates the VeNFTAggregator based on the event type
 */
export async function processVeNFTEvent(
  event: VeNFTEvent,
  currentVeNFT: VeNFTAggregator | undefined,
): Promise<VeNFTResult> {
  const timestamp = new Date(event.block.timestamp * 1000);
  const tokenId = event.params.tokenId;

  // Create base VeNFT aggregator diff
  let veNFTAggregatorDiff: Partial<VeNFTAggregator> = {
    id: `${event.chainId}_${tokenId}`,
    chainId: event.chainId,
    tokenId: tokenId,
    lastUpdatedTimestamp: timestamp,
  };

  // Handle different event types using type guards
  if (isDepositEvent(event)) {
    // Deposit event
    // Note: VeNFT entity should already exist (created during Transfer/mint event)

    const ownerChecksummedAddress = toChecksumAddress(event.params.provider);

    // Update existing VeNFT with deposit values
    veNFTAggregatorDiff = {
      ...veNFTAggregatorDiff,
      owner: ownerChecksummedAddress,
      locktime: event.params.locktime,
      totalValueLocked: event.params.value,
      isAlive: true,
    };
  } else if (isTransferEvent(event)) {
    // Transfer event

    const toChecksummedAddress = toChecksumAddress(event.params.to);

    // Update existing VeNFT owner
    veNFTAggregatorDiff = {
      ...veNFTAggregatorDiff,
      owner: toChecksummedAddress,
      locktime: currentVeNFT?.locktime ?? 0n,
      totalValueLocked: currentVeNFT?.totalValueLocked ?? 0n,
      isAlive: event.params.to !== "0x0000000000000000000000000000000000000000",
    };
  } else {
    // Withdraw event

    veNFTAggregatorDiff = {
      ...veNFTAggregatorDiff,
      owner: currentVeNFT?.owner ?? "",
      totalValueLocked: -event.params.value,
      isAlive: false,
    };
  }

  return {
    veNFTAggregatorDiff,
  };
}
