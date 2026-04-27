import { CLFactory } from "generated";
import { updateFeeToTickSpacingMapping } from "../Aggregators/FeeToTickSpacingMapping";
import { FeeToTickSpacingMappingId, PoolId, TokenId } from "../Constants";
import {
  flushPendingRootPoolMappingAndVotes,
  processCLFactoryPoolCreated,
} from "./CLFactory/CLFactoryPoolCreatedLogic";
import { processCLFactoryTickSpacingEnabled } from "./CLFactory/CLFactoryTickSpacingEnabledLogic";

CLFactory.PoolCreated.contractRegister(({ event, context }) => {
  context.addCLPool(event.params.pool);
});

CLFactory.PoolCreated.handler(async ({ event, context }) => {
  // Load token instances and any buffered Initialize state. Aerodrome
  // Slipstream emits CLPool.Initialize at a LOWER log index than this
  // PoolCreated within the same tx, so the Initialize handler may already
  // have buffered sqrtPriceX96/tick into CLPoolPendingInitialize.
  const pendingInitializeId = PoolId(event.chainId, event.params.pool);
  const [
    poolToken0,
    poolToken1,
    CLGaugeConfig,
    feeToTickSpacingMapping,
    pendingInitialize,
  ] = await Promise.all([
    context.Token.get(TokenId(event.chainId, event.params.token0)),
    context.Token.get(TokenId(event.chainId, event.params.token1)),
    context.CLGaugeConfig.get(String(event.chainId)),
    context.FeeToTickSpacingMapping.get(
      FeeToTickSpacingMappingId(event.chainId, event.params.tickSpacing),
    ),
    context.CLPoolPendingInitialize.get(pendingInitializeId),
  ]);

  // CLFactory emits TickSpacingEnabled events in its constructor, so feeToTickSpacingMapping should exist
  if (!feeToTickSpacingMapping) {
    context.log.error(
      `FeeToTickSpacingMapping not found for tickSpacing ${event.params.tickSpacing} on chain ${event.chainId}. Pool creation cannot proceed.`,
    );
    return;
  }

  // Process the pool created event
  const result = await processCLFactoryPoolCreated(
    event,
    event.srcAddress,
    poolToken0,
    poolToken1,
    CLGaugeConfig,
    feeToTickSpacingMapping,
    context,
    pendingInitialize
      ? {
          sqrtPriceX96: pendingInitialize.sqrtPriceX96,
          tick: pendingInitialize.tick,
        }
      : undefined,
  );

  // For new pool creation, set the entity directly (updateLiquidityPoolAggregator is for updates, not creation)
  context.LiquidityPoolAggregator.set(result.liquidityPoolAggregator);

  // Drop the buffer once consumed so it cannot leak into future blocks.
  if (pendingInitialize) {
    context.CLPoolPendingInitialize.deleteUnsafe(pendingInitializeId);
  }

  await flushPendingRootPoolMappingAndVotes(
    context,
    event.chainId,
    event.params.token0,
    event.params.token1,
    event.params.tickSpacing,
    event.params.pool,
  );
});

CLFactory.TickSpacingEnabled.handler(async ({ event, context }) => {
  const feeToTickSpacingMapping =
    await context.FeeToTickSpacingMapping.getOrCreate({
      id: FeeToTickSpacingMappingId(event.chainId, event.params.tickSpacing),
      chainId: event.chainId,
      tickSpacing: event.params.tickSpacing,
      fee: BigInt(event.params.fee),
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    });

  const feeToTickSpacingMappingDiff = processCLFactoryTickSpacingEnabled(event);

  await updateFeeToTickSpacingMapping(
    feeToTickSpacingMapping,
    feeToTickSpacingMappingDiff,
    context,
  );
});
