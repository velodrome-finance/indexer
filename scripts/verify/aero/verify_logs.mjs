// Indexed emission and rewards totals of one Aero chain vs the same logs
// summed straight from HyperSync, up to the chain's stored progress block.
// No RPC.
//
// Usage: node scripts/verify/aero/verify_logs.mjs <instance> <chainId> [block]
import {
  CHAIN_NAME,
  LEAF_VOTER,
  Report,
  chsql,
  decode,
  fmt,
  progress,
  scan,
  selector,
  sql,
  viem,
} from "./lib.mjs";

const [inst, chainArg, blockArg] = process.argv.slice(2);
const chain = Number(chainArg);
const prog = progress(inst);
const B =
  blockArg && blockArg !== "-" ? BigInt(blockArg) : prog.get(chain).block;
const [{ start_block: from }] = sql(
  inst,
  `select start_block from envio_chains where id=${chain}`,
);
const to = Number(B) + 1;
const name = `${CHAIN_NAME[chain]} (${chain})`;

const SIG = {
  minted:
    "EmissionsMinted(address indexed gauge, address[] recipients, uint128[] amounts)",
  claimedCL:
    "EmissionsClaimed(address indexed account, uint256 indexed tokenId, address indexed recipient, uint256 rewardAmount)",
  claimedV2:
    "EmissionsClaimed(address indexed account, address indexed recipient, uint256 rewardAmount)",
  deferredClaimed:
    "DeferredEmissionsClaimed(address indexed account, address indexed recipient, uint256 amount)",
  referralClaimed:
    "ReferralEmissionsClaimed(address indexed referral, address indexed recipient, uint256 amount)",
  claimFees:
    "ClaimFees(uint256 indexed tokenId, address indexed recipient, address indexed token, uint256 amount)",
  claimIncentives:
    "ClaimIncentives(uint256 indexed tokenId, address indexed recipient, uint256 indexed programId, uint256 amount)",
  feesCollected:
    "FeesCollected(address indexed gauge, address indexed token, uint256 amount)",
  incentiveCreated:
    "IncentiveCreated(uint256 indexed programId, address indexed token, address indexed creator, uint256 amount, uint48 start, uint48 duration)",
  redeemed:
    "Redeemed(address indexed redeemer, address indexed recipient, uint256 amount)",
};
const bySel = new Map(Object.entries(SIG).map(([k, s]) => [selector(s), k]));

const gauges = sql(
  inst,
  `select "gaugeAddress","totalEmissionsMinted","totalEmissionsClaimed","totalDeferredEmissionsClaimed","totalReferralEmissionsClaimed" from "AeroGauge" where "chainId"=${chain}`,
);
const vrms = sql(
  inst,
  `select address from "AeroVotingRewardsManager" where "chainId"=${chain}`,
).map((x) => x.address);
const [state] = sql(
  inst,
  `select "totalRedeemed","numberOfRedemptions" from "AeroLeafVoterState" where "chainId"=${chain}`,
);

const logMinted = new Map();
const logPaid = new Map();
const sums = new Map();
const add = (m, k, v) => m.set(k, (m.get(k) ?? 0n) + v);

for await (const log of scan(
  chain,
  from,
  [LEAF_VOTER],
  [selector(SIG.minted), selector(SIG.redeemed)],
  to,
)) {
  const k = bySel.get(log.topic0);
  const a = decode(SIG[k], log);
  if (k === "minted")
    add(
      logMinted,
      viem.getAddress(a.gauge),
      a.amounts.reduce((x, y) => x + y, 0n),
    );
  else {
    add(sums, "redeemed", a.amount);
    add(sums, "redeemed#n", 1n);
  }
}
const gaugeAddrs = gauges.map((g) => g.gaugeAddress);
const claimSels = [
  "claimedCL",
  "claimedV2",
  "deferredClaimed",
  "referralClaimed",
].map((k) => selector(SIG[k]));
for (let i = 0; i < gaugeAddrs.length; i += 500) {
  for await (const log of scan(
    chain,
    from,
    gaugeAddrs.slice(i, i + 500),
    claimSels,
    to,
  )) {
    const a = decode(SIG[bySel.get(log.topic0)], log);
    add(logPaid, viem.getAddress(log.address), a.rewardAmount ?? a.amount);
  }
}
const rewardSels = [
  "claimFees",
  "claimIncentives",
  "feesCollected",
  "incentiveCreated",
].map((k) => selector(SIG[k]));
for (let i = 0; i < vrms.length; i += 500) {
  for await (const log of scan(
    chain,
    from,
    vrms.slice(i, i + 500),
    rewardSels,
    to,
  )) {
    const k = bySel.get(log.topic0);
    add(sums, k, decode(SIG[k], log).amount);
    add(sums, `${k}#n`, 1n);
  }
}

