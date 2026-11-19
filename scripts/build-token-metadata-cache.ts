/**
 * Builds the seed effect cache for `getTokenMetadata` (src/Effects/TokenMetadata.ts).
 *
 * Envio loads `.envio/cache/<chainId>/getTokenMetadata.tsv` into
 * `envio_<chainId>_effect_getTokenMetadata` when it initialises a fresh
 * database, so tokens listed here cost no RPC on a resync.
 *
 * Sources, in order of preference, for every token this indexer knows
 * (paged from the production GraphQL `Token` table):
 *   1. Envio's Uniswap v4 indexer cache (`<uniswap-dir>/<chainId>/getTokenMetadata.tsv`)
 *      when its row has a real name AND symbol. The 1.9 GB Base file is streamed.
 *   2. The production Token row when its symbol is non-empty (a real read).
 *   3. A Uniswap row with only one real field (name or symbol).
 *   Otherwise the token is left out and fetched at runtime.
 *
 * Output format = Postgres `COPY ... (FORMAT text, HEADER)`: header `id\toutput`,
 * id `["<checksummed address>",<chainId>]`, output JSON. Uniswap output columns
 * are copied verbatim (already COPY-escaped); generated JSON is escaped here.
 *
 * Usage:
 *   npx -y tsx@4.19.2 scripts/build-token-metadata-cache.ts \
 *     [--uniswap-dir /path/to/uniswap-token-cache] [--out .envio/cache] \
 *     [--graphql https://.../v1/graphql] [--tokens-json in.json] [--save-tokens out.json]
 */
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";
import { RPC_CHAINS } from "../src/Effects/RpcConfig";

const args = process.argv.slice(2);
const opt = (name: string, dflt: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const UNISWAP_DIR = opt(
  "--uniswap-dir",
  "/home/dev/work-dev-box/scratch/uniswap-token-cache",
);
const OUT_DIR = opt("--out", ".envio/cache");
const GRAPHQL = opt(
  "--graphql",
  "https://velodrome-finance-ec327a5.dedicated.hyperindex.xyz/v1/graphql",
);
const TOKENS_JSON = opt("--tokens-json", "");
const EFFECT = "getTokenMetadata";
const PAGE = 1000;

type ProdToken = {
  id: string;
  address: string;
  chainId: number;
  symbol: string;
  name: string;
  decimals: string;
};
type Meta = { name: string; symbol: string; decimals: number };

async function fetchProductionTokens(): Promise<ProdToken[]> {
  const all: ProdToken[] = [];
  let lastId = "";
  for (;;) {
    const query = `query ($after: String!, $limit: Int!) {
      Token(limit: $limit, order_by: {id: asc}, where: {id: {_gt: $after}}) {
        id address chainId symbol name decimals
      }
    }`;
    const res = await fetch(GRAPHQL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { after: lastId, limit: PAGE },
      }),
    });
    if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: { Token: ProdToken[] };
      errors?: unknown;
    };
    if (json.errors || !json.data) {
      throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
    }
    const page = json.data.Token;
    all.push(...page);
    if (page.length < PAGE) break;
    lastId = page[page.length - 1].id;
  }
  return all;
}

/** Postgres COPY text-format escaping for one field. */
const copyEscape = (s: string): string =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");

/** Same layout as Postgres jsonb text output (what the Uniswap dump contains). */
const metaJson = (m: Meta): string =>
  `{"name": ${JSON.stringify(m.name)}, "symbol": ${JSON.stringify(m.symbol)}, "decimals": ${m.decimals}}`;

const isMeta = (v: unknown): v is Meta =>
  !!v &&
  typeof (v as Meta).name === "string" &&
  typeof (v as Meta).symbol === "string" &&
  typeof (v as Meta).decimals === "number";

/** Reverses COPY escaping of an output column so it can be JSON-parsed. */
const copyUnescape = (s: string): string =>
  s.replace(/\\(.)/g, (_, c: string) =>
    c === "t" ? "\t" : c === "n" ? "\n" : c === "r" ? "\r" : c,
  );

/**
 * Yields lines split on "\n" only. node:readline also breaks on U+2028/U+2029,
 * which occur inside some token names and would silently drop those rows.
 */
async function* splitLines(stream: AsyncIterable<Buffer | string>) {
  let rest = "";
  for await (const chunk of stream) {
    const text = rest + chunk.toString();
    const parts = text.split("\n");
    rest = parts.pop() ?? "";
    yield* parts;
  }
  if (rest) yield rest;
}

type UniRow = { output: string; meta: Meta };

/**
 * Streams one Uniswap cache file and keeps the rows for `wanted` addresses
 * (lower-case keys). Never holds more than the matched rows in memory.
 */
