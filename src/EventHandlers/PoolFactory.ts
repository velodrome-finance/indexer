import { PoolFactory } from "generated";
import { createLiquidityPoolAggregatorEntity } from "../Aggregators/LiquidityPoolAggregator";
import { TokenIdByChain } from "../Constants";
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

  context.LiquidityPoolAggregator.set({
    ...poolEntity,
    baseFee: BigInt(event.params.fee),
    currentFee: BigInt(event.params.fee),
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  });
});
