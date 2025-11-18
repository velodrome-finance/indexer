import { CLPoolLauncher } from "generated";
import type { handlerContext } from "generated";
import type { PoolLauncherPool } from "generated";
import {
  linkLiquidityPoolAggregatorToPoolLauncher,
  processPoolLauncherPool,
} from "./PoolLauncherLogic";

CLPoolLauncher.Launch.handler(async ({ event, context }) => {
  const poolAddress = event.params.pool.toLowerCase();
  const launcherAddress = event.srcAddress;
  const creator = event.params.sender.toLowerCase();
  const poolLauncherToken = event.params.poolLauncherToken.toLowerCase();
  // poolLauncherPool is a tuple: [bigint, Address_t, Address_t, Address_t]
  const pairToken = event.params.poolLauncherPool[1].toLowerCase();
  const createdAt = new Date(event.block.timestamp * 1000);

  // Create or update PoolLauncherPool entity
  await processPoolLauncherPool(
    poolAddress,
    launcherAddress,
    creator,
    poolLauncherToken,
    pairToken,
    createdAt,
    event.chainId,
    context,
  );

  // Link existing LiquidityPoolAggregator to PoolLauncherPool
  await linkLiquidityPoolAggregatorToPoolLauncher(
    poolAddress,
    event.chainId,
    context,
    "CL",
  );

  context.log.info(`Pool launched: ${poolAddress} by ${creator}`);
});

CLPoolLauncher.Migrate.handler(async ({ event, context }) => {
  const underlyingPool = event.params.underlyingPool.toLowerCase();
  const oldLocker = event.params.locker.toLowerCase();
  const newLocker = event.params.newLocker.toLowerCase();
  // newPoolLauncherPool is a tuple: [bigint, Address_t, Address_t, Address_t]
  const newPoolAddress = event.params.newPoolLauncherPool[3].toLowerCase();
  const poolLauncherToken = event.params.newPoolLauncherPool[2].toLowerCase();
  const pairToken = event.params.newPoolLauncherPool[1].toLowerCase();
  const timestamp = new Date(event.block.timestamp * 1000);

  const poolId = `${event.chainId}-${underlyingPool}`;
  const poolLauncherPool = await context.PoolLauncherPool.get(poolId);

  if (poolLauncherPool) {
    // Update existing PoolLauncherPool with migration info
    const updatedPoolLauncherPool: PoolLauncherPool = {
      ...poolLauncherPool,
      migratedTo: newPoolAddress,
      oldLocker,
      newLocker,
      lastMigratedAt: timestamp,
    };

    context.PoolLauncherPool.set(updatedPoolLauncherPool);

    // Create new PoolLauncherPool for the migrated pool
    await processPoolLauncherPool(
      newPoolAddress,
      event.srcAddress,
      poolLauncherPool.creator, // Keep original creator
      poolLauncherToken,
      pairToken,
      timestamp,
      event.chainId,
      context,
    );

    // Link existing LiquidityPoolAggregator to PoolLauncherPool for migrated pool
    await linkLiquidityPoolAggregatorToPoolLauncher(
      newPoolAddress,
      event.chainId,
      context,
      "CL",
    );

    context.log.info(`Pool migrated: ${underlyingPool} -> ${newPoolAddress}`);
  } else {
    context.log.warn(
      `PoolLauncherPool not found for migration: ${underlyingPool}`,
    );
  }
});

CLPoolLauncher.EmergingFlagged.handler(async ({ event, context }) => {
  const poolAddress = event.params.pool.toLowerCase();
  const timestamp = new Date(event.block.timestamp * 1000);

  const poolId = `${event.chainId}-${poolAddress}`;
  const poolLauncherPool = await context.PoolLauncherPool.get(poolId);

  if (poolLauncherPool) {
    const updatedPoolLauncherPool: PoolLauncherPool = {
      ...poolLauncherPool,
      isEmerging: true,
      lastFlagUpdateAt: timestamp,
    };

    context.PoolLauncherPool.set(updatedPoolLauncherPool);
    context.log.info(`Pool flagged as emerging: ${poolAddress}`);
  } else {
    context.log.warn(`PoolLauncherPool not found for flagging: ${poolAddress}`);
  }
});

