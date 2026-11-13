// Root-side checks on Base (sAERO escrow, root allocation ledger, per-chain
// redemption totals, Minter, migration) against eth_call state at Base's
// stored progress block.
//
// Usage: node scripts/verify/aero/verify_root.mjs <instance> [block] [samples]
//
// RPC: about 2 * samples + 10 + one per registered chain.
import {
  MINTER,
  ROOT_VOTER,
  Report,
  VOTING_ESCROW,
  call,
  chsql,
  counters,
  fmt,
  progress,
  sql,
} from "./lib.mjs";

const [inst, blockArg, samplesArg] = process.argv.slice(2);
const chain = 8453;
const B =
  blockArg && blockArg !== "-"
    ? BigInt(blockArg)
    : progress(inst).get(chain).block;
const N = Number(samplesArg ?? 60);
const r = new Report();
const summary = [];

// ---- escrow ----
const [escrow] = sql(
  inst,
  `select * from "SAeroEscrowState" where "chainId"=${chain}`,
);
const [posSum] = sql(
  inst,
  `select coalesce(sum(amount),0) s, count(*) n from "SAeroPosition" where "chainId"=${chain}`,
);
const [supply] = await call(
  chain,
  VOTING_ESCROW,
  "function supply() view returns (uint128)",
  [],
  B,
);
const [perm] = await call(
  chain,
  VOTING_ESCROW,
  "function permanentStakeBalance() view returns (uint128)",
  [],
  B,
);
const [lastId] = await call(
  chain,
  VOTING_ESCROW,
  "function tokenId() view returns (uint256)",
  [],
  B,
);
r.h(`Base @ ${B}: sAERO escrow (tolerance 0)`);
r.head("check", "indexed", "chain", "ok");
const escrowChecks = [
  ["supply", BigInt(escrow.supply), supply],
  ["sum of SAeroPosition.amount = supply", BigInt(posSum.s), supply],
  ["permanentStakeBalance", BigInt(escrow.permanentStakeBalance), perm],
];
for (const [c, i, o] of escrowChecks) {
  r.row(c, fmt(i), fmt(o), i === o ? "yes" : "NO");
  summary.push([c, 1, i === o ? 0 : 1]);
}
r.row(
  "last tokenId minted",
  escrow.lastTokenId,
  lastId.toString(),
  BigInt(escrow.lastTokenId) === lastId ? "yes" : "NO",
);
summary.push([
  "last tokenId",
  1,
  BigInt(escrow.lastTokenId) === lastId ? 0 : 1,
]);

// ---- sample positions: largest, newest Rebalance-minted, random ----
const third = Math.floor(N / 3);
const sample = sql(
  inst,
  `(select "tokenId",owner,amount,"stakeEnd","isPermanent" from "SAeroPosition" where "chainId"=${chain} and "tokenId">0 order by amount desc limit ${third})
   union (select "tokenId",owner,amount,"stakeEnd","isPermanent" from "SAeroPosition" where "chainId"=${chain} and "createdVia"='REBALANCE' order by "tokenId" desc limit ${third})
   union (select "tokenId",owner,amount,"stakeEnd","isPermanent" from "SAeroPosition" where "chainId"=${chain} and "tokenId">0 order by random() limit ${third})`,
);
let posMismatch = 0;
for (const p of sample) {
  const [st] = await call(
    chain,
    VOTING_ESCROW,
    "function staked(uint256) view returns ((uint128 amount,uint48 end,bool isPermanent))",
    [BigInt(p.tokenId)],
    B,
  );
  let owner = "0x0000000000000000000000000000000000000000";
  if (st.amount > 0n || BigInt(p.amount) > 0n) {
    try {
      [owner] = await call(
        chain,
        VOTING_ESCROW,
        "function ownerOf(uint256) view returns (address)",
        [BigInt(p.tokenId)],
        B,
      );
    } catch {
      owner = "(burned)";
    }
  }
  const ok =
    st.amount === BigInt(p.amount) &&
    BigInt(st.end) === BigInt(p.stakeEnd) &&
    st.isPermanent === (p.isPermanent === "t") &&
    (owner === p.owner ||
      (owner === "0x0000000000000000000000000000000000000000" &&
        st.amount === 0n));
  if (!ok) {
    posMismatch++;
    r.note(
      `  position ${p.tokenId}: idx ${p.amount}/${p.stakeEnd}/${p.isPermanent}/${p.owner} chain ${st.amount}/${st.end}/${st.isPermanent}/${owner}`,
    );
  }
}
const [acc] = sql(
  inst,
  `select amount from "SAeroPosition" where id='${chain}-0'`,
);
const [accChain] = await call(
  chain,
  VOTING_ESCROW,
  "function staked(uint256) view returns ((uint128 amount,uint48 end,bool isPermanent))",
  [0n],
  B,
);
r.h("Base: sAERO positions vs VotingEscrow.staked / ownerOf (tolerance 0)");
r.head("check", "sampled", "mismatches");
r.row("amount, unlock, permanent flag, owner", sample.length, posMismatch);
const accOk = BigInt(acc?.amount ?? 0) === accChain.amount;
r.row(
  `accumulator (tokenId 0): idx ${fmt(acc?.amount ?? 0)} chain ${fmt(accChain.amount)}`,
  1,
  accOk ? 0 : 1,
);
summary.push([
  "sAERO positions (largest, newest Rebalance-minted, random)",
  sample.length,
  posMismatch,
]);
summary.push(["accumulator", 1, accOk ? 0 : 1]);

