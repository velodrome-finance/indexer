import type { EvmEvent, FeeToTickSpacingMapping } from "envio";

/**
 * Fee diff for a TickSpacingEnabled event.
 *
 * @param event - TickSpacingEnabled from a legacy CLFactory or an AeroCLFactory
 * @returns The new fee and update timestamp
 */
export function processCLFactoryTickSpacingEnabled(
  event:
    | EvmEvent<"CLFactory", "TickSpacingEnabled">
    | EvmEvent<"AeroCLFactory", "TickSpacingEnabled">,
): Partial<FeeToTickSpacingMapping> {
  const feeToTickSpacingMappingDiff = {
    fee: BigInt(event.params.fee),
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  return feeToTickSpacingMappingDiff;
}
