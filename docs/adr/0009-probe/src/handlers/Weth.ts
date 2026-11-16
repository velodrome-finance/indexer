import { appendFileSync } from "node:fs";
import { S, createEffect, indexer } from "envio";

const LOG = process.env.PCMIN_EFFECT_LOG;
const PROBE_AT: Record<number, number> = {
  34443: 47290000,
  1868: 30806000,
  130: 64040000,
  1135: 39710000,
};
const CHAINS = [34443, 1868, 130, 1135];

// Shared (crossChain) cached effect: one value per clock hour. Each real call
// is logged with the worker pid, so the log shows whether a second worker
// recomputes an hour another worker already cached.
export const hourTag = createEffect(
  {
    name: "hourTag",
    input: { hour: S.number },
    output: S.string,
    rateLimit: false,
    cache: true,
    crossChain: true,
  },
  async ({ input }) => {
    if (LOG)
      appendFileSync(LOG, `hourTag pid=${process.pid} hour=${input.hour}\n`);
    return `h${input.hour}`;
  },
);

// Shared, uncached effect that reads the deployment's own ClickHouse over
// HTTP: rows per chain in TransferEvent. Stands in for "read the source
// chain's hourly price from our own database".
export const peekClickHouse = createEffect(
  {
    name: "peekClickHouse",
    input: { asker: S.number },
    output: S.string,
    rateLimit: false,
    cache: false,
    crossChain: true,
  },
  async ({ input }) => {
    const host = process.env.ENVIO_CLICKHOUSE_HOST;
    if (!host) return "no-clickhouse-env";
    const q = `SELECT chainId, count() FROM ${process.env.ENVIO_CLICKHOUSE_DATABASE}.TransferEvent GROUP BY chainId ORDER BY chainId FORMAT TSV`;
    const res = await fetch(`${host}/?query=${encodeURIComponent(q)}`, {
      headers: {
        "X-ClickHouse-User": process.env.ENVIO_CLICKHOUSE_USERNAME ?? "",
        "X-ClickHouse-Key": process.env.ENVIO_CLICKHOUSE_PASSWORD ?? "",
      },
    });
    const body = (await res.text())
      .trim()
      .replace(/\n/g, ";")
      .replace(/\t/g, "=");
    if (LOG)
      appendFileSync(
        LOG,
        `peek pid=${process.pid} asker=${input.asker} -> ${body}\n`,
      );
    return body;
  },
);

indexer.onEvent(
  { contract: "Weth", event: "Transfer" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const { from, to, value } = event.params;
    const block = event.block.number;
    const hour = Math.floor(event.block.timestamp / 3600);

    const tag = await context.effect(hourTag, { hour });

    const [fromAcc, toAcc, same, marker] = await Promise.all([
      context.Account.get(`${chainId}-${from}`),
      context.Account.get(`${chainId}-${to}`),
      context.SameId.get("global"),
      context.Marker.get(`marker-${chainId}`),
    ]);
    context.Account.set({
      id: `${chainId}-${from}`,
      address: from,
      transfersOut: (fromAcc?.transfersOut ?? 0n) + 1n,
      transfersIn: fromAcc?.transfersIn ?? 0n,
      volume: (fromAcc?.volume ?? 0n) + value,
    });
    if (to !== from) {
      context.Account.set({
        id: `${chainId}-${to}`,
        address: to,
        transfersOut: toAcc?.transfersOut ?? 0n,
        transfersIn: (toAcc?.transfersIn ?? 0n) + 1n,
        volume: (toAcc?.volume ?? 0n) + value,
      });
    }
    context.SameId.set({
      id: "global",
      count: (same?.count ?? 0n) + 1n,
      lastBlock: block,
    });
    context.TransferEvent.set({
      id: `${chainId}-${event.block.number}-${event.logIndex}`,
      from,
      to,
      value,
      blockNumber: block,
      hourTag: tag,
    });

    if (!marker) {
      context.Marker.set({ id: `marker-${chainId}`, firstBlock: block });
      // An entity object that still carries a (wrong) chainId property, as a
      // spread of an old-style object would: where does the row land?
      context.Probe.set({
        id: `extra-${chainId}`,
        note: "extra chainId=1",
        chainId: 1,
      } as never);
      // Same address on every chain: getWhere must decide whether it sees the others.
      context.Account.set({
        id: `${chainId}-0xshared`,
        address: "0xshared",
        transfersOut: 0n,
        transfersIn: 0n,
        volume: BigInt(chainId),
      });
      return;
    }

    const probeId = `probe-${chainId}`;
    const done = await context.Probe.get(probeId);
    if (done || block < (PROBE_AT[chainId] ?? Number.MAX_SAFE_INTEGER)) return;

    const others = await Promise.all(
      CHAINS.filter((c) => c !== chainId).map(async (c) => {
        const m = await context.Marker.get(`marker-${c}`);
        return `${c}:${m ? "found" : "missing"}`;
      }),
    );
    const shared = await context.Account.getWhere({
      address: { _eq: "0xshared" },
    });
    const peek = await context.effect(peekClickHouse, { asker: chainId });
    const note = JSON.stringify({
      markerKeys: Object.keys(marker),
      markerChainId: (marker as Record<string, unknown>).chainId ?? null,
      otherMarkers: others,
      getWhereShared: shared.map((a) => `${a.id}:${a.volume}`),
      sameIdCount: String(same?.count),
      clickhouseRowsByChain: peek,
      pid: process.pid,
    });
    context.Probe.set({ id: probeId, note });
    context.log.info(`PROBE ${chainId} ${note}`);
  },
);
