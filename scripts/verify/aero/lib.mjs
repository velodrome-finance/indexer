// Shared helpers for the Aero chain-truth checks in this directory.
//
// - sql / chsql: rows from an instance's Postgres / ClickHouse through the
//   box's `velo` hosting tool (override its path with VELO_BIN).
// - call: one eth_call at a block (counted in rpcCalls). Base, Optimism and
//   Ink use ENVIO_{BASE,OPTIMISM,INK}_RPC_URL; the Aero-only chains use dRPC
//   (ENVIO_DRPC_API_KEY). Values come from the repo's .env and are never
//   printed.
// - scan / height / decode: logs straight from HyperSync (ENVIO_API_TOKEN),
//   over IPv4 (the box's AAAA lookups for *.hypersync.xyz stall).
//
// The checks are read-only. Every script takes the instance name and reads
// each chain's stored progress block, so run them against a stopped
// instance to get one consistent block per chain.
import { execFileSync } from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import https from "node:https";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "../../..");
const require = createRequire(path.join(REPO, "package.json"));
export const viem = require("viem");
const VELO =
  process.env.VELO_BIN ??
  "/home/dev/work-dev-box/hosting/velodrome-indexer/velo";

dns.setDefaultResultOrder("ipv4first");

function loadEnv() {
  const file = path.join(REPO, ".env");
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}
const env = { ...loadEnv(), ...process.env };

// ---- addresses (deployment-addresses/*.json of the public Aero repos) ----

export const AERO_CHAINS = [8453, 10, 1, 42161, 57073, 4663, 5042];
export const CHAIN_NAME = {
  8453: "Base",
  10: "Optimism",
  1: "Ethereum",
  42161: "Arbitrum",
  57073: "Ink",
  4663: "Robinhood",
  5042: "Arc",
};
export const LEAF_VOTER = "0x382409fad8503FbCdbB27A4211551fa03e884078";
export const VOTING_ESCROW = "0xBF7977E1521e9a3032bf7243Ee4712f311f13915";
export const ROOT_VOTER = "0x49d7d4f17Ec56Ef8fA04E464AF5D1A4942CC31e6";
export const MINTER = "0x59268A34ba897e82368feE39839FFC661D4f9C97";
export const MAXTIME = 126144000n;

// ---- eth_call ----

const DRPC_SLUG = {
  1: "ethereum",
  42161: "arbitrum",
  4663: "robinhood",
  5042: "arc",
};
function rpcUrl(chain) {
  if (chain === 8453) return env.ENVIO_BASE_RPC_URL;
  if (chain === 10) return env.ENVIO_OPTIMISM_RPC_URL;
  if (chain === 57073) return env.ENVIO_INK_RPC_URL;
  return `https://lb.drpc.live/${DRPC_SLUG[chain]}/${env.ENVIO_DRPC_API_KEY}`;
}

function request(url, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = https.request(
      url,
      {
        method,
        family: 4,
        timeout: 120000,
        headers: { "content-type": "application/json", ...headers },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    r.on("error", reject);
    r.on("timeout", () => r.destroy(new Error("timeout")));
    if (body) r.write(body);
    r.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const counters = { rpcCalls: 0 };

/**
 * eth_call of `fn` (one human-readable ABI function) on `to` at `block`.
 * Always returns an array of outputs (viem unwraps single outputs).
 */
export async function call(chain, to, fn, args, block) {
  const abi = viem.parseAbi([fn]);
  const name = abi[0].name;
  const data = viem.encodeFunctionData({ abi, functionName: name, args });
  for (let attempt = 0; ; attempt++) {
    counters.rpcCalls++;
    let res;
    try {
      res = await request(
        rpcUrl(chain),
        "POST",
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to, data }, `0x${BigInt(block).toString(16)}`],
        }),
      );
    } catch (e) {
      res = { error: e.message };
    }
    if (res.result !== undefined) {
      const r = viem.decodeFunctionResult({
        abi,
        functionName: name,
        data: res.result,
      });
      return abi[0].outputs.length === 1 ? [r] : r;
    }
    if (attempt >= 3)
      throw new Error(`${chain} ${fn}: ${JSON.stringify(res.error)}`);
    await sleep(1500 * (attempt + 1));
  }
}

// ---- database ----

/** Rows of a Postgres query (COPY … CSV HEADER through `velo psql`). */
export function sql(inst, query) {
  const out = execFileSync(
    VELO,
    ["psql", inst, "-c", `COPY (${query}) TO STDOUT WITH CSV HEADER`],
    {
      encoding: "utf8",
      maxBuffer: 1 << 30,
    },
  );
  const lines = out.split("\n").filter((l) => l.length);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
}

/**
 * Rows of a ClickHouse query (TSVWithNames through `velo chsql`). Entity
 * tables are views holding the latest version of each id; BigInt columns
 * are strings, so cast (toInt256 / toUInt256) before summing.
 */
