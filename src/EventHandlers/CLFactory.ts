import { CLFactory } from "generated";
import { updateFeeToTickSpacingMapping } from "../Aggregators/FeeToTickSpacingMapping";
import {
  CHAIN_CONSTANTS,
  FeeToTickSpacingMappingId,
  TokenId,
} from "../Constants";
import { processCLFactoryPoolCreated } from "./CLFactory/CLFactoryPoolCreatedLogic";
import { processCLFactoryTickSpacingEnabled } from "./CLFactory/CLFactoryTickSpacingEnabledLogic";

CLFactory.PoolCreated.contractRegister(({ event, context }) => {
  context.addCLPool(event.params.pool);
});

CLFactory.PoolCreated.handler(async ({ event, context }) => {
  // Load token instances efficiently
  const [poolToken0, poolToken1, CLGaugeConfig, feeToTickSpacingMapping] =
    await Promise.all([
      context.Token.get(TokenId(event.chainId, event.params.token0)),
      context.Token.get(TokenId(event.chainId, event.params.token1)),
      context.CLGaugeConfig.get(
        CHAIN_CONSTANTS[event.chainId].newCLGaugeFactoryAddress,
      ),
      context.FeeToTickSpacingMapping.get(
        FeeToTickSpacingMappingId(event.chainId, event.params.tickSpacing),
      ),
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
    poolToken0,
    poolToken1,
    CLGaugeConfig,
    feeToTickSpacingMapping,
    context,
  );

  // For new pool creation, set the entity directly (updateLiquidityPoolAggregator is for updates, not creation)
  context.LiquidityPoolAggregator.set(result.liquidityPoolAggregator);
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
