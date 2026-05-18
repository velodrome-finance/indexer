import type { PoolLauncherPool } from "envio";
import { PoolId } from "../../Constants";
import type { handlerContext } from "../../EntityTypes";
import type { Pool } from "../../EntityTypes";

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

  let poolLauncherPool = await context.PoolLauncherPool.get(poolId);

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

// Helper function to link existing Pool to PoolLauncherPool
export async function linkPoolToPoolLauncher(
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  factoryType: "CL" | "V2",
): Promise<void> {
  // Load the existing Pool (created by CLFactory or V2Factory)
  const poolId = PoolId(chainId, poolAddress);
  const existingPool = await context.Pool.get(poolId);

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
