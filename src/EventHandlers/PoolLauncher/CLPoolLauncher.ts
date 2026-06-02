import type { PoolLauncherPool } from "envio";
import { indexer } from "envio";
import { PoolId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import {
  linkPoolToPoolLauncher,
  processPoolLauncherPool,
} from "./PoolLauncherLogic";

indexer.onEvent(
  { contract: "CLPoolLauncher", event: "Launch" },
  async ({ event, context }) => {
    const poolAddress = event.params.pool;
    const launcherAddress = event.srcAddress;
    const creator = event.params.sender;
    const poolLauncherToken = event.params.poolLauncherToken;
    // poolLauncherPool struct fields: { createdAt, pool, poolLauncherToken, tokenToPair }
    const pairToken = event.params.poolLauncherPool.pool;
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

    // Link existing Pool to PoolLauncherPool
    await linkPoolToPoolLauncher(
      poolAddress,
      event.chainId,
      context,
      "CL",
      createdAt,
    );
  },
);

indexer.onEvent(
  { contract: "CLPoolLauncher", event: "Migrate" },
  async ({ event, context }) => {
    const underlyingPool = event.params.underlyingPool;
    const oldLocker = event.params.locker;
    const newLocker = event.params.newLocker;
    // newPoolLauncherPool struct fields: { createdAt, pool, poolLauncherToken, tokenToPair }
    const newPoolAddress = event.params.newPoolLauncherPool.tokenToPair;
    const poolLauncherToken =
      event.params.newPoolLauncherPool.poolLauncherToken;
    const pairToken = event.params.newPoolLauncherPool.pool;
    const timestamp = new Date(event.block.timestamp * 1000);

    const poolId = PoolId(event.chainId, underlyingPool);
    const poolLauncherPool = await getRehydrated(
      context.PoolLauncherPool,
      "PoolLauncherPool",
      poolId,
    );

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

      // Link existing Pool to PoolLauncherPool for migrated pool
      await linkPoolToPoolLauncher(
        newPoolAddress,
        event.chainId,
        context,
        "CL",
        timestamp,
      );
    } else {
      context.log.warn(
        `PoolLauncherPool not found for migration: ${underlyingPool}`,
      );
    }
  },
);

indexer.onEvent(
  { contract: "CLPoolLauncher", event: "EmergingFlagged" },
  async ({ event, context }) => {
    const poolAddress = event.params.pool;
    const timestamp = new Date(event.block.timestamp * 1000);

    const poolId = PoolId(event.chainId, poolAddress);
    const poolLauncherPool = await getRehydrated(
      context.PoolLauncherPool,
      "PoolLauncherPool",
      poolId,
    );

    if (poolLauncherPool) {
      const updatedPoolLauncherPool: PoolLauncherPool = {
        ...poolLauncherPool,
        isEmerging: true,
        lastFlagUpdateAt: timestamp,
      };

      context.PoolLauncherPool.set(updatedPoolLauncherPool);
    } else {
      context.log.warn(
        `PoolLauncherPool not found for flagging: ${poolAddress}`,
      );
    }
  },
);

indexer.onEvent(
  { contract: "CLPoolLauncher", event: "EmergingUnflagged" },
  async ({ event, context }) => {
    const poolAddress = event.params.pool;
    const timestamp = new Date(event.block.timestamp * 1000);

    const poolId = PoolId(event.chainId, poolAddress);
    const poolLauncherPool = await getRehydrated(
      context.PoolLauncherPool,
      "PoolLauncherPool",
      poolId,
    );

    if (poolLauncherPool) {
      const updatedPoolLauncherPool: PoolLauncherPool = {
        ...poolLauncherPool,
        isEmerging: false,
        lastFlagUpdateAt: timestamp,
      };

      context.PoolLauncherPool.set(updatedPoolLauncherPool);
    } else {
      context.log.warn(
        `PoolLauncherPool not found for unflagging: ${poolAddress}`,
      );
    }
  },
);

indexer.onEvent(
  { contract: "CLPoolLauncher", event: "CreationTimestampSet" },
  async ({ event, context }) => {
    const poolAddress = event.params.pool;
    const createdAt = new Date(Number(event.params.createdAt) * 1000);

    const poolId = PoolId(event.chainId, poolAddress);
    const poolLauncherPool = await getRehydrated(
      context.PoolLauncherPool,
      "PoolLauncherPool",
      poolId,
    );

    if (poolLauncherPool) {
      const updatedPoolLauncherPool: PoolLauncherPool = {
        ...poolLauncherPool,
        createdAt,
      };

      context.PoolLauncherPool.set(updatedPoolLauncherPool);
    } else {
      context.log.warn(
        `PoolLauncherPool not found for timestamp update: ${poolAddress}`,
      );
    }
  },
);

indexer.onEvent(
  { contract: "CLPoolLauncher", event: "PairableTokenAdded" },
  async ({ event, context }) => {
    const tokenAddress = event.params.token;
    const configId = PoolId(event.chainId, event.srcAddress);

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
  },
);

indexer.onEvent(
  { contract: "CLPoolLauncher", event: "PairableTokenRemoved" },
  async ({ event, context }) => {
    const tokenAddress = event.params.token;
    const configId = PoolId(event.chainId, event.srcAddress);

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
    } else {
      context.log.warn(
        `PoolLauncherConfig not found for token removal: ${configId}`,
      );
    }
  },
);

indexer.onEvent(
  { contract: "CLPoolLauncher", event: "NewPoolLauncherSet" },
  async ({ event, context }) => {
    const newPoolLauncher = event.params.newPoolLauncher;
    const oldConfigId = PoolId(event.chainId, event.srcAddress);
    const newConfigId = PoolId(event.chainId, newPoolLauncher);

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
    } else {
      context.log.warn(
        `PoolLauncherConfig not found for pool launcher update: ${oldConfigId}`,
      );
    }
  },
);
