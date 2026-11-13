/**
 * Hourly snapshots (ClickHouse): presence for every active hour, values equal
 * to the entity state they capture, no rewrites, monotonic cumulative fields.
 */
import { decodeLog } from "../lib/abi";
import {
  LOG_FIELDS,
  hypersyncStream,
  hypersyncUrl,
  parseHsTimestamp,
} from "../lib/hypersync";
import { Check } from "../lib/report";
import { big, lc, sample } from "../lib/util";
import type { PoolTruth } from "../truth/types";
import type { CheckContext } from "./context";

interface SnapRow {
  pool: string;
  epoch: number; // seconds
  numberOfSwaps: bigint;
  totalVolume0: bigint;
  totalVolume1: bigint;
  reserve0: bigint;
  reserve1: bigint;
  sqrtPriceX96: bigint;
  tick: bigint;
  totalFeesGenerated0: bigint;
  totalFeesGenerated1: bigint;
}

/**
 * Loads PoolSnapshot rows (latest version per id, at or below the pinned checkpoint).
 * @param ctx - Check context
 * @param cp - ClickHouse checkpoint id of the pinned block
 * @returns Rows
 */
async function loadPoolSnapshots(
  ctx: CheckContext,
  cp: bigint,
): Promise<SnapRow[]> {
  const ch = ctx.idx.ch;
  if (!ch) return [];
  const rows = await ch.query(
    `SELECT lower(poolAddress) AS pool, id, numberOfSwaps, totalVolume0, totalVolume1, reserve0, reserve1,
            ifNull(sqrtPriceX96, '0') AS sqrtPriceX96, ifNull(toString(tick), '0') AS tick, totalFeesGenerated0, totalFeesGenerated1
     FROM envio_history_PoolSnapshot
     WHERE chainId = ${ctx.chainId} AND envio_checkpoint_id <= ${cp} AND envio_change = 'SET'
     ORDER BY id, envio_checkpoint_id DESC LIMIT 1 BY id`,
  );
  return rows.map((r) => ({
    pool: r.pool as string,
    epoch: Number(String(r.id).split("-").pop()) / 1000,
    numberOfSwaps: big(r.numberOfSwaps),
    totalVolume0: big(r.totalVolume0),
    totalVolume1: big(r.totalVolume1),
    reserve0: big(r.reserve0),
    reserve1: big(r.reserve1),
    sqrtPriceX96: big(r.sqrtPriceX96),
    tick: big(r.tick),
    totalFeesGenerated0: big(r.totalFeesGenerated0),
    totalFeesGenerated1: big(r.totalFeesGenerated1),
  }));
}

interface PoolStep {
  ts: number;
  block: number;
  logIndex: number;
  tx: string;
  name: string;
  from?: string;
  /** state after this log */
  swaps: bigint;
  vol0: bigint;
  vol1: bigint;
  reserve0: bigint;
  reserve1: bigint;
  sqrtPriceX96: bigint;
  tick: bigint;
}

/**
 * Re-streams one pool's logs and records its cumulative state after each log.
 * @param ctx - Check context
 * @param p - Pool truth
 * @returns Ordered steps (handled events only)
 */
