/**
 * Builds `src/constants/canonical_price_seed.json`: hourly prices of the
 * canonical source tokens (src/PriceOverrides.ts) that a leaf token falls back
 * to when the live source is outside the ±2 h window (ADR 0008).
 *
 * Inputs, merged per (source token, hour) with the FIRST input that has the
 * hour winning, in command-line order:
 *   --tsv <file>    rows: chainId, address, unix hour start, price (1e18 USD)
 *   --clickhouse    a deployment's TokenPriceSnapshot history: per clock hour,
 *                   the last `pool`-sourced price of each source token (never
 *                   carried, canonical or seeded rows, so the seed cannot feed
 *                   on itself). Connection from ENVIO_CLICKHOUSE_HOST,
 *                   ENVIO_CLICKHOUSE_DATABASE, ENVIO_CLICKHOUSE_USERNAME,
 *                   ENVIO_CLICKHOUSE_PASSWORD; nothing is stored in the repo.
 *
 * Options:
 *   --source <chainId>-<address>   restrict to these sources (repeatable;
 *                                  default: the sources this script knows)
 *   --out <file>                   default src/constants/canonical_price_seed.json
 *   --note <text>                  provenance line written into the file
 *
 * Usage (the first seed):
 *   npx -y tsx@4.19.2 scripts/build-canonical-price-seed.ts \
 *     --tsv prod_canonical_sources_10.tsv --tsv aero_all_sources.tsv \
 *     --note "oracle to 2026-11-03 11:00, pool-derived after"
 * Refresh before a resync, from the running deployment:
 *   ENVIO_CLICKHOUSE_HOST=... npx -y tsx@4.19.2 scripts/build-canonical-price-seed.ts --clickhouse
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type CanonicalSeedSeries,
  encodeCanonicalSeedSeries,
} from "../src/Pricing/CanonicalPriceSeed";
import { ChClient, chConfigFromEnv } from "./verify/lib/clickhouse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The canonical sources in src/PriceOverrides.ts (`CANONICAL_SOURCES`) with a
 * trustworthy hourly series. Lower-case address; the seed key is the
 * checksummed TokenId, written here as it appears in the store.
 */
const DEFAULT_SOURCES: ReadonlyArray<string> = [
  "10-0x4200000000000000000000000000000000000006", // Optimism WETH
  "10-0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db", // Optimism VELO (XVELO)
  "8453-0x3f5bF3EdAc59d650D8fDf9657a71F2f904A3a4Ee", // Base AERO (xAERO)
];

type Hourly = Map<string, Map<number, bigint>>;

function parseArgs(argv: string[]) {
  const inputs: Array<{ kind: "tsv"; file: string } | { kind: "clickhouse" }> =
    [];
  const sources: string[] = [];
  let out = path.join(__dirname, "../src/constants/canonical_price_seed.json");
  let note = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tsv") inputs.push({ kind: "tsv", file: argv[++i] });
    else if (a === "--clickhouse") inputs.push({ kind: "clickhouse" });
    else if (a === "--source") sources.push(argv[++i]);
    else if (a === "--out") out = argv[++i];
    else if (a === "--note") note = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  if (inputs.length === 0)
    throw new Error("give at least one --tsv or --clickhouse");
  return {
    inputs,
    sources: sources.length ? sources : DEFAULT_SOURCES,
    out,
    note,
  };
}

/** Maps a lower-cased `{chainId}-{address}` to the configured source id. */
function sourceKeyer(sources: ReadonlyArray<string>) {
  const byLower = new Map(sources.map((s) => [s.toLowerCase(), s]));
  return (chainId: string, address: string) =>
    byLower.get(`${chainId}-${address}`.toLowerCase());
}

function addFirst(
  hourly: Hourly,
  sourceId: string,
  hour: number,
  price: bigint,
): void {
  if (price <= 0n || hour % 3600 !== 0) return;
  let m = hourly.get(sourceId);
  if (!m) {
    m = new Map();
    hourly.set(sourceId, m);
  }
  if (!m.has(hour)) m.set(hour, price);
}

function readTsv(
  file: string,
  hourly: Hourly,
  keyOf: ReturnType<typeof sourceKeyer>,
) {
  let n = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const [chainId, address, hour, price] = line.split("\t");
    const id = keyOf(chainId, address);
    if (!id || !/^\d+$/.test(price ?? "")) continue;
    addFirst(hourly, id, Number(hour), BigInt(price));
    n++;
  }
  console.error(`  ${file}: ${n} rows`);
}

async function readClickHouse(
  sources: ReadonlyArray<string>,
  hourly: Hourly,
  keyOf: ReturnType<typeof sourceKeyer>,
) {
  const cfg = chConfigFromEnv();
  if (!cfg) throw new Error("--clickhouse needs ENVIO_CLICKHOUSE_HOST");
  const pairs = sources
    .map((s) => {
      const dash = s.indexOf("-");
      return `(${Number(s.slice(0, dash))}, '${s.slice(dash + 1).toLowerCase()}')`;
    })
    .join(", ");
  const rows = await new ChClient(cfg).query(`
    SELECT chainId, lower(address) AS address,
           toUnixTimestamp(toStartOfHour(lastUpdatedTimestamp)) AS hour,
           argMax(pricePerUSDNew, lastUpdatedTimestamp) AS price
    FROM TokenPriceSnapshot
    WHERE priceSource = 'pool' AND (chainId, lower(address)) IN (${pairs})
    GROUP BY chainId, address, hour
    ORDER BY chainId, address, hour`);
  for (const r of rows) {
    const id = keyOf(String(r.chainId), String(r.address));
    if (id && r.price) addFirst(hourly, id, Number(r.hour), BigInt(r.price));
  }
  console.error(`  clickhouse ${cfg.database}: ${rows.length} rows`);
}

/**
 * Writes the seed as formatted JSON (each source's prices are one string, so
 * the file stays a few lines long and the formatter leaves it alone).
 */
function writeSeed(
  out: string,
  note: string,
  series: ReadonlyArray<[string, CanonicalSeedSeries]>,
) {
  const file = { note, sources: Object.fromEntries(series) };
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
}

async function main() {
  const { inputs, sources, out, note } = parseArgs(process.argv.slice(2));
  const keyOf = sourceKeyer(sources);
  const hourly: Hourly = new Map();
  for (const input of inputs) {
    if (input.kind === "tsv") readTsv(input.file, hourly, keyOf);
    else await readClickHouse(sources, hourly, keyOf);
  }
  const series: Array<[string, CanonicalSeedSeries]> = [];
  for (const id of sources) {
    const m = hourly.get(id);
    const s = m && encodeCanonicalSeedSeries(m);
    if (!s) {
      console.error(`  ${id}: no prices`);
      continue;
    }
    const fields = s.prices.split(",");
    const filled = fields.filter((p) => p !== "").length;
    const end = s.startHour + (fields.length - 1) * 3600;
    console.error(
      `  ${id}: ${new Date(s.startHour * 1000).toISOString()} .. ${new Date(end * 1000).toISOString()}, ${filled}/${fields.length} hours, scale ${s.scale}`,
    );
    series.push([id, s]);
  }
  writeSeed(out, note, series);
  console.error(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
