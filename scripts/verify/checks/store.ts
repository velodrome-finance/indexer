/**
 * Store consistency between Postgres (handler state) and ClickHouse (history
 * + latest-version views), and helpers shared with the determinism diff.
 */
import type { ChClient } from "../lib/clickhouse";
import type { Indexed } from "../lib/indexed";
import { lit } from "../lib/pg";
import { Check, type CheckResult } from "../lib/report";

/**
 * Normalizes a value from either store to a comparable string.
 * @param v - Raw text value (Postgres text protocol or ClickHouse TSV)
 * @returns Canonical string
 */
export function normValue(v: string | null | undefined): string {
  if (v === null || v === undefined) return "∅";
  if (v === "t" || v === "true") return "true";
  if (v === "f" || v === "false") return "false";
  // Timestamps: '2025-01-21 14:00:00+00' (PG) / '2025-01-21 14:00:00.000' (CH, UTC)
  if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d/.test(v)) {
    const iso = v.replace(" ", "T").replace(/\+00(:00)?$/, "Z");
    const ms = Date.parse(/Z$/.test(iso) ? iso : `${iso}Z`);
    if (!Number.isNaN(ms)) return `ts:${ms}`;
  }
  // Arrays: '{1,2}' (PG) / '[1,2]' or "['a','b']" (CH)
  if (
    (v.startsWith("{") && v.endsWith("}")) ||
    (v.startsWith("[") && v.endsWith("]"))
  ) {
    const inner = v.slice(1, -1).trim();
    if (inner === "") return "[]";
    return `[${inner
      .split(",")
      .map((x) => x.trim().replace(/^['"]|['"]$/g, ""))
      .join(",")}]`;
  }
  // Decimals: '12.000' -> '12'
  if (/^-?\d+\.0+$/.test(v)) return v.replace(/\.0+$/, "");
  return v;
}

/**
 * Tables that exist in both stores (entity tables only).
 * @param idx - Indexed target
 * @returns Table names
 */
export async function sharedTables(idx: Indexed): Promise<string[]> {
  if (!idx.ch) return [];
  const pg = new Set(
    (
      await idx.pg.query(
        `select table_name from information_schema.tables where table_schema=${lit(idx.target.pgSchema)} and table_type='BASE TABLE'`,
      )
    ).map((r) => r.table_name as string),
  );
  const ch = (
    await idx.ch.query(
      "SELECT name FROM system.tables WHERE database = currentDatabase()",
    )
  ).map((r) => r.name as string);
  return ch.filter(
    (t) =>
      pg.has(t) && !t.startsWith("envio_") && ch.includes(`envio_history_${t}`),
  );
}

/**
 * Streams the latest version of every row of a ClickHouse entity table at a checkpoint.
 * @param ch - ClickHouse client
 * @param table - Entity name
 * @param cp - Max checkpoint id (inclusive); undefined = latest
 * @param where - Extra filter on the history table
 * @returns Rows (deleted ones carry envio_change = 'DELETE')
 */
export async function chLatest(
  ch: ChClient,
  table: string,
  cp: bigint | undefined,
  where = "1",
): Promise<Record<string, string | null>[]> {
  const cond = `${cp !== undefined ? `envio_checkpoint_id <= ${cp}` : "1"} AND (${where})`;
  // History tables hold one version per changed block; sort them in hash buckets
  // so a query stays well under the server's per-query memory cap.
  const n = Number(
    (
      await ch.query(
        `SELECT count() AS n FROM envio_history_${table} WHERE ${cond}`,
      )
    )[0]?.n ?? 0,
  );
  // The latest version per id is found on the two narrow columns first, then
  // the wide rows are read by (id, checkpoint) without sorting them.
  let buckets = Math.max(1, Math.ceil(n / 2_000_000));
  for (;;) {
    const out: Record<string, string | null>[] = [];
    try {
      for (let k = 0; k < buckets; k++) {
        const b = buckets > 1 ? ` AND cityHash64(id) % ${buckets} = ${k}` : "";
        const rows = await ch.query(
          `SELECT * FROM envio_history_${table}
           WHERE ${cond}${b} AND (id, envio_checkpoint_id) IN (
             SELECT id, max(envio_checkpoint_id) FROM envio_history_${table} WHERE ${cond}${b} GROUP BY id)`,
        );
        for (const r of rows) out.push(r);
      }
      return out;
    } catch (e) {
      if (!/memory limit/i.test(String(e)) || buckets >= 256) throw e;
      buckets *= 4;
    }
  }
}

