// Cross-chain consistency of an Aero run that indexes Base and the leaf
// chains together. The indexer never joins chains itself (ADR 0006); this
// joins the root books (Base) with each leaf's own books and explains every
// difference. No RPC.
//
// Messages between root and leaves take time, and each chain stops at its
// own block, so a difference is "in flight" when the later side's change is
// within WINDOW_S of the earliest stop time of the two chains. Anything else
// is listed.
//
// Usage: node scripts/verify/aero/verify_crosschain.mjs <instance> [windowSeconds]
import {
  AERO_CHAINS,
  CHAIN_NAME,
  Report,
  blockTime,
  chsql,
  fmt,
  pgArray,
  progress,
  sql,
  viem,
} from "./lib.mjs";

const [inst, windowArg] = process.argv.slice(2);
const WINDOW_S = Number(windowArg ?? 3600);
const ROOT = 8453;
const ZERO = "0x0000000000000000000000000000000000000000";
// LeafVoter DEALLOC_GAUGE: last 20 bytes of keccak256("DROMOS_DEALLOC_GAUGE").
const DEALLOC = `0x${viem.keccak256(viem.toBytes("DROMOS_DEALLOC_GAUGE")).slice(-40)}`;
const prog = progress(inst);
const stop = new Map();
for (const c of AERO_CHAINS) {
  if (!prog.has(c)) continue;
  stop.set(c, prog.get(c).time ?? (await blockTime(c, prog.get(c).block)));
}
const leaves = AERO_CHAINS.filter((c) => prog.has(c));
const r = new Report();
const summary = [];
const ts = (s) => (s ? Math.floor(Date.parse(s) / 1000) : 0);
const iso = (t) => new Date(t * 1000).toISOString().replace(".000Z", "Z");

r.h("Stop points");
r.head("chain", "block", "time");
for (const c of leaves)
  r.row(`${CHAIN_NAME[c]} (${c})`, prog.get(c).block, iso(stop.get(c)));

// ---- 1. root chain budget vs leaf budget, per position and chain ----
const rootAlloc = sql(
  inst,
  `select "tokenId","targetChainId",amount,"lastUpdatedTimestamp" from "AeroRootAllocation" where "chainId"=${ROOT} and "targetChainId"<>0`,
);
const leafTok = sql(
  inst,
  `select "chainId","tokenId","chainAllocation",gauges,allocations,"lastAllocatedTimestamp","lastUpdatedTimestamp" from "AeroLeafTokenState"`,
);
const leafBy = new Map(leafTok.map((x) => [`${x.chainId}-${x.tokenId}`, x]));
const rootBy = new Map(
  rootAlloc.map((x) => [`${x.targetChainId}-${x.tokenId}`, x]),
);
r.h(
  "Root AeroRootAllocation.amount vs the leaf's AeroLeafTokenState.chainAllocation, per position (tolerance 0)",
);
r.head(
  "chain",
  "pairs",
  "exact",
  "in flight",
  "other",
  "root total",
  "leaf total",
);
const budgetOther = [];
for (const c of leaves) {
  const keys = new Set([
    ...rootAlloc
      .filter((x) => Number(x.targetChainId) === c)
      .map((x) => `${c}-${x.tokenId}`),
    ...leafTok
      .filter((x) => Number(x.chainId) === c)
      .map((x) => `${c}-${x.tokenId}`),
  ]);
  let exact = 0;
  let flight = 0;
  let other = 0;
  let rootTotal = 0n;
  let leafTotal = 0n;
  const horizon = Math.min(stop.get(ROOT), stop.get(c)) - WINDOW_S;
  for (const k of keys) {
    const ra = rootBy.get(k);
    const la = leafBy.get(k);
    const rv = BigInt(ra?.amount ?? 0);
    const lv = BigInt(la?.chainAllocation ?? 0);
    rootTotal += rv;
    leafTotal += lv;
    if (rv === lv) exact++;
    else if (
      Math.max(ts(ra?.lastUpdatedTimestamp), ts(la?.lastUpdatedTimestamp)) >=
      horizon
    )
      flight++;
    else {
      other++;
      budgetOther.push(
        `  ${CHAIN_NAME[c]} token ${k.split("-")[1]}: root ${fmt(rv)} (${ra?.lastUpdatedTimestamp ?? "-"}) leaf ${fmt(lv)} (${la?.lastUpdatedTimestamp ?? "-"})`,
      );
    }
  }
  r.row(
    `${CHAIN_NAME[c]} (${c})`,
    keys.size,
    exact,
    flight,
    other,
    fmt(rootTotal),
    fmt(leafTotal),
  );
  summary.push([`budgets ${CHAIN_NAME[c]}`, keys.size, other, flight]);
}
for (const l of budgetOther.slice(0, 30)) r.note(l);
if (budgetOther.length > 30) r.note(`  … ${budgetOther.length - 30} more`);