const r = new Report();
let mintMismatch = 0;
let paidMismatch = 0;
let mintedTotal = 0n;
for (const g of gauges) {
  const lm = logMinted.get(g.gaugeAddress) ?? 0n;
  const lp = logPaid.get(g.gaugeAddress) ?? 0n;
  mintedTotal += lm;
  if (lm !== BigInt(g.totalEmissionsMinted)) mintMismatch++;
  const paid =
    BigInt(g.totalEmissionsClaimed) +
    BigInt(g.totalDeferredEmissionsClaimed) +
    BigInt(g.totalReferralEmissionsClaimed);
  if (lp !== paid || lp !== lm) {
    paidMismatch++;
    r.note(
      `  gauge ${g.gaugeAddress}: minted log ${lm} idx ${g.totalEmissionsMinted}; paid log ${lp} idx ${paid}`,
    );
  }
}
const gaugesWithoutRow = [...logMinted.keys()].filter(
  (k) => !gaugeAddrs.includes(k),
);
r.h(`${name} @ ${B}: emissions vs summed logs (tolerance 0)`);
r.head("check", "gauges", "mismatches", "total (logs)");
r.row(
  "sum EmissionsMinted per gauge vs AeroGauge.totalEmissionsMinted",
  gauges.length,
  mintMismatch,
  fmt(mintedTotal),
);
r.row(
  "gauge claims (claimed + deferred + referral) per gauge = minted",
  gauges.length,
  paidMismatch,
  "",
);
r.row(
  "gauges in EmissionsMinted logs with no AeroGauge row",
  gaugesWithoutRow.length,
  gaugesWithoutRow.length,
  "",
);
const redOk =
  BigInt(state.totalRedeemed) === (sums.get("redeemed") ?? 0n) &&
  BigInt(state.numberOfRedemptions) === (sums.get("redeemed#n") ?? 0n);
r.row(
  `Redeemed: idx ${fmt(state.totalRedeemed)} (${state.numberOfRedemptions}) vs logs ${fmt(sums.get("redeemed") ?? 0n)} (${sums.get("redeemed#n") ?? 0n})`,
  1,
  redOk ? 0 : 1,
  "",
);

const idx = chsql(
  inst,
  `select kind, count() n, toString(sum(toInt256(amount))) s from AeroVotingRewardsEvent where chainId=${chain} group by kind`,
);
const idxBy = new Map(idx.map((x) => [x.kind, x]));
const MAP = {
  FEES_CLAIMED: "claimFees",
  INCENTIVE_CLAIMED: "claimIncentives",
  FEES_COLLECTED: "feesCollected",
  INCENTIVE_CREATED: "incentiveCreated",
};
r.h(
  `${name}: rewards-manager flows vs summed logs (raw units summed across tokens; tolerance 0)`,
);
r.head("kind", "rows idx", "logs", "sum idx", "sum logs", "ok");
for (const [kind, k] of Object.entries(MAP)) {
  const x = idxBy.get(kind);
  const ls = sums.get(k) ?? 0n;
  const ln = sums.get(`${k}#n`) ?? 0n;
  const ok = BigInt(x?.s ?? 0) === ls && BigInt(x?.n ?? 0) === ln;
  r.row(kind, x?.n ?? 0, ln, x?.s ?? 0, ls, ok ? "yes" : "NO");
}
r.print();
