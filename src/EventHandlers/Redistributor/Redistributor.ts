import { indexer } from "envio";
import {
  type PoolDiff,
  findPoolByGaugeAddress,
  updatePool,
} from "../../Aggregators/Pool";
import type { handlerContext } from "../../EntityTypes";
import { applyRedistributorConfigUpdate } from "./RedistributorConfigSharedLogic";

type RedistributorCounterDelta = Partial<
  Pick<
    PoolDiff,
    | "incrementalTotalEmissionsRedistributed"
    | "incrementalTotalEmissionsForfeited"
  >
>;

/**
 * Resolve the `Pool` on the event's chain whose `gaugeAddress` matches the
 * event's gauge and apply a cumulative delta to one of the redistributor
 * counters. Pools on other chains that happen to share the gauge address are
 * never matched.
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
  // Pool.gaugeAddress is a bare address and gauge addresses repeat across
  // chains, so the lookup must stay on the event's chain (findPoolByGaugeAddress
  // filters by chainId); the first row of an unfiltered match could be another
  // chain's pool.
  const poolEntity = await findPoolByGaugeAddress(gauge, eventChainId, context);

  if (!poolEntity) {
    context.log.error(
      `[Redistributor] Pool entity not found for gauge ${gauge} on chain ${eventChainId}`,
    );
    return;
  }

  await updatePool(
    delta,
    poolEntity,
    new Date(blockTimestampSeconds * 1000),
    context,
    eventChainId,
    blockNumber,
  );
}

indexer.onEvent(
  { contract: "Redistributor", event: "Deposited" },
  async ({ event, context }) => {
    await applyRedistributorCounterDelta(
      event.params.gauge,
      { incrementalTotalEmissionsForfeited: event.params.amount },
      event.block.timestamp,
      event.chainId,
      event.block.number,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "Redistributor", event: "Redistributed" },
  async ({ event, context }) => {
    await applyRedistributorCounterDelta(
      event.params.gauge,
      { incrementalTotalEmissionsRedistributed: event.params.amount },
      event.block.timestamp,
      event.chainId,
      event.block.number,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "Redistributor", event: "SetKeeper" },
  async ({ event, context }) => {
    await applyRedistributorConfigUpdate(
      event.chainId,
      event.srcAddress,
      { keeper: event.params.keeper },
      event.block.timestamp,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "Redistributor", event: "SetUpkeepManager" },
  async ({ event, context }) => {
    await applyRedistributorConfigUpdate(
      event.chainId,
      event.srcAddress,
      { upkeepManager: event.params.upkeepManager },
      event.block.timestamp,
      context,
    );
  },
);