// ---- 2. gauge split dispatched by root vs the split each leaf applied ----
const votes = sql(
  inst,
  `select "tokenId","targetChainId",gauges,amounts,"lastDispatchedTimestamp" from "AeroRootGaugeVote" where "chainId"=${ROOT}`,
);
const gaugeRows = sql(
  inst,
  `select "chainId","gaugeAddress","isActivated","isRegistered","emissionCap" from "AeroGauge"`,
);
const gaugeBy = new Map(
  gaugeRows.map((g) => [`${g.chainId}-${g.gaugeAddress.toLowerCase()}`, g]),
);
r.h(
  "Root AeroRootGaugeVote (last dispatched split) vs the leaf's booked split (AeroLeafTokenState.gauges / allocations)",
);
r.head(
  "chain",
  "positions",
  "exact",
  "leaf parked unroutable gauges",
  "in flight",
  "leaf re-split later",
  "other",
);
const splitOther = [];
for (const c of leaves) {
  const rows = votes.filter((v) => Number(v.targetChainId) === c);
  let exact = 0;
  let parked = 0;
  let flight = 0;
  let resplit = 0;
  let other = 0;
  const horizon = Math.min(stop.get(ROOT), stop.get(c)) - WINDOW_S;
  for (const v of rows) {
    const want = new Map();
    const gs = pgArray(v.gauges).map((g) => g.toLowerCase());
    const as = pgArray(v.amounts).map(BigInt);
    gs.forEach((g, i) => {
      if (g !== ZERO && g !== DEALLOC && as[i] > 0n)
        want.set(g, (want.get(g) ?? 0n) + as[i]);
    });
    const la = leafBy.get(`${c}-${v.tokenId}`);
    const have = new Map();
    if (la) {
      const lg = pgArray(la.gauges).map((g) => g.toLowerCase());
      const lv = pgArray(la.allocations).map(BigInt);
      lg.forEach((g, i) => {
        if (lv[i] > 0n) have.set(g, (have.get(g) ?? 0n) + lv[i]);
      });
    }
    const same = (a, b) =>
      a.size === b.size && [...a].every(([k, x]) => b.get(k) === x);
    if (same(want, have)) {
      exact++;
      continue;
    }
    // Drop the root's entries the leaf cannot book: no gauge row, not
    // activated, or a zero cap (the position's zero-cap flag is not checked
    // here, so such entries land in "other").
    const routable = new Map(
      [...want].filter(([g]) => {
        const row = gaugeBy.get(`${c}-${g}`);
        return (
          row &&
          row.isRegistered === "t" &&
          row.isActivated === "t" &&
          row.emissionCap !== "0"
        );
      }),
    );
    const dispatched = ts(v.lastDispatchedTimestamp);
    const applied = ts(la?.lastAllocatedTimestamp);
    if (same(routable, have)) parked++;
    else if (dispatched >= horizon && dispatched >= applied) flight++;
    else if (applied > dispatched) resplit++;
    else {
      other++;
      splitOther.push(
        `  ${CHAIN_NAME[c]} token ${v.tokenId}: root ${JSON.stringify([...want].map(([g, x]) => [g.slice(0, 8), fmt(x)]))} @${v.lastDispatchedTimestamp}; leaf ${JSON.stringify([...have].map(([g, x]) => [g.slice(0, 8), fmt(x)]))} @${la?.lastAllocatedTimestamp ?? "-"}`,
      );
    }
  }
  r.row(
    `${CHAIN_NAME[c]} (${c})`,
    rows.length,
    exact,
    parked,
    flight,
    resplit,
    other,
  );
  summary.push([`gauge splits ${CHAIN_NAME[c]}`, rows.length, other, flight]);
}
for (const l of splitOther.slice(0, 30)) r.note(l);
if (splitOther.length > 30) r.note(`  … ${splitOther.length - 30} more`);

