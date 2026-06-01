import type { EvmEvent, FeeToTickSpacingMapping } from "envio";

export function processCLFactoryTickSpacingEnabled(
  event: EvmEvent<"CLFactory", "TickSpacingEnabled">,
): Partial<FeeToTickSpacingMapping> {
  const feeToTickSpacingMappingDiff = {
    fee: BigInt(event.params.fee),
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  return feeToTickSpacingMappingDiff;
}