async function poolSteps(ctx: CheckContext, p: PoolTruth): Promise<PoolStep[]> {
  const contract = p.kind === "cl" ? "CLPool" : "Pool";
  const tm = ctx.reg.topicMap(contract);
  const steps: PoolStep[] = [];
  let s = {
    swaps: 0n,
    vol0: 0n,
    vol1: 0n,
    reserve0: 0n,
    reserve1: 0n,
    sqrtPriceX96: 0n,
    tick: 0n,
  };
  await hypersyncStream(
    hypersyncUrl(ctx.chainId, ctx.chain.hypersyncUrl),
    {
      from_block: p.created.block,
      to_block: ctx.truth.pinnedBlock + 1,
      logs: [{ address: [p.address] }],
      field_selection: {
        log: LOG_FIELDS,
        block: ["number", "timestamp"],
        transaction: ["hash", "from"],
      },
    },
    (page) => {
      const bts = new Map(
        page.blocks.map((b) => [b.number, parseHsTimestamp(b.timestamp)]),
      );
      const from = new Map(page.transactions.map((t) => [t.hash, lc(t.from)]));
      page.logs.sort(
        (a, b) => a.block_number - b.block_number || a.log_index - b.log_index,
      );
      for (const l of page.logs) {
        const def = tm.get(l.topic0 ?? "");
        if (!def?.configured) continue;
        const d = decodeLog(def, l);
        const e = def.name;
        if (e === "Initialize") {
          s = {
            ...s,
            sqrtPriceX96: d.sqrtPriceX96 as bigint,
            tick: d.tick as bigint,
          };
          continue; // does not update the Pool row
        }
        if (
          e === "Transfer" &&
          d.from !== "0x0000000000000000000000000000000000000000" &&
          d.to !== "0x0000000000000000000000000000000000000000"
        )
          continue;
        if (e === "Swap") {
          if (p.kind === "cl") {
            const a0 = d.amount0 as bigint;
            const a1 = d.amount1 as bigint;
            s = {
              ...s,
              swaps: s.swaps + 1n,
              vol0: s.vol0 + (a0 < 0n ? -a0 : a0),
              vol1: s.vol1 + (a1 < 0n ? -a1 : a1),
              sqrtPriceX96: d.sqrtPriceX96 as bigint,
              tick: d.tick as bigint,
            };
          } else {
            s = {
              ...s,
              swaps: s.swaps + 1n,
              vol0: s.vol0 + (d.amount0In as bigint) + (d.amount0Out as bigint),
              vol1: s.vol1 + (d.amount1In as bigint) + (d.amount1Out as bigint),
            };
          }
        } else if (e === "Sync") {
          s = {
            ...s,
            reserve0: d.reserve0 as bigint,
            reserve1: d.reserve1 as bigint,
          };
        }
        steps.push({
          ts: bts.get(l.block_number) ?? 0,
          block: l.block_number,
          logIndex: l.log_index,
          tx: l.transaction_hash ?? "",
          name: e,
          from: from.get(l.transaction_hash ?? ""),
          ...s,
        });
      }
    },
  );
  return steps;
}

/**
 * Snapshot checks.
 * @param ctx - Check context
 * @param cp - ClickHouse checkpoint id of the pinned block
 * @returns Promise resolving when done
 */
