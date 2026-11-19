// HyperSync command line: event inventories and decoded log dumps, for
// finding what a contract emits before indexing it. No RPC.
//
//   node scripts/verify/aero/hs.mjs height <chainId>
//   node scripts/verify/aero/hs.mjs inv <chainId> <fromBlock> <addr[,addr…]> [toBlock]
//       per (address, event): count, first and last block; events named from signatures.txt
//   node scripts/verify/aero/hs.mjs logs <chainId> <fromBlock> <addr[,addr…]|*> "<event signature>" [toBlock|-] [limit]
//       one JSON line per decoded log
import fs from "node:fs";
import { decode, height, scan, selector } from "./lib.mjs";

const known = fs
  .readFileSync(new URL("./signatures.txt", import.meta.url), "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith("#"));
const bySel = new Map();
for (const sig of known) {
  const sel = selector(sig);
  if (!bySel.has(sel)) bySel.set(sel, []);
  bySel.get(sel).push(sig);
}
const json = (v) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "height") {
  console.log(await height(Number(args[0])));
} else if (cmd === "inv") {
  const [chain, from, addrs, to] = args;
  const counts = new Map();
  for await (const log of scan(
    Number(chain),
    Number(from),
    addrs.split(","),
    null,
    to ? Number(to) : undefined,
    true,
  )) {
    const key = `${log.address.toLowerCase()} ${log.topic0}`;
    const c = counts.get(key) ?? { n: 0, first: log.block_number, last: 0 };
    c.n++;
    c.last = log.block_number;
    counts.set(key, c);
  }
  for (const [key, c] of [...counts.entries()].sort()) {
    const [addr, t0] = key.split(" ");
    console.log(
      addr,
      String(c.n).padStart(8),
      c.first,
      c.last,
      (bySel.get(t0) ?? [t0]).join(" | "),
    );
  }
} else if (cmd === "logs") {
  const [chain, from, addrs, sig, to, limit] = args;
  let n = 0;
  for await (const log of scan(
    Number(chain),
    Number(from),
    addrs === "*" ? null : addrs.split(","),
    [selector(sig)],
    to && to !== "-" ? Number(to) : undefined,
  )) {
    let decoded;
    try {
      decoded = decode(sig, log);
    } catch (e) {
      decoded = { decodeError: e.message.split("\n")[0] };
    }
    console.log(
      json({
        b: log.block_number,
        i: log.log_index,
        ts: log.timestamp,
        tx: log.transaction_hash,
        a: log.address,
        args: decoded,
      }),
    );
    if (limit && ++n >= Number(limit)) break;
  }
} else {
  console.error("usage: hs.mjs height|inv|logs …");
  process.exit(1);
}
