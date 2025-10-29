import type { ALM_LP_Wrapper, handlerContext } from "generated";
import { toChecksumAddress } from "../Constants";

/**
 * Loads or creates an ALM_LP_Wrapper entity for a given pool and chain
 * @param poolAddress - Optional. If not provided, uses existing wrapper's pool or empty string for new entities
 */
export async function loadOrCreateALMLPWrapper(
  lpWrapperAddress: string,
  poolAddress: string | undefined,
  chainId: number,
  context: handlerContext,
  timestamp: Date,
): Promise<ALM_LP_Wrapper> {
  const lpWrapperAddressChecksummed = toChecksumAddress(lpWrapperAddress);

  const id = `${lpWrapperAddressChecksummed}_${chainId}`;

  let wrapper = await context.ALM_LP_Wrapper.get(id);

  if (!wrapper) {
    // If creating new entity, poolAddress is required
    if (!poolAddress) {
      throw new Error(
        `poolAddress is required when creating a new ALM_LP_Wrapper entity for ${id}`,
      );
    }
    const poolAddressChecksummed = toChecksumAddress(poolAddress);
    wrapper = {
      id,
      chainId,
      pool: poolAddressChecksummed,
      amount0: 0n,
      amount1: 0n,
      lpAmount: 0n,
      lastUpdatedTimestamp: timestamp,
    };
    context.ALM_LP_Wrapper.set(wrapper);
  }

  return wrapper;
}

/**
 * Generic function to update ALM_LP_Wrapper with any combination of fields
 */
export async function updateALMLPWrapper(
  diff: Partial<ALM_LP_Wrapper>,
  current: ALM_LP_Wrapper,
  timestamp: Date,
  context: handlerContext,
): Promise<void> {
  const updated: ALM_LP_Wrapper = {
    ...current,
    amount0: (diff.amount0 ?? 0n) + current.amount0,
    amount1: (diff.amount1 ?? 0n) + current.amount1,
    lpAmount: (diff.lpAmount ?? 0n) + current.lpAmount,
    lastUpdatedTimestamp: timestamp,
  };

  context.ALM_LP_Wrapper.set(updated);
}
