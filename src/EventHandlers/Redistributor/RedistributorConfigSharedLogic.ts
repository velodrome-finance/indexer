import type { handlerContext } from "generated";

/**
 * Format the composite id for a `RedistributorConfig` row.
 *
 * @param chainId - EVM chain id where the Redistributor is deployed
 * @param redistributorAddress - Redistributor contract address (event.srcAddress)
 * @returns Deterministic `{chainId}-{address}` id used for all upserts
 */
const redistributorConfigId = (
  chainId: number,
  redistributorAddress: string,
): string => `${chainId}-${redistributorAddress}`;

/**
 * Upsert the `RedistributorConfig` singleton for a given Redistributor contract.
 *
 * `SetKeeper` / `SetUpkeepManager` events fire independently, so each call patches
 * only its own field and preserves whatever was previously recorded for the
 * other. On first-ever event the row is seeded with empty strings for any
 * field that has not been observed yet.
 *
 * @param chainId - EVM chain id of the Redistributor
 * @param redistributorAddress - Redistributor contract address (srcAddress)
 * @param patch - Partial override: at most one of `keeper` / `upkeepManager`
 * @param blockTimestampSeconds - Block timestamp of the current event in seconds
 * @param context - Envio handler context used to read and stage the row
 * @returns Promise that resolves once the upsert is staged
 */
export async function applyRedistributorConfigUpdate(
  chainId: number,
  redistributorAddress: string,
  patch: { keeper?: string; upkeepManager?: string },
  blockTimestampSeconds: number,
  context: handlerContext,
): Promise<void> {
  const id = redistributorConfigId(chainId, redistributorAddress);
  const timestamp = new Date(blockTimestampSeconds * 1000);

  const existing = await context.RedistributorConfig.get(id);
  context.RedistributorConfig.set({
    ...(existing ?? {
      id,
      chainId,
      redistributorAddress,
      keeper: "",
      upkeepManager: "",
    }),
    ...patch,
    lastUpdatedTimestamp: timestamp,
  });
}
