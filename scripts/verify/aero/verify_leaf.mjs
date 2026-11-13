// Leaf-side checks of one Aero chain (gauges, staking, emissions, leaf
// allocations) against eth_call state at the chain's stored progress block.
// Every chain has a LeafVoter, Base included.
//
// Usage: node scripts/verify/aero/verify_leaf.mjs <instance> <chainId> [block] [usersPerGauge] [maxWeightPositions]
//
// RPC: about 3 calls per gauge + usersPerGauge per gauge + 120 for the
// allocation samples + one per position for the weight rebuild.
import {
  CHAIN_NAME,
  LEAF_VOTER,
  MAXTIME,
  Report,
  call,
  chsql,
  counters,
  fmt,
  pgArray,
  progress,
  sql,
} from "./lib.mjs";

const [inst, chainArg, blockArg, usersArg, weightArg] = process.argv.slice(2);
const chain = Number(chainArg);
const B =
  blockArg && blockArg !== "-"
    ? BigInt(blockArg)
    : progress(inst).get(chain).block;
const MAX_USERS = Number(usersArg ?? 5);
const MAX_WEIGHT_POSITIONS = Number(weightArg ?? 40);
const name = `${CHAIN_NAME[chain]} (${chain})`;
const r = new Report();
const summary = [];

// ---- per-gauge emission ledger vs LeafVoter.gaugeStates ----
const gauges = sql(
  inst,
  `select "gaugeAddress","poolAddress","isCL","totalEmissionsCredited","totalEmissionsMinted","totalEmissionsForfeited","totalAllocated" from "AeroGauge" where "chainId"=${chain} order by "gaugeAddress"`,
);
r.h(
  `${name} @ ${B}: per-gauge emissions vs LeafVoter.gaugeStates (tolerance 0)`,
);
r.head(
  "gauge",
  "credited idx",
  "credited chain",
  "minted idx",
  "minted chain",
  "forfeited idx",
  "forfeited chain",
  "ok",
);
const states = new Map();
let gaugeMismatches = 0;
for (const g of gauges) {
  const s = await call(
    chain,
    LEAF_VOTER,
    "function gaugeStates(address) view returns (uint128,uint128,uint48,bool,bool,uint128,uint256,uint256,(int128 bias,int128 slope,uint48 ts,uint128 permanentStakeBalance))",
    [g.gaugeAddress],
    B,
  );
  states.set(g.gaugeAddress, s);
  const ok =
    BigInt(g.totalEmissionsCredited) === s[0] &&
    BigInt(g.totalEmissionsMinted) === s[1] &&
    BigInt(g.totalEmissionsForfeited) === s[5];
  if (!ok) gaugeMismatches++;
  r.row(
    g.gaugeAddress.slice(0, 10),
    fmt(g.totalEmissionsCredited),
    fmt(s[0]),
    fmt(g.totalEmissionsMinted),
    fmt(s[1]),
    fmt(g.totalEmissionsForfeited),
    fmt(s[5]),
    ok ? "yes" : "NO",
  );
}
summary.push([
  "gauge ledger (credited / minted / forfeited)",
  gauges.length,
  gaugeMismatches,
]);

// ---- chain totals ----
const [state] = sql(
  inst,
  `select * from "AeroLeafVoterState" where "chainId"=${chain}`,
);
const [surplus] = await call(
  chain,
  LEAF_VOTER,
  "function surplusAccrued() view returns (uint256)",
  [],
  B,
);
const [receipt] = await call(
  chain,
  LEAF_VOTER,
  "function RECEIPT_TOKEN() view returns (address)",
  [],
  B,
);
const [supply] = await call(
  chain,
  receipt,
  "function totalSupply() view returns (uint256)",
  [],
  B,
);
r.h(`${name}: chain totals (tolerance 0)`);
r.head("check", "indexed", "chain", "ok");
const surplusIdx =
  BigInt(state.totalCapSurplus) + BigInt(state.totalEmissionsForfeited);
r.row(
  "surplusAccrued = cap surplus + forfeited",
  fmt(surplusIdx),
  fmt(surplus),
  surplusIdx === surplus ? "yes" : "NO",
);
r.row(
  "xAERO totalSupply = minted - redeemed",
  fmt(state.receiptTokenSupply),
  fmt(supply),
  BigInt(state.receiptTokenSupply) === supply ? "yes" : "NO",
);
r.row("minted (EmissionsMinted)", fmt(state.totalEmissionsMinted), "-", "");
r.row("redeemed (Redeemed)", fmt(state.totalRedeemed), "-", "");
summary.push(["surplusAccrued", 1, surplusIdx === surplus ? 0 : 1]);
summary.push([
  "receipt token totalSupply",
  1,
  BigInt(state.receiptTokenSupply) === supply ? 0 : 1,
]);