export async function checkSnapshots(
  ctx: CheckContext,
  cp: bigint,
): Promise<void> {
  const presence = new Check(
    "snapshot.pool-presence",
    ctx.chainId,
    "Every pool has a PoolSnapshot for every clock hour in which it emitted a log that updates the Pool row (V2: Swap, Sync, Fees, Mint, Burn, Claim, LP mint/burn Transfer; CL: Swap, Mint, Burn, Collect, CollectFees, Flash, ...; plus gauge Deposit/Withdraw/ClaimRewards), up to the pinned block. Snapshot hours without such a log (triggered by voter / NFPM / reward events) are counted, not failed.",
    "Exact.",
  );
  const values = new Check(
    "snapshot.pool-values",
    ctx.chainId,
    "For a sample of pools (re-streamed from HyperSync), each PoolSnapshot of hour E equals the pool state just before or just after the pool's first handled log at or after E (the snapshot is taken by the first Pool update of the hour and includes that update): numberOfSwaps, totalVolume0/1, V2 reserve0/1, CL sqrtPriceX96 / tick.",
    "Exact (membership in the two-element set).",
  );
  const mono = new Check(
    "snapshot.pool-monotonic",
    ctx.chainId,
    "Per pool, cumulative PoolSnapshot fields (numberOfSwaps, totalVolume0/1, totalFeesGenerated0/1) never decrease from one hour to the next, and the last snapshot does not exceed the Pool row.",
    "Exact.",
  );
  const rewrites = new Check(
    "snapshot.rewrites",
    ctx.chainId,
    "Each hourly snapshot id is written once: ClickHouse history rows per snapshot id (PoolSnapshot, TokenPriceSnapshot, UserStatsPerPoolSnapshot, NonFungiblePositionSnapshot, ALM_LP_WrapperSnapshot) for this chain. A second version means the same hour was snapshotted twice (e.g. two price refreshes in one hour).",
    "Exact (one version per id).",
  );
  const users = new Check(
    "snapshot.user-presence",
    ctx.chainId,
    "For the sampled pools, every (swapper, hour) with a swap has a UserStatsPerPoolSnapshot for that hour (the user's row is updated by the swap, which snapshots on the first update of the hour).",
    "Exact.",
  );
  if (!ctx.idx.ch) {
    for (const c of [presence, values, mono, rewrites, users])
      ctx.results.push(c.skip("no ClickHouse").done(""));
    return;
  }
  const snaps = await loadPoolSnapshots(ctx, cp);
  const byPool = new Map<string, SnapRow[]>();
  for (const s of snaps) {
    const l = byPool.get(s.pool) ?? [];
    l.push(s);
    byPool.set(s.pool, l);
  }
  for (const l of byPool.values()) l.sort((a, b) => a.epoch - b.epoch);

  // presence
  let required = 0;
  let extraHours = 0;
  const pinnedHour = Math.floor(ctx.truth.pinnedTimestamp / 3600);
  for (const p of ctx.truth.pools.values()) {
    const have = new Set(
      (byPool.get(p.address) ?? []).map((s) => Math.floor(s.epoch / 3600)),
    );
    for (const h of p.activeHours) {
      if (h > pinnedHour) continue;
      required++;
      if (!have.has(h))
        presence.add(
          {
            key: `${p.address}@${new Date(h * 3600_000).toISOString()}`,
            indexed: "no snapshot",
            truth: "pool active in this hour",
          },
          1,
        );
      else presence.compared++;
    }
    for (const h of have) if (!p.activeHours.has(h)) extraHours++;
  }
  presence.stats.snapshotsWithoutPoolLog = extraHours;
  ctx.results.push(
    presence.done(
      `${required} active pool-hours, ${snaps.length} snapshots; ${extraHours} snapshot hours with no pool/gauge log (other triggers)`,
    ),
  );

  // monotonic
  for (const [pool, l] of byPool) {
    for (let i = 1; i < l.length; i++) {
      for (const f of [
        "numberOfSwaps",
        "totalVolume0",
        "totalVolume1",
        "totalFeesGenerated0",
        "totalFeesGenerated1",
      ] as const) {
        mono.compared++;
        if (l[i][f] < l[i - 1][f])
          mono.add({
            key: `${pool}.${f}@${new Date(l[i].epoch * 1000).toISOString()}`,
            indexed: String(l[i][f]),
            truth: `≥ previous hour ${l[i - 1][f]}`,
          });
      }
    }
    const r = ctx.pools.get(pool);
    const last = l[l.length - 1];
    if (r && last)
      mono.cmp(
        `${pool}.numberOfSwaps last snapshot ≤ Pool`,
        last.numberOfSwaps > big(r.numberOfSwaps)
          ? last.numberOfSwaps
          : big(r.numberOfSwaps),
        big(r.numberOfSwaps),
      );
  }
  ctx.results.push(mono.done(`${byPool.size} pools with snapshots`));

  // rewrites
  for (const t of [
    "PoolSnapshot",
    "TokenPriceSnapshot",
    "UserStatsPerPoolSnapshot",
    "NonFungiblePositionSnapshot",
    "ALM_LP_WrapperSnapshot",
  ]) {
    const rows = await ctx.idx.ch.query(
      `SELECT count() AS ids, countIf(n > 1) AS rewritten, max(n) AS maxVersions, anyIf(id, n > 1) AS example
       FROM (SELECT id, count() AS n FROM envio_history_${t} WHERE chainId = ${ctx.chainId} AND envio_checkpoint_id <= ${cp} GROUP BY id)`,
    );
    const r = rows[0] ?? {};
    rewrites.stats[t] = `${r.ids} ids, ${r.rewritten} rewritten`;
    rewrites.compared += Number(r.ids ?? 0);
    if (Number(r.rewritten ?? 0) > 0)
      rewrites.add(
        {
          key: t,
          indexed: `${r.rewritten} ids with >1 version (max ${r.maxVersions})`,
          truth: "1 version per id",
          detail: { example: r.example },
        },
        Number(r.rewritten),
      );
  }
  ctx.results.push(
    rewrites.done(
      Object.entries(rewrites.stats)
        .filter(([k]) => k !== "compared")
        .map(([k, v]) => `${k}: ${v}`)
        .join("; "),
    ),
  );

  // values + user presence on a sample of pools
  const active = [...ctx.truth.pools.values()].filter(
    (p) => p.swaps > 0 && byPool.has(p.address),
  );
  const busiest = [...active]
    .sort((a, b) => b.swaps - a.swaps)
    .slice(0, Math.ceil(ctx.opts.snapshotPools / 2));
  const chosen = [
    ...new Set([
      ...busiest,
      ...sample(active, ctx.opts.snapshotPools, `snap-${ctx.chainId}`),
    ]),
  ].slice(0, ctx.opts.snapshotPools);
  for (const p of chosen) {
    const steps = await poolSteps(ctx, p);
    const l = byPool.get(p.address) ?? [];
    let j = 0;
    for (const s of l) {
      while (j < steps.length && steps[j].ts < s.epoch) j++;
      const before = j > 0 ? steps[j - 1] : undefined;
      const first = steps[j];
      const after = first && first.ts < s.epoch + 3600 ? first : undefined;
      const fields: [string, bigint, (x?: PoolStep) => bigint][] = [
        ["numberOfSwaps", s.numberOfSwaps, (x) => x?.swaps ?? 0n],
        ["totalVolume0", s.totalVolume0, (x) => x?.vol0 ?? 0n],
        ["totalVolume1", s.totalVolume1, (x) => x?.vol1 ?? 0n],
      ];
      if (p.kind === "v2") {
        fields.push(
          ["reserve0", s.reserve0, (x) => x?.reserve0 ?? 0n],
          ["reserve1", s.reserve1, (x) => x?.reserve1 ?? 0n],
        );
      } else {
        fields.push(
          [
            "sqrtPriceX96",
            s.sqrtPriceX96,
            (x) => x?.sqrtPriceX96 ?? before?.sqrtPriceX96 ?? 0n,
          ],
          ["tick", s.tick, (x) => x?.tick ?? before?.tick ?? 0n],
        );
      }
      for (const [f, v, g] of fields) {
        values.compared++;
        const ok = v === g(before) || (after !== undefined && v === g(after));
        if (!ok) {
          values.add(
            {
              key: `${p.address}.${f}@${new Date(s.epoch * 1000).toISOString()}`,
              indexed: String(v),
              truth: `${g(before)} (before) / ${after ? g(after) : "-"} (after first log)`,
              detail: {
                firstLogTx: first?.tx ?? "",
                firstLogBlock: first?.block ?? 0,
                firstLog: first?.name ?? "",
              },
            },
            1,
          );
        }
      }
    }
    // user presence: (swapper, hour)
    const pairs = new Set<string>();
    for (const st of steps)
      if (st.name === "Swap" && st.from)
        pairs.add(`${st.from}|${Math.floor(st.ts / 3600) * 3600}`);
    if (pairs.size > 0) {
      const rows = await ctx.idx.ch.query(
        `SELECT DISTINCT lower(userAddress) AS u, toUnixTimestamp(timestamp) AS ts FROM envio_history_UserStatsPerPoolSnapshot
         WHERE chainId = ${ctx.chainId} AND lower(poolAddress) = '${p.address}' AND envio_checkpoint_id <= ${cp}`,
      );
      const have = new Set(rows.map((r) => `${r.u}|${r.ts}`));
      for (const k of pairs) {
        const [u, ts] = k.split("|");
        if (Number(ts) > ctx.truth.pinnedTimestamp) continue;
        users.compared++;
        if (!have.has(k))
          users.add({
            key: `${u}@${p.address}@${new Date(Number(ts) * 1000).toISOString()}`,
            indexed: "no snapshot",
            truth: "user swapped in this hour",
          });
      }
    }
  }
  values.stats.pools = chosen.length;
  ctx.results.push(
    values.done(
      `${chosen.length} pools re-streamed: ${chosen.map((p) => p.address.slice(0, 10)).join(", ")}`,
    ),
  );
  ctx.results.push(users.done(`${chosen.length} pools`));
}
