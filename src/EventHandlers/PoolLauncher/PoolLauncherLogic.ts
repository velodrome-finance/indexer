import type { PoolLauncherPool } from "envio";
import { PoolId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { Pool } from "../../EntityTypes";
import type { handlerContext } from "../../EntityTypes";

/**
 * Creates or updates the PoolLauncherPool entity for a launched or migrated pool.
 *
 * On create, `migratedFrom` records the source pool when this pool is the target of a
 * Migrate (and stays "" for Launch-created pools). On update, the existing `migratedFrom`
 * is preserved by the spread — migration lineage is stamped only at creation, so
 * re-processing an already-known pool never rewrites it.
 *
 * @param poolAddress - underlying pool address; becomes the entity's underlyingPool and (with chainId) its id
 * @param launcherAddress - pool launcher contract that emitted the event
 * @param creator - original launch sender (preserved across migration)
 * @param poolLauncherToken - the launched "project" token
 * @param pairToken - whitelisted pair token (e.g. WETH, USDC)
 * @param createdAt - block timestamp of the triggering event
 * @param chainId - chain the pool lives on
 * @param context - Envio handler context used to read and stage the entity
 * @param migratedFrom - source underlying pool when created as a Migrate target; "" for Launch
 * @returns the created or updated PoolLauncherPool (already staged via context.PoolLauncherPool.set)
 */
export async function processPoolLauncherPool(
  poolAddress: string,
  launcherAddress: string,
  creator: string,
  poolLauncherToken: string,
  pairToken: string,
  createdAt: Date,
  chainId: number,
  context: handlerContext,
  migratedFrom = "",
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
      migratedFrom,
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

// Helper function to link existing Pool to PoolLauncherPool
export async function linkPoolToPoolLauncher(
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  factoryType: "CL" | "V2",
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
    lastUpdatedTimestamp: new Date(),
  };

  context.Pool.set(updatedPool);
}
