// Phase 1 checks of one chain's Aero pools against HyperSync, up to the
// chain's stored progress block: PoolCreated per Aero factory vs indexed
// pools, and Swap logs vs Pool.numberOfSwaps on a sample of pools
// (SWAP_SAMPLE, default 50: the busiest half plus a random half). No RPC.
//
// Usage: node scripts/verify/aero/verify_swaps.mjs <instance> <chainId> [block]
import {
  CHAIN_NAME,
  Report,
  progress,
  scan,
  selector,
  sql,
  viem,
} from "./lib.mjs";

const [inst, chainArg, blockArg] = process.argv.slice(2);
const chain = Number(chainArg);
const B =
  blockArg && blockArg !== "-"
    ? BigInt(blockArg)
    : progress(inst).get(chain).block;
const [{ start_block: from }] = sql(
  inst,
  `select start_block from envio_chains where id=${chain}`,
);
const to = Number(B) + 1;
const name = `${CHAIN_NAME[chain]} (${chain})`;

const V2_SWAP = selector(
  "Swap(address indexed sender, address indexed to, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out)",
);
const CL_SWAP = selector(
  "Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);
const V2_CREATED = selector(
  "PoolCreated(address indexed token0, address indexed token1, address pool, uint256 poolCount)",
);
const CL_CREATED = selector(
  "PoolCreated(address indexed token0, address indexed token1, int24 indexed tickSpacing, address pool)",
);

// Swap counts on a sample: the busiest half of SAMPLE pools plus a random half.
const SAMPLE = Number(process.env.SWAP_SAMPLE ?? 50);
const half = Math.floor(SAMPLE / 2);
const where = `"chainId"=${chain} and deployment='AERO'`;
const pools = sql(
  inst,
  `(select "poolAddress","isCL","numberOfSwaps" from "Pool" where ${where} order by "numberOfSwaps" desc limit ${half})
   union (select "poolAddress","isCL","numberOfSwaps" from "Pool" where ${where} order by random() limit ${SAMPLE - half})`,
);
const r = new Report();

// ---- pool inventory per factory (all pools) ----
const byFactory = new Map(
  sql(
    inst,
    `select coalesce("factoryAddress",'(none)') f, count(*) n from "Pool" where ${where} group by 1`,
  ).map((x) => [x.f, Number(x.n)]),
);
const factories = [...byFactory.keys()].filter((f) => f !== "(none)");
const created = new Map();
for await (const log of scan(
  chain,
  from,
  factories,
  [V2_CREATED, CL_CREATED],
  to,
  true,
)) {
  const f = viem.getAddress(log.address);
  created.set(f, (created.get(f) ?? 0) + 1);
}
r.h(`${name} @ ${B}: Aero pools per factory vs PoolCreated logs`);
r.head("factory", "indexed pools", "PoolCreated logs", "ok");
let invMismatch = 0;
for (const [f, n] of byFactory) {
  const l = created.get(f) ?? 0;
  if (n !== l) invMismatch++;
  r.row(f, n, f === "(none)" ? "-" : l, n === l ? "yes" : "NO");
}

// ---- swaps per pool ----
const counts = new Map();
const addrs = pools.map((p) => p.poolAddress);
for (let i = 0; i < addrs.length; i += 1000) {
  for await (const log of scan(
    chain,
    from,
    addrs.slice(i, i + 1000),
    [V2_SWAP, CL_SWAP],
    to,
    true,
  )) {
    const a = viem.getAddress(log.address);
    counts.set(a, (counts.get(a) ?? 0n) + 1n);
  }
}
let mismatch = 0;
let idxTotal = 0n;
let logTotal = 0n;
const bad = [];
for (const p of pools) {
  const l = counts.get(p.poolAddress) ?? 0n;
  const i = BigInt(p.numberOfSwaps);
  idxTotal += i;
  logTotal += l;
  if (i !== l) {
    mismatch++;
    bad.push(
      `  ${p.poolAddress} (${p.isCL === "t" ? "CL" : "V2"}): indexed ${i} logs ${l}`,
    );
  }
}
r.h(
  `${name}: swaps per Aero pool, Pool.numberOfSwaps vs Swap logs (tolerance 0)`,
);
r.head(
  "pools sampled",
  "pools with swaps",
  "mismatches",
  "swaps indexed",
  "swaps in logs",
);
r.row(pools.length, [...counts.keys()].length, mismatch, idxTotal, logTotal);
for (const l of bad.slice(0, 30)) r.note(l);
if (bad.length > 30) r.note(`  … ${bad.length - 30} more`);
r.h(`${name}: summary`);
r.head("check", "checked", "mismatches");
r.row("pools per factory", byFactory.size, invMismatch);
r.row("swaps per sampled pool", pools.length, mismatch);
r.print();