// ---- staked liquidity per gauge ----
r.h(
  `${name}: staked liquidity (CL: pool.stakedLiquidity() vs Pool.stakedLiquidityInRange; V2: gauge.totalSupply() vs Pool.currentLiquidityStaked; tolerance 0)`,
);
r.head(
  "gauge",
  "pool",
  "kind",
  "indexed",
  "chain",
  "ok",
  "staked positions sum L = currentLiquidityStaked",
);
let stakedMismatch = 0;
let posSumMismatch = 0;
let stakedChecked = 0;
for (const g of gauges) {
  const [pool] = sql(
    inst,
    `select "stakedLiquidityInRange","currentLiquidityStaked" from "Pool" where id='${chain}-${g.poolAddress}'`,
  );
  if (!pool) continue;
  stakedChecked++;
  if (g.isCL === "t") {
    const [onchain] = await call(
      chain,
      g.poolAddress,
      "function stakedLiquidity() view returns (uint128)",
      [],
      B,
    );
    const [posSum] = sql(
      inst,
      `select coalesce(sum(liquidity),0) as s, count(*) as n from "NonFungiblePosition" where "chainId"=${chain} and pool='${g.poolAddress}' and "isStakedInGauge"`,
    );
    const ok = BigInt(pool.stakedLiquidityInRange || "0") === onchain;
    const posOk = BigInt(posSum.s) === BigInt(pool.currentLiquidityStaked);
    if (!ok) stakedMismatch++;
    if (!posOk) posSumMismatch++;
    r.row(
      g.gaugeAddress.slice(0, 10),
      g.poolAddress.slice(0, 10),
      "CL",
      pool.stakedLiquidityInRange,
      onchain.toString(),
      ok ? "yes" : "NO",
      `${posSum.s} (${posSum.n} pos) vs ${pool.currentLiquidityStaked} ${posOk ? "yes" : "NO"}`,
    );
  } else {
    const [onchain] = await call(
      chain,
      g.gaugeAddress,
      "function totalSupply() view returns (uint256)",
      [],
      B,
    );
    const ok = BigInt(pool.currentLiquidityStaked) === onchain;
    if (!ok) stakedMismatch++;
    r.row(
      g.gaugeAddress.slice(0, 10),
      g.poolAddress.slice(0, 10),
      "V2",
      pool.currentLiquidityStaked,
      onchain.toString(),
      ok ? "yes" : "NO",
      "",
    );
  }
}
summary.push(["staked liquidity per gauge", stakedChecked, stakedMismatch]);
summary.push([
  "staked CL positions sum = Pool.currentLiquidityStaked",
  stakedChecked,
  posSumMismatch,
]);

// ---- largest stakers per gauge vs gauge state ----
r.h(
  `${name}: largest stakers per gauge vs gauge.stakedValues / balanceOf (exact)`,
);
r.head("gauge", "user", "indexed", "chain", "ok");
let userChecks = 0;
let userMismatches = 0;
for (const g of gauges) {
  const users = sql(
    inst,
    `select "userAddress","stakedCLPositionTokenIds","currentLiquidityStaked" from "UserStatsPerPool" where "chainId"=${chain} and "poolAddress"='${g.poolAddress}' and "currentLiquidityStaked" > 0 order by "currentLiquidityStaked" desc limit ${MAX_USERS}`,
  );
  for (const u of users) {
    userChecks++;
    if (g.isCL === "t") {
      const [vals] = await call(
        chain,
        g.gaugeAddress,
        "function stakedValues(address) view returns (uint256[])",
        [u.userAddress],
        B,
      );
      const idx = pgArray(u.stakedCLPositionTokenIds).map(BigInt).sort();
      const onc = [...vals].sort();
      const ok = idx.length === onc.length && idx.every((v, i) => v === onc[i]);
      if (!ok) userMismatches++;
      r.row(
        g.gaugeAddress.slice(0, 10),
        u.userAddress.slice(0, 10),
        `${idx.length} ids`,
        `${onc.length} ids`,
        ok ? "yes" : "NO",
      );
    } else {
      const [bal] = await call(
        chain,
        g.gaugeAddress,
        "function balanceOf(address) view returns (uint256)",
        [u.userAddress],
        B,
      );
      const ok = BigInt(u.currentLiquidityStaked) === bal;
      if (!ok) userMismatches++;
      r.row(
        g.gaugeAddress.slice(0, 10),
        u.userAddress.slice(0, 10),
        u.currentLiquidityStaked,
        bal.toString(),
        ok ? "yes" : "NO",
      );
    }
  }
}
summary.push(["largest stakers per gauge", userChecks, userMismatches]);

