import type { PoolLauncherPool } from "envio";
import { PoolId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { Pool } from "../../EntityTypes";
import type { handlerContext } from "../../EntityTypes";

// Helper function to create or update PoolLauncherPool entity
export async function processPoolLauncherPool(
  poolAddress: string,
  launcherAddress: string,
  creator: string,
  poolLauncherToken: string,
  pairToken: string,
  createdAt: Date,
  chainId: number,
  context: handlerContext,
): Promise<PoolLauncherPool> {
  const poolId = PoolId(chainId, poolAddress);

  let poolLauncherPool = await getRehydrated(
    context.PoolLauncherPool,
    "PoolLauncherPool",
    poolId,
  );

  if (!poolLauncherPool) {
    // Create new PoolLauncherPool
    poolLauncherPool = {
      id: poolId,
      chainId,
      underlyingPool: poolAddress,
      launcher: launcherAddress,
      creator,
      poolLauncherToken,
      pairToken,
      createdAt,
      isEmerging: false,
      lastFlagUpdateAt: createdAt,
      migratedFrom: "",
      migratedTo: "",
      oldLocker: "",
      newLocker: "",
      lastMigratedAt: createdAt,
    };
  } else {
    // Update existing PoolLauncherPool
    poolLauncherPool = {
      ...poolLauncherPool,
      launcher: launcherAddress,
      lastMigratedAt: createdAt,
    };
  }

  context.PoolLauncherPool.set(poolLauncherPool);
  return poolLauncherPool;
}

/**
 * Links an existing Pool (created by CLFactory or V2Factory) to its
 * PoolLauncherPool by stamping `poolLauncherPoolId` onto the Pool entity.
 *
 * `lastUpdatedTimestamp` is taken from the caller's block-derived time rather
 * than `new Date()`, so the field stays deterministic across re-index runs
 * (see #819).
 *
 * @param poolAddress - Address of the underlying Pool to link.
 * @param chainId - Chain the Pool lives on; combined with `poolAddress` into the entity id.
 * @param context - Envio handler context used to read/write the Pool entity.
 * @param factoryType - Which factory created the Pool ("CL" or "V2"); used only for the not-found warning.
 * @param lastUpdatedTimestamp - Block-derived time (`new Date(event.block.timestamp * 1000)`) to stamp onto the Pool.
 * @returns Promise that resolves once the linked Pool upsert is staged (no-op if the Pool does not exist yet).
 */
export async function linkPoolToPoolLauncher(
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  factoryType: "CL" | "V2",
  lastUpdatedTimestamp: Date,
): Promise<void> {
  // Load the existing Pool (created by CLFactory or V2Factory)
  const poolId = PoolId(chainId, poolAddress);
  const existingPool = await getRehydrated(context.Pool, "Pool", poolId);

  if (!existingPool) {
    context.log.warn(
      `Pool not found for pool ${poolId} - it should have been created by ${factoryType}Factory`,
    );
    return;
  }

  // Update the existing Pool to link it to PoolLauncherPool
  const updatedPool: Pool = {
    ...existingPool,
    poolLauncherPoolId: poolId,
    lastUpdatedTimestamp,
  };

  context.Pool.set(updatedPool);
}