/**
 * Distinct ids per chain of a ClickHouse-only snapshot table, and how many of them
 * do not end in an hour-aligned epoch. Counted in hash buckets of the id, so the
 * largest table stays under the server's per-query memory cap.
 * @param ch - ClickHouse client
 * @param table - Snapshot entity name
 * @param cp - Max checkpoint id (inclusive)
 * @returns One row per chain
 */
export async function snapshotIdCounts(
  ch: ChClient,
  table: string,
  cp: bigint,
): Promise<{ chainId: string; n: number; badEpoch: number }[]> {
  const cond = `envio_checkpoint_id <= ${cp}`;
  const total = Number(
    (
      await ch.query(
        `SELECT count() AS n FROM envio_history_${table} WHERE ${cond}`,
      )
    )[0]?.n ?? 0,
  );
  let buckets = Math.max(1, Math.ceil(total / 4_000_000));
  for (;;) {
    const acc = new Map<string, { n: number; badEpoch: number }>();
    try {
      for (let k = 0; k < buckets; k++) {
        const b = buckets > 1 ? ` AND cityHash64(id) % ${buckets} = ${k}` : "";
        const rows = await ch.query(
          `SELECT chainId, uniqExact(id) AS n,
                  uniqExactIf(id, toInt64OrZero(splitByChar('-', id)[-1]) % 3600000 != 0) AS badEpoch
           FROM envio_history_${table} WHERE ${cond}${b} GROUP BY chainId`,
        );
        for (const r of rows) {
          const a = acc.get(r.chainId as string) ?? { n: 0, badEpoch: 0 };
          a.n += Number(r.n);
          a.badEpoch += Number(r.badEpoch);
          acc.set(r.chainId as string, a);
        }
      }
      return [...acc].map(([chainId, a]) => ({ chainId, ...a }));
    } catch (e) {
      if (!/memory limit/i.test(String(e)) || buckets >= 256) throw e;
      buckets *= 4;
    }
  }
}

/**
 * Postgres rows vs ClickHouse latest versions, for every entity stored in both, and
 * row counts of the ClickHouse-only snapshot tables.
 * @param idx - Indexed target
 * @param chains - Chains of this run (only used to label the result)
 * @returns Results
 */
