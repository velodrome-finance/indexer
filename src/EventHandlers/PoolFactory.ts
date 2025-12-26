import { PoolFactory } from "generated";
import type { LiquidityPoolAggregator } from "generated";
import {
  createLiquidityPoolAggregatorEntity,
  updateLiquidityPoolAggregator,
} from "../Aggregators/LiquidityPoolAggregator";
import {
  ROOT_POOL_FACTORY_ADDRESS_OPTIMISM,
  TokenIdByChain,
} from "../Constants";
import { getRootPoolAddress } from "../Effects/RootPool";
import { createTokenEntity } from "../PriceOracle";
import type { TokenEntityMapping } from "./../CustomTypes";

PoolFactory.PoolCreated.contractRegister(({ event, context }) => {
  context.addPool(event.params.pool);
});

PoolFactory.PoolCreated.handler(async ({ event, context }) => {
  // Load token instances efficiently
  const [poolToken0, poolToken1] = await Promise.all([
    context.Token.get(TokenIdByChain(event.params.token0, event.chainId)),
    context.Token.get(TokenIdByChain(event.params.token1, event.chainId)),
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
    const createTokenPromises = missingTokenMappings.map((mapping) =>
      createTokenEntity(
        mapping.address,
        event.chainId,
        event.block.number,
        context,
      ).catch((error) => {
        context.log.error(
          `Error in pool factory fetching token details for ${mapping.address} on chain ${event.chainId}: ${error}`,
        );
        return null;
      }),
    );

    const createdTokens = await Promise.all(createTokenPromises);

    // Update mappings with created tokens
    for (let i = 0; i < missingTokenMappings.length; i++) {
      if (createdTokens[i]) {
        missingTokenMappings[i].tokenInstance = createdTokens[i] ?? undefined;
      }
    }
  }

  // Build symbol array
  for (const poolTokenAddressMapping of poolTokenAddressMappings) {
    if (poolTokenAddressMapping.tokenInstance) {
      poolTokenSymbols.push(poolTokenAddressMapping.tokenInstance.symbol);
    }
  }

  const pool = createLiquidityPoolAggregatorEntity({
    poolAddress: event.params.pool,
    chainId: event.chainId,
    isCL: false,
    isStable: event.params.stable,
    token0Address: event.params.token0,
    token1Address: event.params.token1,
    token0Symbol: poolTokenSymbols[0],
    token1Symbol: poolTokenSymbols[1],
    token0IsWhitelisted: poolToken0?.isWhitelisted ?? false,
    token1IsWhitelisted: poolToken1?.isWhitelisted ?? false,
    timestamp: new Date(event.block.timestamp * 1000),
  });

  // For new pool creation, set the entity directly (updateLiquidityPoolAggregator is for updates, not creation)
  context.LiquidityPoolAggregator.set(pool);

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
        type: 0, // 0 for non-CL pools
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
        id: `${rootPoolAddress}_10_${event.params.pool}_${chainId}`,
        rootChainId: 10,
        rootPoolAddress: rootPoolAddress,
        leafChainId: chainId,
        leafPoolAddress: event.params.pool,
      });
    } else {
      context.log.error(
        `Failed to get root pool address for pool ${event.params.pool} on chain ${chainId}`,
      );
      return;
    }
  }
});

PoolFactory.SetCustomFee.handler(async ({ event, context }) => {
  const poolEntity = await context.LiquidityPoolAggregator.get(
    event.params.pool,
  );

  if (!poolEntity) {
    context.log.warn(
      `Pool ${event.params.pool} not found for SetCustomFee event`,
    );
    return;
  }

  const diff: Partial<LiquidityPoolAggregator> = {
    baseFee: BigInt(event.params.fee),
    currentFee: BigInt(event.params.fee), // When custom fee is set, both baseFee and currentFee are updated
  };

  await updateLiquidityPoolAggregator(
    diff,
    poolEntity,
    new Date(event.block.timestamp * 1000),
    context,
    event.block.number,
  );
});
