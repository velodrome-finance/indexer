import type { FeeToTickSpacingMapping } from "envio";
import type { EvmOnEventContext } from "../EntityTypes";

export async function updateFeeToTickSpacingMapping(
  current: FeeToTickSpacingMapping,
  diff: Partial<FeeToTickSpacingMapping>,
  context: EvmOnEventContext,
): Promise<void> {
  const updated: FeeToTickSpacingMapping = {
    ...current,
    fee: diff.fee ?? current.fee,
    lastUpdatedTimestamp:
      diff.lastUpdatedTimestamp ?? current.lastUpdatedTimestamp,
  };

  context.FeeToTickSpacingMapping.set(updated);
}
