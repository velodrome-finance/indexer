import type { Token } from "envio";
import { indexer } from "envio";
import { createPoolEntity, updatePool } from "../Aggregators/Pool";
import {
  DEFAULT_SAMM_FEE_BPS,
  DEFAULT_VAMM_FEE_BPS,
  PoolId,
  ROOT_POOL_FACTORY_ADDRESS_OPTIMISM,
  RootPoolLeafPoolId,
  TokenId,
} from "../Constants";
import { getRootPoolAddress } from "../Effects/RootPool";
import { getRehydrated } from "../EntityTimestamps";
import type { Pool } from "../EntityTypes";
import { createTokenEntity } from "../PriceOracle";
import type { TokenEntityMapping } from "./../CustomTypes";
import { flushPendingVotesAndDistributionsForRootPool } from "./Voter/CrossChainPendingResolution";

indexer.contractRegister(
  { contract: "PoolFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    context.chain.Pool.add(event.params.pool);
  },
);

indexer.onEvent(
  { contract: "PoolFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    // Load token instances efficiently
    const [poolToken0, poolToken1] = await Promise.all([
      getRehydrated(
        context.Token,
        "Token",
        TokenId(event.chainId, event.params.token0),
      ),
      getRehydrated(
        context.Token,
        "Token",
        TokenId(event.chainId, event.params.token1),
      ),
    ]);

    const poolTokenSymbols: string[] = [];
    const poolTokenAddressMappings: TokenEntityMapping[] = [
      { address: event.params.token0, tokenInstance: poolToken0 },
      { address: event.params.token1, tokenInstance: poolToken1 },
    ];

    // Collect missing tokens and create them in parallel for better performance
    const missingTokenMappings = poolTokenAddressMappings.filter(
      (mapping) => mapping.tokenInstance === undefined,
    );

    if (missingTokenMappings.length > 0) {
      // createTokenEntity returns `null` only when the bytecode gate confirms
      // the address is a non-contract (issue #677). Distinguish that from a
      // thrown error (transient RPC failure) which `.catch` maps to `undefined`
      // — only the former triggers the pool-boundary skip below.
      const createTokenPromises = missingTokenMappings.map(
        (mapping): Promise<Token | null | undefined> =>
          createTokenEntity(
            mapping.address,
            event.chainId,
            event.block.number,
            context,
            event.block.timestamp,
          ).catch((error) => {
            context.log.error(
              `Error in pool factory fetching token details for ${mapping.address} on chain ${event.chainId}: ${error}`,
            );
            return undefined;
          }),
      );

      const createdTokens = await Promise.all(createTokenPromises);

      for (let i = 0; i < missingTokenMappings.length; i++) {
        const created = createdTokens[i];
        if (created === null) {
          context.log.warn(
            `[PoolFactory.PoolCreated] Skipping Pool for pool ${event.params.pool} on chain ${event.chainId} — non-contract token side`,
          );
          return;
        }
        if (created !== undefined) {
          missingTokenMappings[i].tokenInstance = created;
        }
      }
    }

    // Build symbol array
    for (const poolTokenAddressMapping of poolTokenAddressMappings) {
      if (poolTokenAddressMapping.tokenInstance) {
        poolTokenSymbols.push(poolTokenAddressMapping.tokenInstance.symbol);
      }
    }

    const fee = event.params.stable
      ? DEFAULT_SAMM_FEE_BPS
      : DEFAULT_VAMM_FEE_BPS;

    const pool = createPoolEntity({
      poolAddress: event.params.pool,
      chainId: event.chainId,
      isCL: false,
      isStable: event.params.stable,
      token0Address: event.params.token0,
      token1Address: event.params.token1,
      token0Symbol: poolTokenSymbols[0],
      token1Symbol: poolTokenSymbols[1],
      timestamp: new Date(event.block.timestamp * 1000),
      factoryAddress: event.srcAddress,
      baseFee: fee,
      currentFee: fee,
      createdBlockNumber: BigInt(event.block.number),
    });

    // For new pool creation, set the entity directly (updatePool is for updates, not creation)
    context.Pool.set(pool);

    // For non-Optimism and non-Base pools, set the RootPool_LeafPool entity
    // Mapping RootPool (on optimism) to Pool (on superchain)
    // This is only need for non-CL pools
    // The mapping between RootCLPool and CLPool is made in RootCLPoolFactory.ts without the need of a RPC call
    // RPC call is needed here because RootPoolCreated event for non-CL pools doesn't have leafChainId
    const chainId: number = event.chainId;
    if (chainId !== 10 && chainId !== 8453) {
      let rootPoolAddress: string | null = null;
      try {
        rootPoolAddress = await context.effect(getRootPoolAddress, {
          chainId: chainId,
          factory: ROOT_POOL_FACTORY_ADDRESS_OPTIMISM,
          token0: event.params.token0,
          token1: event.params.token1,
          type: event.params.stable ? 0 : -1, // -1 for vAMM pools, 0 for sAMM pools, or the tick spacing value for CL pools
        });
      } catch (error) {
        context.log.error(
          `Error fetching root pool address for pool ${event.params.pool} on chain ${chainId}: ${error}`,
        );
        // Continue execution - pool is already created, just skip RootPool_LeafPool creation
        return;
      }

      if (rootPoolAddress) {
        context.RootPool_LeafPool.set({
          id: RootPoolLeafPoolId(
            10,
            chainId,
            rootPoolAddress,
            event.params.pool,
          ),
          rootChainId: 10,
          rootPoolAddress: rootPoolAddress,
          leafChainId: chainId,
          leafPoolAddress: event.params.pool,
        });
        await flushPendingVotesAndDistributionsForRootPool(
          context,
          rootPoolAddress,
          "[PoolFactory.PoolCreated]",
        );
      } else {
        context.log.error(
          `[PoolFactory.PoolCreated] Failed to get root pool address for pool ${event.params.pool} on chain ${chainId}`,
        );
        return;
      }
    }
  },
);

indexer.onEvent(
  { contract: "PoolFactory", event: "SetCustomFee" },
  async ({ event, context }) => {
    const poolId = PoolId(event.chainId, event.params.pool);
    const poolEntity = await getRehydrated(context.Pool, "Pool", poolId);

    if (!poolEntity) {
      context.log.warn(`Pool ${poolId} not found for SetCustomFee event`);
      return;
    }

    const diff: Partial<Pool> = {
      baseFee: BigInt(event.params.fee),
      currentFee: BigInt(event.params.fee), // When custom fee is set, both baseFee and currentFee are updated
    };

    await updatePool(
      diff,
      poolEntity,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  },
);