// ---- 3. redemptions: root's processed total per chain vs the leaf's own books ----
const rootChains = new Map(
  sql(
    inst,
    `select "targetChainId","totalRedeemed","numberOfRedemptions" from "AeroRootChainState" where "chainId"=${ROOT}`,
  ).map((x) => [Number(x.targetChainId), x]),
);
const leafStates = new Map(
  sql(
    inst,
    `select "chainId","totalRedeemed","numberOfRedemptions" from "AeroLeafVoterState"`,
  ).map((x) => [Number(x.chainId), x]),
);
const initiated = chsql(
  inst,
  `select chainId, recipient, amount, toUnixTimestamp(timestamp) t from AeroRedemptionEvent where kind='INITIATED' and chainId<>${ROOT}`,
);
const processed = chsql(
  inst,
  `select sourceChainId, recipient, amount, toUnixTimestamp(timestamp) t from AeroRedemptionEvent where kind='PROCESSED' and chainId=${ROOT}`,
);
r.h(
  "Redemptions: leaf Redeemed (AeroLeafVoterState) vs root RedeemProcessed for that chain (AeroRootChainState), matched row by row on (recipient, amount)",
);
r.head(
  "chain",
  "leaf redeemed (n)",
  "root processed (n)",
  "difference",
  "unmatched leaf rows (in flight / older)",
  "unmatched root rows",
);
for (const c of leaves) {
  const l = leafStates.get(c);
  const rt = rootChains.get(c);
  const lv = BigInt(l?.totalRedeemed ?? 0);
  const rv = BigInt(rt?.totalRedeemed ?? 0);
  let detail = "same chain";
  let unmatchedRoot = 0;
  let olderUnmatched = 0;
  if (c !== ROOT) {
    const pending = new Map();
    for (const x of initiated.filter((y) => Number(y.chainId) === c)) {
      const k = `${x.recipient.toLowerCase()}-${x.amount}`;
      if (!pending.has(k)) pending.set(k, []);
      pending.get(k).push(Number(x.t));
    }
    for (const x of processed.filter((y) => Number(y.sourceChainId) === c)) {
      const k = `${x.recipient.toLowerCase()}-${x.amount}`;
      const q = pending.get(k);
      if (q?.length) q.shift();
      else unmatchedRoot++;
    }
    const left = [...pending.values()].flat();
    const horizon = Math.min(stop.get(ROOT), stop.get(c)) - WINDOW_S;
    olderUnmatched = left.filter((t) => t < horizon).length;
    detail = `${left.length} (${left.length - olderUnmatched} in flight, ${olderUnmatched} older)`;
  }
  r.row(
    `${CHAIN_NAME[c]} (${c})`,
    `${fmt(lv)} (${l?.numberOfRedemptions ?? 0})`,
    `${fmt(rv)} (${rt?.numberOfRedemptions ?? 0})`,
    fmt(lv - rv),
    detail,
    unmatchedRoot,
  );
  summary.push([
    `redemptions ${CHAIN_NAME[c]}`,
    1,
    unmatchedRoot + olderUnmatched + (c === ROOT && lv !== rv ? 1 : 0),
    0,
  ]);
}