// ---- leaf allocations vs LeafVoter ----
const allocs = sql(
  inst,
  `select "tokenId","gaugeAddress",allocated from "AeroLeafAllocation" where "chainId"=${chain} order by allocated desc`,
);
const sampleAllocs = allocs.slice(0, 60);
let allocMismatch = 0;
for (const a of sampleAllocs) {
  const [onc] = await call(
    chain,
    LEAF_VOTER,
    "function allocations(uint256,address) view returns (uint128)",
    [BigInt(a.tokenId), a.gaugeAddress],
    B,
  );
  if (onc !== BigInt(a.allocated)) {
    allocMismatch++;
    r.note(
      `  alloc mismatch token ${a.tokenId} gauge ${a.gaugeAddress}: indexed ${a.allocated} chain ${onc}`,
    );
  }
}
const tokens = sql(
  inst,
  `select "tokenId","chainAllocation" from "AeroLeafTokenState" where "chainId"=${chain} order by "chainAllocation" desc limit 60`,
);
let budgetMismatch = 0;
for (const t of tokens) {
  const ts = await call(
    chain,
    LEAF_VOTER,
    "function tokenStates(uint256) view returns (address,uint48,bool,uint128)",
    [BigInt(t.tokenId)],
    B,
  );
  if (ts[3] !== BigInt(t.chainAllocation)) {
    budgetMismatch++;
    r.note(
      `  budget mismatch token ${t.tokenId}: indexed ${t.chainAllocation} chain ${ts[3]}`,
    );
  }
}
r.h(`${name}: leaf allocations vs LeafVoter (largest 60 each; tolerance 0)`);
r.head("check", "sampled", "mismatches");
r.row(
  "allocations(tokenId, gauge) vs AeroLeafAllocation.allocated",
  sampleAllocs.length,
  allocMismatch,
);
r.row(
  "tokenStates(tokenId).chainAllocation vs AeroLeafTokenState.chainAllocation",
  tokens.length,
  budgetMismatch,
);
summary.push([
  "leaf allocations (largest)",
  sampleAllocs.length,
  allocMismatch,
]);
summary.push(["leaf budgets (largest)", tokens.length, budgetMismatch]);

// ---- gauge weight vs the gauge's point ----
// Permanent part exact; the decaying bias rebuilt at point.ts from the booked
// allocations and the leaf's tokenSnapshot (one call per position).
r.h(
  `${name}: gauge weight vs LeafVoter point (permanent and bias at point.ts; tolerance 0)`,
);
r.head(
  "gauge",
  "totalAllocated (idx)",
  "perm idx",
  "perm chain",
  "bias idx@ts",
  "bias chain@ts",
  "ok",
);
const snapshots = new Map();
let weightChecked = 0;
let weightMismatch = 0;
let weightSkipped = 0;
for (const g of gauges) {
  const point = states.get(g.gaugeAddress)[8];
  const rows = allocs.filter(
    (a) => a.gaugeAddress === g.gaugeAddress && BigInt(a.allocated) > 0n,
  );
  if (rows.length > MAX_WEIGHT_POSITIONS) {
    weightSkipped++;
    r.row(
      g.gaugeAddress.slice(0, 10),
      fmt(g.totalAllocated),
      "-",
      fmt(point.permanentStakeBalance),
      "-",
      fmt(point.bias),
      `skipped (${rows.length} positions)`,
    );
    continue;
  }
  let perm = 0n;
  let bias = 0n;
  for (const a of rows) {
    const id = BigInt(a.tokenId);
    let snap = snapshots.get(id);
    if (!snap) {
      snap = await call(
        chain,
        LEAF_VOTER,
        "function tokenSnapshot(uint256) view returns (uint128,uint48,bool)",
        [id],
        B,
      );
      snapshots.set(id, snap);
    }
    const amount = BigInt(a.allocated);
    if (snap[2]) perm += amount;
    else if (BigInt(snap[1]) > BigInt(point.ts))
      bias += (amount / MAXTIME) * (BigInt(snap[1]) - BigInt(point.ts));
  }
  const ok = perm === point.permanentStakeBalance && bias === point.bias;
  weightChecked++;
  if (!ok) weightMismatch++;
  r.row(
    g.gaugeAddress.slice(0, 10),
    fmt(g.totalAllocated),
    fmt(perm),
    fmt(point.permanentStakeBalance),
    fmt(bias),
    fmt(point.bias),
    ok ? "yes" : "NO",
  );
}
summary.push([
  `gauge weights (skipped ${weightSkipped} with > ${MAX_WEIGHT_POSITIONS} positions)`,
  weightChecked,
  weightMismatch,
]);

// ---- rewards rows (compared with logs by verify_logs.mjs) ----
const rewards = chsql(
  inst,
  `select kind, count() n, toString(sum(toInt256(amount))) s from AeroVotingRewardsEvent where chainId=${chain} group by kind order by kind`,
);
r.h(`${name}: AeroVotingRewardsEvent rows`);
r.head("kind", "rows", "sum raw amount");
for (const x of rewards) r.row(x.kind, x.n, x.s);

r.h(`${name} @ ${B}: summary`);
r.head("check", "checked", "mismatches");
for (const [c, n, m] of summary) r.row(c, n, m);
r.note(`\nRPC calls: ${counters.rpcCalls}`);
r.print();
