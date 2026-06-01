import { indexer } from "envio";
import { updateFeeToTickSpacingMapping } from "../Aggregators/FeeToTickSpacingMapping";
import { FeeToTickSpacingMappingId, PoolId, TokenId } from "../Constants";
import { getRehydrated } from "../EntityTimestamps";
import {
  flushPendingRootPoolMappingAndVotes,
  processCLFactoryPoolCreated,
} from "./CLFactory/CLFactoryPoolCreatedLogic";
import { processCLFactoryTickSpacingEnabled } from "./CLFactory/CLFactoryTickSpacingEnabledLogic";

indexer.contractRegister(
  { contract: "CLFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    context.chain.CLPool.add(event.params.pool);
  },
);

indexer.onEvent(
  { contract: "CLFactory", event: "PoolCreated" },
  async ({ event, context }) => {
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
      getRehydrated(
        context.CLGaugeConfig,
        "CLGaugeConfig",
        String(event.chainId),
      ),
      getRehydrated(
        context.FeeToTickSpacingMapping,
        "FeeToTickSpacingMapping",
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

    // Drop the buffer once consumed so it cannot leak into future blocks
    // (also when we skip pool creation below, so a stale Initialize doesn't
    // bleed into a future PoolCreated at the same address).
    if (pendingInitialize) {
      context.CLPoolPendingInitialize.deleteUnsafe(pendingInitializeId);
    }

    // Bytecode-gate (#677): processCLFactoryPoolCreated returns null when
    // either token side is a non-contract, so we skip aggregator creation and
    // any root-pool flush to avoid persisting dangling token references.
    if (!result) {
      return;
    }

    // For new pool creation, set the entity directly (updatePool is for updates, not creation)
    context.Pool.set(result.liquidityPoolAggregator);

    await flushPendingRootPoolMappingAndVotes(
      context,
      event.chainId,
      event.params.token0,
      event.params.token1,
      event.params.tickSpacing,
      event.params.pool,
    );
  },
);

indexer.onEvent(
  { contract: "CLFactory", event: "TickSpacingEnabled" },
  async ({ event, context }) => {
    const feeToTickSpacingMapping =
      await context.FeeToTickSpacingMapping.getOrCreate({
        id: FeeToTickSpacingMappingId(event.chainId, event.params.tickSpacing),
        chainId: event.chainId,
        tickSpacing: event.params.tickSpacing,
        fee: BigInt(event.params.fee),
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      });

    const feeToTickSpacingMappingDiff =
      processCLFactoryTickSpacingEnabled(event);

    await updateFeeToTickSpacingMapping(
      feeToTickSpacingMapping,
      feeToTickSpacingMappingDiff,
      context,
    );
  },
);