// ---- 4. Minter minted vs the sum of redemptions processed on the root ----
const [minter] = sql(
  inst,
  `select "totalMinted" from "AeroMinterState" where "chainId"=${ROOT}`,
);
let processedTotal = 0n;
let bufferDrawn = 0n;
let surplusSpent = 0n;
for (const x of sql(
  inst,
  `select "totalRedeemed","totalBufferDrawn","totalSurplusSpent" from "AeroRootChainState" where "chainId"=${ROOT}`,
)) {
  processedTotal += BigInt(x.totalRedeemed);
  bufferDrawn += BigInt(x.totalBufferDrawn);
  surplusSpent += BigInt(x.totalSurplusSpent);
}
const minted = BigInt(minter?.totalMinted ?? 0);
r.h(
  "Minter: AeroMinterState.totalMinted vs the sum of AeroRootChainState.totalRedeemed over all chains",
);
r.head("minted", "sum redeemed", "difference", "buffer drawn", "surplus spent");
r.row(
  fmt(minted),
  fmt(processedTotal),
  fmt(minted - processedTotal),
  fmt(bufferDrawn),
  fmt(surplusSpent),
);
summary.push([
  "Minter minted = sum of root redemptions",
  1,
  minted === processedTotal ? 0 : 1,
  0,
]);

// ---- 5. Optimism migrations vs their settlements on Base ----
const opRows = chsql(
  inst,
  `select kind, recipient, amountOut, isLiquid, toUnixTimestamp(timestamp) t from AeroMigrationEvent where chainId=10 and kind in ('VENFT','LIQUID')`,
);
const settled = chsql(
  inst,
  `select recipient, amountOut, isLiquid, toUnixTimestamp(timestamp) t from AeroMigrationEvent where chainId=${ROOT} and kind='SETTLED'`,
);
if (prog.has(10)) {
  const pending = new Map();
  let opTotal = 0n;
  for (const x of opRows) {
    opTotal += BigInt(x.amountOut);
    const k = `${x.recipient.toLowerCase()}-${x.amountOut}-${x.isLiquid}`;
    if (!pending.has(k)) pending.set(k, []);
    pending.get(k).push(Number(x.t));
  }
  let settledTotal = 0n;
  let unmatchedSettled = 0;
  for (const x of settled) {
    settledTotal += BigInt(x.amountOut);
    const k = `${x.recipient.toLowerCase()}-${x.amountOut}-${x.isLiquid}`;
    const q = pending.get(k);
    if (q?.length) q.shift();
    else unmatchedSettled++;
  }
  const left = [...pending.values()].flat();
  const horizon = Math.min(stop.get(ROOT), stop.get(10)) - WINDOW_S;
  const older = left.filter((t) => t < horizon).length;
  r.h(
    "Migration: Optimism VeNFTMigrated + LiquidMigrated vs Base entrypoint Migrated, matched on (recipient, amount, liquid)",
  );
  r.head(
    "Optimism migrations (AERO out)",
    "Base settlements (AERO)",
    "unsettled (in flight / older)",
    "settlements with no Optimism migration",
  );
  r.row(
    `${opRows.length} (${fmt(opTotal)})`,
    `${settled.length} (${fmt(settledTotal)})`,
    `${left.length} (${left.length - older} / ${older})`,
    unmatchedSettled,
  );
  summary.push([
    "Optimism migrations settled on Base",
    opRows.length,
    unmatchedSettled + older,
    left.length - older,
  ]);
}

r.h("Summary");
r.head("check", "checked", "unexplained", "in flight");
for (const [c, n, x, f] of summary) r.row(c, n, x, f);
r.print();