async function scanUniswap(
  chainId: number,
  wanted: Set<string>,
): Promise<{
  rows: Map<string, UniRow>;
  scanned: number;
  nonChecksummed: number;
}> {
  const rows = new Map<string, UniRow>();
  const file = join(UNISWAP_DIR, String(chainId), `${EFFECT}.tsv`);
  if (!existsSync(file)) return { rows, scanned: 0, nonChecksummed: 0 };
  // encoding: "utf8" decodes across chunk boundaries (no split multibyte chars).
  const rl = splitLines(
    createReadStream(file, { highWaterMark: 1 << 20, encoding: "utf8" }),
  );
  const re = /^\["(0x[0-9a-fA-F]{40})",(\d+)\]\t(.*)$/;
  let scanned = 0;
  let nonChecksummed = 0;
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      if (line.startsWith("id\t")) continue;
    }
    scanned++;
    const m = re.exec(line);
    if (!m || Number(m[2]) !== chainId) continue;
    const lower = m[1].toLowerCase();
    if (!wanted.has(lower)) continue;
    if (m[1] !== getAddress(m[1])) nonChecksummed++;
    let meta: unknown;
    try {
      meta = JSON.parse(copyUnescape(m[3]));
    } catch {
      continue;
    }
    if (isMeta(meta)) rows.set(lower, { output: m[3], meta });
  }
  return { rows, scanned, nonChecksummed };
}

async function main() {
  const tokens: ProdToken[] = TOKENS_JSON
    ? JSON.parse(readFileSync(TOKENS_JSON, "utf8"))
    : await fetchProductionTokens();
  const saveTokens = opt("--save-tokens", "");
  if (saveTokens) writeFileSync(saveTokens, JSON.stringify(tokens));
  console.log(`Production Token rows: ${tokens.length}`);

  const byChain = new Map<number, Map<string, ProdToken>>();
  for (const t of tokens) {
    let m = byChain.get(t.chainId);
    if (!m) {
      m = new Map();
      byChain.set(t.chainId, m);
    }
    m.set(t.address.toLowerCase(), t);
  }

  const summary: Record<string, string | number>[] = [];
  for (const chainId of Object.keys(RPC_CHAINS).map(Number)) {
    const prod = byChain.get(chainId) ?? new Map<string, ProdToken>();
    const {
      rows: uni,
      scanned,
      nonChecksummed,
    } = await scanUniswap(chainId, new Set(prod.keys()));
    const lines: string[] = [];
    let fromUni = 0;
    let fromProd = 0;
    let fromUniPartial = 0;
    let uncovered = 0;
    for (const [lower, t] of prod) {
      const address = getAddress(lower);
      const id = `["${address}",${chainId}]`;
      const u = uni.get(lower);
      const uComplete =
        u && u.meta.name !== "unknown" && u.meta.symbol !== "UNKNOWN";
      if (u && uComplete) {
        lines.push(`${id}\t${u.output}`);
        fromUni++;
      } else if (t.symbol) {
        const decimals = Number(t.decimals);
        const meta: Meta = {
          name: t.name || "unknown",
          symbol: t.symbol,
          decimals:
            Number.isInteger(decimals) && decimals >= 0 && decimals <= 50
              ? decimals
              : 18,
        };
        lines.push(`${id}\t${copyEscape(metaJson(meta))}`);
        fromProd++;
      } else if (
        u &&
        (u.meta.name !== "unknown" || u.meta.symbol !== "UNKNOWN")
      ) {
        lines.push(`${id}\t${u.output}`);
        fromUniPartial++;
      } else {
        uncovered++;
      }
    }
    lines.sort();
    if (lines.length > 0) {
      const dir = join(OUT_DIR, String(chainId));
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${EFFECT}.tsv`),
        `id\toutput\n${lines.join("\n")}\n`,
      );
    }
    summary.push({
      chain: `${chainId} ${RPC_CHAINS[chainId].name}`,
      tokens: prod.size,
      inUniswapFile: uni.size,
      uniswap: fromUni,
      production: fromProd,
      uniswapPartial: fromUniPartial,
      uncovered,
      written: lines.length,
      uniswapRowsScanned: scanned,
      ...(nonChecksummed ? { uniswapNonChecksummedIds: nonChecksummed } : {}),
    });
  }
  console.table(summary);
  const total = summary.reduce(
    (a, r) => ({
      tokens: a.tokens + Number(r.tokens),
      uniswap: a.uniswap + Number(r.uniswap),
      production: a.production + Number(r.production),
      uniswapPartial: a.uniswapPartial + Number(r.uniswapPartial),
      uncovered: a.uncovered + Number(r.uncovered),
    }),
    { tokens: 0, uniswap: 0, production: 0, uniswapPartial: 0, uncovered: 0 },
  );
  console.log("Total:", total);
  const unknownChains = [...byChain.keys()].filter((c) => !RPC_CHAINS[c]);
  if (unknownChains.length) {
    console.log(`Skipped tokens on chains not in RPC_CHAINS: ${unknownChains}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
