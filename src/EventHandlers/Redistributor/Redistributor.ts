import { Redistributor, type handlerContext } from "generated";
import {
  type LiquidityPoolAggregatorDiff,
  updateLiquidityPoolAggregator,
} from "../../Aggregators/LiquidityPoolAggregator";
import { applyRedistributorConfigUpdate } from "./RedistributorConfigSharedLogic";

type RedistributorCounterDelta = Partial<
  Pick<
    LiquidityPoolAggregatorDiff,
    | "incrementalTotalEmissionsRedistributed"
    | "incrementalTotalEmissionsForfeited"
  >
>;

/**
 * Resolve the `LiquidityPoolAggregator` whose `gaugeAddress` matches the event's
 * gauge and apply a cumulative delta to one of the redistributor counters.
 *
 * Log-and-drop when no pool matches: Redistributor and the Voter/Gauge factories
 * are same-chain, so `Voter.GaugeCreated` must have indexed before any
 * `Deposited`/`Redistributed` can fire for that gauge on-chain. A missing
 * mapping therefore signals a config gap (e.g. Voter not wired in `config.yaml`),
 * not a race.
 *
 * @param gauge - Gauge address emitted by the Redistributor event
 * @param delta - Partial diff to apply (only one of the two redistributor counters)
 * @param blockTimestampSeconds - Block timestamp (seconds) of the event
 * @param eventChainId - EVM chain id of the event
 * @param blockNumber - Block number of the event
 * @param context - Envio handler context
 * @returns Promise that resolves once the update is staged, or no-ops if no pool matches
 */
async function applyRedistributorCounterDelta(
  gauge: string,
  delta: RedistributorCounterDelta,
  blockTimestampSeconds: number,
  eventChainId: number,
  blockNumber: number,
  context: handlerContext,
): Promise<void> {
  const poolEntityList = await context.LiquidityPoolAggregator.getWhere({
    gaugeAddress: { _eq: gauge },
  });

  if (!poolEntityList || poolEntityList.length === 0) {
    context.log.error(
      `[Redistributor] Pool entity not found for gauge ${gauge}`,
    );
    return;
  }

  if (poolEntityList.length > 1) {
    context.log.warn(
      `[Redistributor] Multiple pools found for gauge ${gauge}, using first match`,
    );
  }

  const poolEntity = poolEntityList[0];

  await updateLiquidityPoolAggregator(
    delta,
    poolEntity,
    new Date(blockTimestampSeconds * 1000),
    context,
    eventChainId,
    blockNumber,
  );
}

Redistributor.Deposited.handler(async ({ event, context }) => {
  await applyRedistributorCounterDelta(
    event.params.gauge,
    { incrementalTotalEmissionsForfeited: event.params.amount },
    event.block.timestamp,
    event.chainId,
    event.block.number,
    context,
  );
});

Redistributor.Redistributed.handler(async ({ event, context }) => {
  await applyRedistributorCounterDelta(
    event.params.gauge,
    { incrementalTotalEmissionsRedistributed: event.params.amount },
    event.block.timestamp,
    event.chainId,
    event.block.number,
    context,
  );
});

Redistributor.SetKeeper.handler(async ({ event, context }) => {
  await applyRedistributorConfigUpdate(
    event.chainId,
    event.srcAddress,
    { keeper: event.params.keeper },
    event.block.timestamp,
    context,
  );
});

Redistributor.SetUpkeepManager.handler(async ({ event, context }) => {
  await applyRedistributorConfigUpdate(
    event.chainId,
    event.srcAddress,
    { upkeepManager: event.params.upkeepManager },
    event.block.timestamp,
    context,
  );
});