export async function checkStores(
  idx: Indexed,
  chains: number[],
): Promise<CheckResult[]> {
  const c = new Check(
    "store.pg-vs-clickhouse",
    0,
    "For every entity written to both stores, the latest ClickHouse version of each id (history table at the latest committed checkpoint) equals the Postgres row, column by column; ids deleted in Postgres are DELETE in ClickHouse.",
    "Exact after normalising representations (booleans, timestamps, arrays).",
  );
  const out: CheckResult[] = [];
  if (!idx.ch) {
    out.push(c.skip("no ClickHouse").done(""));
    return out;
  }
  const cpRow = await idx.ch.query(
    "SELECT max(checkpoint_id) AS cp FROM envio_chains FINAL",
  );
  const cp = BigInt(cpRow[0]?.cp ?? "0");
  const tables = await sharedTables(idx);
  const perTable: string[] = [];
  for (const t of tables) {
    // Large tables are compared in partitions (last id character, which is
    // hex for every id that ends in an address) so neither side is held whole.
    const total = Number(
      (await idx.pg.query(`select count(*) as n from ${idx.tbl(t)}`))[0]?.n ??
        0,
    );
    const parts = total > 100_000 ? [..."0123456789abcdef"] : [null];
    let pgCount = 0;
    let live = 0;
    let diffs = 0;
    for (const part of parts) {
      const pgRows = await idx.pg.query(
        `select * from ${idx.tbl(t)}${part === null ? "" : ` where lower(right(id, 1)) = '${part}'`}`,
      );
      pgCount += pgRows.length;
      const pgById = new Map(pgRows.map((r) => [r.id as string, r]));
      const chRows = await chLatest(
        idx.ch,
        t,
        cp,
        part === null ? "1" : `lower(right(id, 1)) = '${part}'`,
      );
      const seen = new Set<string>();
      for (const r of chRows) {
        const id = r.id as string;
        const p = pgById.get(id);
        if (r.envio_change === "DELETE") {
          if (p) {
            diffs++;
            c.add(
              {
                key: `${t}:${id}`,
                indexed: "deleted in ClickHouse",
                truth: "present in Postgres",
              },
              5,
            );
          }
          continue;
        }
        live++;
        seen.add(id);
        if (!p) {
          diffs++;
          c.add(
            {
              key: `${t}:${id}`,
              indexed: "only in ClickHouse",
              truth: "missing in Postgres",
            },
            5,
          );
          continue;
        }
        for (const [col, v] of Object.entries(r)) {
          if (col.startsWith("envio_") || !(col in p)) continue;
          c.compared++;
          const a = normValue(v);
          const b = normValue(p[col]);
          if (a !== b) {
            diffs++;
            c.add(
              {
                key: `${t}:${id}.${col}`,
                indexed: `ClickHouse ${a}`,
                truth: `Postgres ${b}`,
              },
              2,
            );
          }
        }
      }
      for (const id of pgById.keys()) {
        if (!seen.has(id)) {
          diffs++;
          c.add(
            {
              key: `${t}:${id}`,
              indexed: "missing in ClickHouse",
              truth: "present in Postgres",
            },
            5,
          );
        }
      }
    }
    if (parts.length > 1) {
      // Ids whose last character is not hex (none expected) would be skipped by the partitions.
      const rest = Number(
        (
          await idx.pg.query(
            `select count(*) as n from ${idx.tbl(t)} where lower(right(id, 1)) !~ '[0-9a-f]'`,
          )
        )[0]?.n ?? 0,
      );
      if (rest > 0)
        c.add(
          {
            key: `${t}: ${rest} ids not partitioned`,
            indexed: "not compared",
            truth: "-",
          },
          1,
        );
    }
    perTable.push(`${t} ${pgCount}/${live}${diffs ? ` (${diffs} diffs)` : ""}`);
  }
  c.stats.tables = tables.length;
  out.push(c.done(`checkpoint ${cp}; rows PG/CH: ${perTable.join(", ")}`));

  const counts = new Check(
    "store.clickhouse-only-counts",
    0,
    "ClickHouse-only snapshot tables: rows per chain and per table, ids well formed ({entityId}-{epochMs} with an hour-aligned epoch), no rows for chains outside the instance.",
    "Exact (structure); counts are reported for review.",
  );
  for (const t of [
    "PoolSnapshot",
    "TokenPriceSnapshot",
    "UserStatsPerPoolSnapshot",
    "NonFungiblePositionSnapshot",
    "ALM_LP_WrapperSnapshot",
    "VeNFTStateSnapshot",
    "VeNFTPoolVoteSnapshot",
  ]) {
    const rows = await snapshotIdCounts(idx.ch, t, cp);
    for (const r of rows) {
      counts.stats[`${t}@${r.chainId}`] = r.n;
      counts.compared++;
      if (
        !chains.includes(Number(r.chainId)) &&
        idx.target.chains &&
        !idx.target.chains.includes(Number(r.chainId))
      ) {
        counts.add({
          key: `${t}@${r.chainId}`,
          indexed: `${r.n} rows`,
          truth: "chain not indexed by this instance",
        });
      }
      if (r.badEpoch > 0)
        counts.add({
          key: `${t}@${r.chainId} ids`,
          indexed: `${r.badEpoch} ids not hour-aligned`,
          truth: "{entityId}-{epochMs}, epoch on the hour",
        });
    }
  }
  out.push(
    counts.done(
      Object.entries(counts.stats)
        .filter(([k]) => k !== "compared")
        .map(([k, v]) => `${k}=${v}`)
        .join(", "),
    ),
  );
  return out;
}