export function chsql(inst, query) {
  const out = execFileSync(
    VELO,
    ["chsql", inst, "-q", `${query} FORMAT TSVWithNames`],
    {
      encoding: "utf8",
      maxBuffer: 1 << 30,
    },
  );
  const lines = out.split("\n").filter((l) => l.length);
  if (lines.length === 0) return [];
  const header = lines[0].split("\t");
  return lines
    .slice(1)
    .map((l) =>
      Object.fromEntries(l.split("\t").map((c, i) => [header[i], c])),
    );
}

/** Each chain's stored progress block and its time, keyed by chain id. */
export function progress(inst) {
  const rows = sql(
    inst,
    "select id, progress_block, progress_block_time from envio_chains",
  );
  return new Map(
    rows.map((r) => [
      Number(r.id),
      {
        block: BigInt(r.progress_block),
        time: r.progress_block_time
          ? Math.floor(Date.parse(r.progress_block_time) / 1000)
          : null,
      },
    ]),
  );
}

function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/** Postgres array literal ("{a,b}") to a JS array of strings. */
export function pgArray(s) {
  return (s || "{}")
    .replace(/[{}]/g, "")
    .split(",")
    .filter(Boolean)
    .map((x) => x.replace(/^"|"$/g, ""));
}

// ---- HyperSync ----

async function hsPost(chain, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(
        `https://${chain}.hypersync.xyz/query`,
        "POST",
        JSON.stringify(body),
        {
          authorization: `Bearer ${env.ENVIO_API_TOKEN}`,
        },
      );
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
}

/** HyperSync's current height for a chain. */
export async function height(chain) {
  const res = await request(
    `https://${chain}.hypersync.xyz/height`,
    "GET",
    null,
    {
      authorization: `Bearer ${env.ENVIO_API_TOKEN}`,
    },
  );
  return res.height;
}

/**
 * Logs of `addresses` (null = any) with topic0 in `topic0s` (null = any),
 * from `from` to `to` exclusive. `minimal` returns block, address and topic0
 * only (much faster for counting).
 */
export async function* scan(
  chain,
  from,
  addresses,
  topic0s,
  to,
  minimal = false,
) {
  let next = Number(from);
  const end = to === undefined ? (await height(chain)) + 1 : Number(to);
  while (next < end) {
    const sel = {};
    if (addresses) sel.address = addresses;
    if (topic0s) sel.topics = [topic0s];
    const res = await hsPost(chain, {
      from_block: next,
      to_block: end,
      logs: [sel],
      field_selection: minimal
        ? { log: ["block_number", "address", "topic0"] }
        : {
            log: [
              "block_number",
              "log_index",
              "transaction_hash",
              "address",
              "topic0",
              "topic1",
              "topic2",
              "topic3",
              "data",
            ],
            block: ["number", "timestamp"],
          },
    });
    const ts = new Map();
    for (const batch of res.data)
      for (const b of batch.blocks ?? []) ts.set(b.number, b.timestamp);
    for (const batch of res.data) {
      for (const log of batch.logs ?? []) {
        log.timestamp = ts.get(log.block_number);
        yield log;
      }
    }
    if (res.next_block <= next) break;
    next = res.next_block;
  }
}

/** Unix timestamp of a block, from HyperSync. */
export async function blockTime(chain, block) {
  const res = await hsPost(chain, {
    from_block: Number(block),
    to_block: Number(block) + 1,
    include_all_blocks: true,
    field_selection: { block: ["number", "timestamp"] },
  });
  for (const batch of res.data)
    for (const b of batch.blocks ?? []) return Number(b.timestamp);
  throw new Error(`no block ${block} on ${chain}`);
}

/** topic0 of a human-readable event signature. */
export function selector(sig) {
  return viem.toEventSelector(viem.parseAbiItem(`event ${sig}`));
}

/** Decoded args of a log against a human-readable event signature. */
export function decode(sig, log) {
  const item = viem.parseAbiItem(`event ${sig}`);
  const topics = [log.topic0, log.topic1, log.topic2, log.topic3].filter(
    (t) => t,
  );
  return viem.decodeEventLog({
    abi: [item],
    data: log.data,
    topics,
    strict: false,
  }).args;
}

// ---- output ----

/** 18-decimal (or `dec`) amount with 4 decimals, for tables. */
export function fmt(x, dec = 18) {
  const v = BigInt(x);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = a.toString().padStart(dec + 1, "0");
  const r = `${s.slice(0, s.length - dec)}.${s.slice(s.length - dec, s.length - dec + 4)}`;
  return neg ? `-${r}` : r;
}

/** Markdown table writer. */
export class Report {
  constructor() {
    this.lines = [];
  }
  h(title) {
    this.lines.push(`\n### ${title}\n`);
  }
  head(...cells) {
    this.row(...cells);
    this.row(...cells.map(() => "---"));
  }
  row(...cells) {
    this.lines.push(`| ${cells.join(" | ")} |`);
  }
  note(text) {
    this.lines.push(text);
  }
  print() {
    console.log(this.lines.join("\n"));
  }
}
