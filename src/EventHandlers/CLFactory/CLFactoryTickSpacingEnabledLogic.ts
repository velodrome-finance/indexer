import type {
  CLFactory_TickSpacingEnabled_event,
  FeeToTickSpacingMapping,
} from "generated";

export function processCLFactoryTickSpacingEnabled(
  event: CLFactory_TickSpacingEnabled_event,
): Partial<FeeToTickSpacingMapping> {
  const feeToTickSpacingMappingDiff = {
    fee: BigInt(event.params.fee),
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  return feeToTickSpacingMappingDiff;
}
