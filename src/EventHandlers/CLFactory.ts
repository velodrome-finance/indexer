import { type EvmEvent, indexer } from "envio";
import { updateFeeToTickSpacingMapping } from "../Aggregators/FeeToTickSpacingMapping";
import {
  FeeToTickSpacingMappingId,
  POOL_DEPLOYMENT,
  type PoolDeployment,
  PoolId,
  TokenId,
  legacyPoolDeployment,
} from "../Constants";
import { getRehydrated } from "../EntityTimestamps";
import type { handlerContext } from "../EntityTypes";
import { logPerChainStubOnce } from "../PerChainStubs";
import { registerPricingPool } from "../Pricing/PoolRoute";
import {
  type CLFactoryPoolCreatedEvent,
  processCLFactoryPoolCreated,
} from "./CLFactory/CLFactoryPoolCreatedLogic";
import { processCLFactoryTickSpacingEnabled } from "./CLFactory/CLFactoryTickSpacingEnabledLogic";

/** TickSpacingEnabled from a legacy CLFactory or an AeroCLFactory (same ABI). */
type CLFactoryTickSpacingEnabledEvent =
  | EvmEvent<"CLFactory", "TickSpacingEnabled">
  | EvmEvent<"AeroCLFactory", "TickSpacingEnabled">;

/**
 * Creates the Pool for a CL PoolCreated from either CL factory contract.
 *
 * The legacy `CLFactory` and the `AeroCLFactory` emit the same PoolCreated;
 * the contract that emitted it decides `deployment`. An AERO pool is never a
 * superchain leaf pool and has no legacy gauge config, so it skips the
 * root-pool reconciliation (and its `getWhere`) and is created without the
 * chain's legacy `CLGaugeConfig`.
 *
 * @param event - The PoolCreated event
 * @param context - Handler context
 * @param deployment - Deployment of the emitting factory
 * @returns Promise that resolves once the pool, its pricing registration and
 *   (legacy only) the root-pool reconciliation are staged
 */
async function handleCLPoolCreated(
  event: CLFactoryPoolCreatedEvent,
  context: handlerContext,
  deployment: PoolDeployment,
): Promise<void> {
  const isAero = deployment === POOL_DEPLOYMENT.AERO;
  // Load token instances and any buffered Initialize state. Slipstream emits
  // CLPool.Initialize at a LOWER log index than this PoolCreated within the
  // same tx, so the Initialize handler may already have buffered
  // sqrtPriceX96/tick into CLPoolPendingInitialize.
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
    isAero
      ? undefined
      : getRehydrated(
          context.CLGaugeConfig,
          "CLGaugeConfig",
          String(event.chainId),
        ),
    getRehydrated(
      context.FeeToTickSpacingMapping,
      "FeeToTickSpacingMapping",
      FeeToTickSpacingMappingId(
        event.chainId,
        event.srcAddress,
        event.params.tickSpacing,
      ),
    ),
    context.CLPoolPendingInitialize.get(pendingInitializeId),
  ]);

  // The factory emits TickSpacingEnabled in its constructor, so the mapping should exist
  if (!feeToTickSpacingMapping) {
    context.log.error(
      `FeeToTickSpacingMapping not found for tickSpacing ${event.params.tickSpacing} of factory ${event.srcAddress} on chain ${event.chainId}. Pool creation cannot proceed.`,
    );
    return;
  }

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
    deployment,
  );

  // Drop the buffer once consumed so it cannot leak into future blocks.
  if (pendingInitialize) {
    context.CLPoolPendingInitialize.deleteUnsafe(pendingInitializeId);
  }

  // For new pool creation, set the entity directly (updatePool is for updates,
  // not creation). The pool is persisted even when a token side failed the
  // #677 bytecode gate (#865): processCLFactoryPoolCreated now carries the
  // aggregator with an empty symbol on that side instead of dropping the pool.
  context.Pool.set(result.liquidityPoolAggregator);

  // Record the pool as a pricing candidate for whichever side sits in the
  // higher pricing tier (ADR 0003).
  await registerPricingPool(
    context,
    event.chainId,
    event.params.pool,
    event.params.token0,
    event.params.token1,
  );

  // Only a legacy leaf pool can be the leaf of an Optimism root pool.
  if (!isAero && event.chainId !== 10 && event.chainId !== 8453) {
    // TODO(ADR 0009, flow E): the leaf pool's root pool is joined in ClickHouse
    // on `rootPoolMatchingHash` (stored on this Pool) and the root factory; the
    // PendingRootPoolMapping rows written by Optimism are no longer visible here.
    logPerChainStubOnce(
      context.log,
      "E",
      "CL leaf PoolCreated: no PendingRootPoolMapping flush; the leaf pool carries rootPoolMatchingHash for the ClickHouse join.",
    );
  }
}

/**
 * Records (or updates) the fee of a tick spacing for the emitting CL factory.
 *
 * @param event - TickSpacingEnabled from a legacy CLFactory or an AeroCLFactory
 * @param context - Handler context
 * @returns Promise that resolves once the mapping is staged
 */
async function handleTickSpacingEnabled(
  event: CLFactoryTickSpacingEnabledEvent,
  context: handlerContext,
): Promise<void> {
  const feeToTickSpacingMapping =
    await context.FeeToTickSpacingMapping.getOrCreate({
      id: FeeToTickSpacingMappingId(
        event.chainId,
        event.srcAddress,
        event.params.tickSpacing,
      ),
      factoryAddress: event.srcAddress,
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
}

indexer.contractRegister(
  { contract: "CLFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    context.chain.CLPool.add(event.params.pool);
  },
);

indexer.contractRegister(
  { contract: "AeroCLFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    context.chain.CLPool.add(event.params.pool);
  },
);

indexer.onEvent(
  { contract: "CLFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    await handleCLPoolCreated(
      event,
      context,
      legacyPoolDeployment(event.chainId),
    );
  },
);

indexer.onEvent(
  { contract: "AeroCLFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    await handleCLPoolCreated(event, context, POOL_DEPLOYMENT.AERO);
  },
);

indexer.onEvent(
  { contract: "CLFactory", event: "TickSpacingEnabled" },
  async ({ event, context }) => {
    await handleTickSpacingEnabled(event, context);
  },
);

indexer.onEvent(
  { contract: "AeroCLFactory", event: "TickSpacingEnabled" },
  async ({ event, context }) => {
    await handleTickSpacingEnabled(event, context);
  },
);
