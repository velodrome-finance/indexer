import type {
  LiquidityPoolAggregator,
  PoolLauncherPool,
  handlerContext,
} from "generated";

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
  const poolId = `${chainId}-${poolAddress.toLowerCase()}`;

  let poolLauncherPool = await context.PoolLauncherPool.get(poolId);

  if (!poolLauncherPool) {
    // Create new PoolLauncherPool
    poolLauncherPool = {
      id: poolId,
      chainId,
      underlyingPool: poolAddress.toLowerCase(),
      launcher: launcherAddress.toLowerCase(),
      creator: creator.toLowerCase(),
      poolLauncherToken: poolLauncherToken.toLowerCase(),
      pairToken: pairToken.toLowerCase(),
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
      launcher: launcherAddress.toLowerCase(),
      lastMigratedAt: createdAt,
    };
  }

  context.PoolLauncherPool.set(poolLauncherPool);
  return poolLauncherPool;
}

// Helper function to link existing LiquidityPoolAggregator to PoolLauncherPool
export async function linkLiquidityPoolAggregatorToPoolLauncher(
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  factoryType: "CL" | "V2",
): Promise<void> {
  // Load the existing LiquidityPoolAggregator (created by CLFactory or V2Factory)
  const existingLiquidityPoolAggregator =
    await context.LiquidityPoolAggregator.get(poolAddress.toLowerCase());

  if (!existingLiquidityPoolAggregator) {
    context.log.warn(
      `LiquidityPoolAggregator not found for pool ${poolAddress} - it should have been created by ${factoryType}Factory`,
    );
    return;
  }

  // Update the existing LiquidityPoolAggregator to link it to PoolLauncherPool
  const updatedLiquidityPoolAggregator: LiquidityPoolAggregator = {
    ...existingLiquidityPoolAggregator,
    poolLauncherPoolId: `${chainId}-${poolAddress.toLowerCase()}`,
    lastUpdatedTimestamp: new Date(),
  };

  context.LiquidityPoolAggregator.set(updatedLiquidityPoolAggregator);
}
