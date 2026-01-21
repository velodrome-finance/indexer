import type { FeeToTickSpacingMapping, handlerContext } from "generated";

export async function updateFeeToTickSpacingMapping(
  current: FeeToTickSpacingMapping,
  diff: Partial<FeeToTickSpacingMapping>,
  context: handlerContext,
): Promise<void> {
  const updated: FeeToTickSpacingMapping = {
    ...current,
    fee: diff.fee ?? current.fee,
    lastUpdatedTimestamp:
      diff.lastUpdatedTimestamp ?? current.lastUpdatedTimestamp,
  };

  context.FeeToTickSpacingMapping.set(updated);
}