CLPoolLauncher.EmergingUnflagged.handler(async ({ event, context }) => {
  const poolAddress = event.params.pool.toLowerCase();
  const timestamp = new Date(event.block.timestamp * 1000);

  const poolId = `${event.chainId}-${poolAddress}`;
  const poolLauncherPool = await context.PoolLauncherPool.get(poolId);

  if (poolLauncherPool) {
    const updatedPoolLauncherPool: PoolLauncherPool = {
      ...poolLauncherPool,
      isEmerging: false,
      lastFlagUpdateAt: timestamp,
    };

    context.PoolLauncherPool.set(updatedPoolLauncherPool);
    context.log.info(`Pool unflagged as emerging: ${poolAddress}`);
  } else {
    context.log.warn(
      `PoolLauncherPool not found for unflagging: ${poolAddress}`,
    );
  }
});

CLPoolLauncher.CreationTimestampSet.handler(async ({ event, context }) => {
  const poolAddress = event.params.pool.toLowerCase();
  const createdAt = new Date(Number(event.params.createdAt) * 1000);

  const poolId = `${event.chainId}-${poolAddress}`;
  const poolLauncherPool = await context.PoolLauncherPool.get(poolId);

  if (poolLauncherPool) {
    const updatedPoolLauncherPool: PoolLauncherPool = {
      ...poolLauncherPool,
      createdAt,
    };

    context.PoolLauncherPool.set(updatedPoolLauncherPool);
    context.log.info(`Creation timestamp set for pool: ${poolAddress}`);
  } else {
    context.log.warn(
      `PoolLauncherPool not found for timestamp update: ${poolAddress}`,
    );
  }
});

CLPoolLauncher.PairableTokenAdded.handler(async ({ event, context }) => {
  const tokenAddress = event.params.token.toLowerCase();
  const configId = `${event.chainId}-${event.srcAddress}`;

  // Get or create PoolLauncherConfig
  let config = await context.PoolLauncherConfig.get(configId);

  if (!config) {
    // Create new config
    config = {
      id: configId,
      version: "CL",
      pairableTokens: [tokenAddress],
    };
  } else {
    // Add token to existing pairableTokens array (if not already present)
    if (!config.pairableTokens?.includes(tokenAddress)) {
      config = {
        ...config,
        pairableTokens: [...(config.pairableTokens || []), tokenAddress],
      };
    }
  }

  context.PoolLauncherConfig.set(config);
  context.log.info(`Pairable token added: ${tokenAddress}`);
});

CLPoolLauncher.PairableTokenRemoved.handler(async ({ event, context }) => {
  const tokenAddress = event.params.token.toLowerCase();
  const configId = `${event.chainId}-${event.srcAddress}`;

  // Get existing PoolLauncherConfig
  const config = await context.PoolLauncherConfig.get(configId);

  if (config) {
    // Remove token from pairableTokens array
    const updatedConfig = {
      ...config,
      pairableTokens: (config.pairableTokens || []).filter(
        (token: string) => token !== tokenAddress,
      ),
    };

    context.PoolLauncherConfig.set(updatedConfig);
    context.log.info(`Pairable token removed: ${tokenAddress}`);
  } else {
    context.log.warn(
      `PoolLauncherConfig not found for token removal: ${configId}`,
    );
  }
});

CLPoolLauncher.NewPoolLauncherSet.handler(async ({ event, context }) => {
  const newPoolLauncher = event.params.newPoolLauncher.toLowerCase();
  const oldConfigId = `${event.chainId}-${event.srcAddress}`;
  const newConfigId = `${event.chainId}-${newPoolLauncher}`;

  // Get the existing config
  const existingConfig = await context.PoolLauncherConfig.get(oldConfigId);

  if (existingConfig) {
    // Create new config with the new pool launcher address
    const newConfig = {
      ...existingConfig,
      id: newConfigId,
    };

    // Set the new config
    context.PoolLauncherConfig.set(newConfig);

    context.log.info(
      `New pool launcher set: ${newPoolLauncher}, config updated from ${oldConfigId} to ${newConfigId}`,
    );
  } else {
    context.log.warn(
      `PoolLauncherConfig not found for pool launcher update: ${oldConfigId}`,
    );
  }
});
