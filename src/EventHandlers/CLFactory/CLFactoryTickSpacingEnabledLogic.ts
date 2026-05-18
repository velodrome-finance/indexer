import type { FeeToTickSpacingMapping } from "envio";
import type { CLFactory_TickSpacingEnabled_event } from "../../EntityTypes";

export function processCLFactoryTickSpacingEnabled(
  event: CLFactory_TickSpacingEnabled_event,
): Partial<FeeToTickSpacingMapping> {
  const feeToTickSpacingMappingDiff = {
    fee: BigInt(event.params.fee),
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  return feeToTickSpacingMappingDiff;
}