// ---- root allocation ledger ----
const half = Math.floor(N / 2);
const allocs = sql(
  inst,
  `(select "tokenId","targetChainId",amount from "AeroRootAllocation" where "chainId"=${chain} order by amount desc limit ${half})
   union (select "tokenId","targetChainId",amount from "AeroRootAllocation" where "chainId"=${chain} order by random() limit ${half})`,
);
let allocMismatch = 0;
for (const a of allocs) {
  const [onc] = await call(
    chain,
    ROOT_VOTER,
    "function allocationChainAmounts(uint256,uint256) view returns (uint128)",
    [BigInt(a.tokenId), BigInt(a.targetChainId)],
    B,
  );
  if (onc !== BigInt(a.amount)) {
    allocMismatch++;
    r.note(
      `  root alloc ${a.tokenId}@${a.targetChainId}: idx ${a.amount} chain ${onc}`,
    );
  }
}
r.h(
  "Base: root Voter ledger vs allocationChainAmounts (largest + random; tolerance 0)",
);
r.head("check", "sampled", "mismatches");
r.row(
  "allocationChainAmounts(tokenId, chainId) vs AeroRootAllocation.amount",
  allocs.length,
  allocMismatch,
);
summary.push(["root allocations", allocs.length, allocMismatch]);

// ---- per-chain redemption totals ----
const chains = sql(
  inst,
  `select "targetChainId","totalRedeemed","totalAllocated","reportedSurplus" from "AeroRootChainState" where "chainId"=${chain} order by "targetChainId"`,
);
r.h("Base: per-chain root totals vs Voter.chainStates (tolerance 0)");
r.head(
  "chain",
  "totalRedeemed idx",
  "totalRedeemed chain",
  "reportedSurplus idx",
  "reportedSurplus chain",
  "booked idx",
  "ok",
);
let chainMismatch = 0;
let chainChecked = 0;
for (const c of chains) {
  if (c.targetChainId === "0") {
    r.row("0 (CHAIN0)", "-", "-", "-", "-", fmt(c.totalAllocated), "");
    continue;
  }
  const st = await call(
    chain,
    ROOT_VOTER,
    "function chainStates(uint256) view returns ((int128,int128,uint48,uint128),uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8)",
    [BigInt(c.targetChainId)],
    B,
  );
  const ok =
    BigInt(c.totalRedeemed) === st[2] && BigInt(c.reportedSurplus) === st[3];
  chainChecked++;
  if (!ok) chainMismatch++;
  r.row(
    c.targetChainId,
    fmt(c.totalRedeemed),
    fmt(st[2]),
    fmt(c.reportedSurplus),
    fmt(st[3]),
    fmt(c.totalAllocated),
    ok ? "yes" : "NO",
  );
}
summary.push([
  "per-chain redeemed + reported surplus",
  chainChecked,
  chainMismatch,
]);

// ---- Minter ----
const [m] = sql(
  inst,
  `select "totalMinted","totalSplitterShare","numberOfMints" from "AeroMinterState" where "chainId"=${chain}`,
);
const [em] = await call(
  chain,
  MINTER,
  "function emissionsMinted() view returns (uint256)",
  [],
  B,
);
r.h("Base: Minter (tolerance 0)");
r.head("check", "indexed", "chain", "ok");
const mOk = BigInt(m?.totalMinted ?? 0) === em;
r.row(
  "emissionsMinted() vs sum Minted.amount",
  fmt(m?.totalMinted ?? 0),
  fmt(em),
  mOk ? "yes" : "NO",
);
r.row(
  "team share (Minted.splitterShare)",
  fmt(m?.totalSplitterShare ?? 0),
  "-",
  "",
);
summary.push(["Minter emissionsMinted", 1, mOk ? 0 : 1]);

// ---- migration ----
const mig = sql(
  inst,
  `select "chainId","migrationContract","numberOfVeNFTs","veNFTAmountIn","veNFTAmountOut","numberOfLiquid","liquidAmountIn","liquidAmountOut","numberOfSettlements","settledAmount" from "AeroMigrationTotals" order by "chainId"`,
);
r.h("Migration totals (all chains)");
r.head(
  "chain",
  "contract",
  "veNFTs",
  "locked in",
  "AERO out",
  "liquid",
  "liquid in",
  "liquid out",
  "settlements",
  "settled",
);
for (const x of mig) {
  r.row(
    x.chainId,
    x.migrationContract.slice(0, 10),
    x.numberOfVeNFTs,
    fmt(x.veNFTAmountIn),
    fmt(x.veNFTAmountOut),
    x.numberOfLiquid,
    fmt(x.liquidAmountIn),
    fmt(x.liquidAmountOut),
    x.numberOfSettlements,
    fmt(x.settledAmount),
  );
}

const counts = chsql(
  inst,
  `select 'SAeroPositionEvent' t, count() n from SAeroPositionEvent union all select 'AeroMinterEvent', count() from AeroMinterEvent union all select 'AeroMigrationEvent', count() from AeroMigrationEvent`,
);
r.h("Base-only event rows");
for (const c of counts) r.row(c.t, c.n);

r.h(`Base @ ${B}: summary`);
r.head("check", "checked", "mismatches");
for (const [c, n, x] of summary) r.row(c, n, x);
r.note(`\nRPC calls: ${counters.rpcCalls}`);
r.print();
