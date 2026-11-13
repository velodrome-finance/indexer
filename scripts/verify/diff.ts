/**
 * Determinism diff: compares two indexer instances table by table at a common
 * block per chain, using ClickHouse history (the latest version of each row at
 * or below the chain's checkpoint for that block). Same code + same chain
 * should give identical rows.
 *
 * Usage:
 *   npx -y tsx@4.19.2 scripts/verify/diff.ts --a scratch/verify --b scratch/other [--chains 1750,252] [--block N] [--tables Pool,Token] [--out DIR]
 * Exit code 1 when any table differs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chLatest, normValue } from "./checks/store";
import type { ChClient } from "./lib/clickhouse";
import { loadEnv } from "./lib/env";
import { Indexed } from "./lib/indexed";
import { veloTarget } from "./lib/target";

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface TableDiff {
  table: string;
  chainId: number;
  rowsA: number;
  rowsB: number;
  onlyA: number;
  onlyB: number;
  differing: number;
  diffColumns: Record<string, number>;
  examples: string[];
}

async function tablesOf(ch: ChClient): Promise<Map<string, Set<string>>> {
  const rows = await ch.query(
    "SELECT table, name FROM system.columns WHERE database = currentDatabase() AND table LIKE 'envio_history_%'",
  );
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const t = String(r.table).replace(/^envio_history_/, "");
    const s = m.get(t) ?? new Set<string>();
    s.add(String(r.name));
    m.set(t, s);
  }
  return m;
}

async function stateAt(
  ch: ChClient,
  table: string,
  cp: bigint,
  filter: string,
): Promise<Map<string, Record<string, string | null>>> {
  const rows = await chLatest(ch, table, cp, filter);
  const m = new Map<string, Record<string, string | null>>();
  for (const r of rows) if (r.envio_change !== "DELETE") m.set(String(r.id), r);
  return m;
}

async function main(): Promise<number> {
  loadEnv();
  const a = new Indexed(veloTarget(arg("a") ?? ""));
  const b = new Indexed(veloTarget(arg("b") ?? ""));
  await a.connect();
  await b.connect();
  if (!a.ch || !b.ch) throw new Error("both targets need ClickHouse");
  const pa = await a.progress();
  const pb = await b.progress();
  const chains = arg("chains")
    ? (arg("chains") as string).split(",").map(Number)
    : pa.map((p) => p.chainId).filter((c) => pb.some((x) => x.chainId === c));
  const onlyTables = arg("tables")?.split(",");
  const ta = await tablesOf(a.ch);
  const tb = await tablesOf(b.ch);
  const diffs: TableDiff[] = [];
  for (const chainId of chains) {
    const blockA = pa.find((p) => p.chainId === chainId)?.progressBlock ?? 0;
    const blockB = pb.find((p) => p.chainId === chainId)?.progressBlock ?? 0;
    const block = Number(arg("block") ?? Math.min(blockA, blockB));
    const cpA = await a.chCheckpointAt(chainId, block);
    const cpB = await b.chCheckpointAt(chainId, block);
    console.log(
      `chain ${chainId}: common block ${block} (A at ${blockA}, B at ${blockB}); checkpoints ${cpA} / ${cpB}`,
    );
    for (const [table, cols] of ta) {
      if (!tb.has(table) || (onlyTables && !onlyTables.includes(table)))
        continue;
      const filter = cols.has("chainId")
        ? `chainId = ${chainId}`
        : `startsWith(id, '${chainId}-')`;
      const [sa, sb] = await Promise.all([
        stateAt(a.ch, table, cpA, filter),
        stateAt(b.ch, table, cpB, filter),
      ]);
      const d: TableDiff = {
        table,
        chainId,
        rowsA: sa.size,
        rowsB: sb.size,
        onlyA: 0,
        onlyB: 0,
        differing: 0,
        diffColumns: {},
        examples: [],
      };
      for (const [id, ra] of sa) {
        const rb = sb.get(id);
        if (!rb) {
          d.onlyA++;
          if (d.examples.length < 5) d.examples.push(`only in A: ${id}`);
          continue;
        }
        let differs = false;
        for (const c of Object.keys(ra)) {
          if (c.startsWith("envio_") || !(c in rb)) continue;
          if (normValue(ra[c]) !== normValue(rb[c])) {
            differs = true;
            d.diffColumns[c] = (d.diffColumns[c] ?? 0) + 1;
            if (d.examples.length < 8)
              d.examples.push(`${id}.${c}: A=${ra[c]} B=${rb[c]}`);
          }
        }
        if (differs) d.differing++;
      }
      for (const id of sb.keys()) {
        if (!sa.has(id)) {
          d.onlyB++;
          if (d.examples.length < 8) d.examples.push(`only in B: ${id}`);
        }
      }
      diffs.push(d);
      const bad = d.onlyA + d.onlyB + d.differing;
      console.log(
        `  ${table}: ${d.rowsA}/${d.rowsB} rows${bad ? `, onlyA ${d.onlyA}, onlyB ${d.onlyB}, differing ${d.differing} ${JSON.stringify(d.diffColumns)}` : " identical"}`,
      );
      for (const e of bad ? d.examples.slice(0, 4) : [])
        console.log(`    ${e}`);
    }
  }
  a.close();
  b.close();
  const out = arg("out");
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, "diff.json"), JSON.stringify(diffs, null, 1));
  }
  return diffs.some((d) => d.onlyA + d.onlyB + d.differing > 0) ? 1 : 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
