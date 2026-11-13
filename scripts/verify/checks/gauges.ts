/**
 * Gauges, staking, emissions and voting rewards.
 */
import { positionAmounts } from "../lib/clmath";
import { Check } from "../lib/report";
import { big, sample } from "../lib/util";
import { V2_GAUGE_ABI } from "../lib/viewAbis";
import type { GaugeTruth, NftTruth } from "../truth/types";
import type { CheckContext } from "./context";

function gaugesByPool(ctx: CheckContext): Map<string, GaugeTruth[]> {
  const m = new Map<string, GaugeTruth[]>();
  for (const g of ctx.truth.gauges.values()) {
    const l = m.get(g.pool) ?? [];
    l.push(g);
    m.set(g.pool, l);
  }
  return m;
}

/** NFTs currently held by one of the pool's gauges. */
function stakedNfts(
  ctx: CheckContext,
  pool: string,
  gauges: GaugeTruth[],
): NftTruth[] {
  const gs = new Set(gauges.map((g) => g.address));
  return [...ctx.truth.nfts.values()].filter(
    (n) => !n.burned && n.pool === pool && gs.has(n.owner),
  );
}

/**
 * Per-pool gauge counters and staked amounts.
 * @param ctx - Check context
 * @returns Promise resolving when done
 */
export async function checkGaugeTotals(ctx: CheckContext): Promise<void> {
  const counters = new Check(
    "gauge.counters",
    ctx.chainId,
    "Pool.numberOfGaugeDeposits / Withdrawals / RewardClaims and totalGaugeRewardsClaimed equal the Deposit / Withdraw / ClaimRewards logs (Σ amount) of every gauge the voter created for the pool.",
    "Exact.",
  );
  const staked = new Check(
    "gauge.staked",
    ctx.chainId,
    "Pool.currentLiquidityStaked equals the gauge's stake at the pinned block: V2 Σ Deposit − Σ Withdraw (= Gauge.totalSupply(), checked on-chain for a sample); CL Σ liquidity of the NFTs the gauge holds (NFPM replay). CL stakedLiquidityInRange equals Σ L of staked in-range positions; stakedReserve0/1 equal the token amounts of the staked positions at the current price.",
    "Liquidity: exact. stakedReserve0/1: absolute 2 wei per staked position or relative 1e-3: the indexer keeps a running counter updated on every swap with per-segment rounding (the wei-scale drift #802 documents), so it drifts by a few units per thousand swaps.",
  );
  const byPool = gaugesByPool(ctx);
  let poolsWithGauges = 0;
  for (const [pool, gauges] of byPool) {
    const r = ctx.pools.get(pool);
    const p = ctx.truth.pools.get(pool);
    if (!r || !p) continue;
    poolsWithGauges++;
    const sum = (f: (g: GaugeTruth) => number | bigint) =>
      gauges.reduce((a, g) => a + BigInt(f(g)), 0n);
    const d = { gauges: gauges.map((g) => g.address).join(" ") };
    counters.cmp(
      `${pool}.numberOfGaugeDeposits`,
      big(r.numberOfGaugeDeposits),
      sum((g) => g.deposits),
      {},
      d,
    );
    counters.cmp(
      `${pool}.numberOfGaugeWithdrawals`,
      big(r.numberOfGaugeWithdrawals),
      sum((g) => g.withdrawals),
      {},
      d,
    );
    counters.cmp(
      `${pool}.numberOfGaugeRewardClaims`,
      big(r.numberOfGaugeRewardClaims),
      sum((g) => g.claims),
      {},
      d,
    );
    counters.cmp(
      `${pool}.totalGaugeRewardsClaimed`,
      big(r.totalGaugeRewardsClaimed),
      sum((g) => g.rewardsClaimed),
      {},
      d,
    );
    if (p.kind === "v2") {
      staked.cmp(
        `${pool}.currentLiquidityStaked`,
        big(r.currentLiquidityStaked),
        sum((g) => g.netStakeFromEvents),
        {},
        d,
      );
    } else {
      const nfts = stakedNfts(ctx, pool, gauges);
      const liq = nfts.reduce((a, n) => a + n.liquidity, 0n);
      staked.cmp(
        `${pool}.currentLiquidityStaked`,
        big(r.currentLiquidityStaked),
        liq,
        {},
        {
          ...d,
          stakedNfts: nfts.length,
          depositMinusWithdrawEvents: String(sum((g) => g.netStakeFromEvents)),
        },
      );
      let inRange = 0n;
      let a0 = 0n;
      let a1 = 0n;
      for (const n of nfts) {
        if (n.tickLower === undefined || n.tickUpper === undefined) continue;
        if (n.tickLower <= p.tick && p.tick < n.tickUpper)
          inRange += n.liquidity;
        const amt = positionAmounts(
          n.liquidity,
          p.sqrtPriceX96,
          p.tick,
          n.tickLower,
          n.tickUpper,
        );
        a0 += amt.amount0;
        a1 += amt.amount1;
      }
      staked.cmp(
        `${pool}.stakedLiquidityInRange`,
        big(r.stakedLiquidityInRange),
        inRange,
        {},
        d,
      );
      const tol = { abs: 2n * BigInt(nfts.length) + 1n, rel: 1e-3 };
      staked.cmp(`${pool}.stakedReserve0`, big(r.stakedReserve0), a0, tol, d);
      staked.cmp(`${pool}.stakedReserve1`, big(r.stakedReserve1), a1, tol, d);
    }
  }
  if (ctx.rpc) {
    const v2 = sample(
      [...ctx.truth.gauges.values()].filter((g) => g.kind === "v2"),
      ctx.opts.sample,
      `gs-${ctx.chainId}`,
    );
    const res = await ctx.rpc.calls(
      ctx.truth.pinnedBlock,
      v2.map((g) => ({ to: g.address, abi: V2_GAUGE_ABI, fn: "totalSupply" })),
    );
    v2.forEach((g, i) => {
      const s = res[i];
      if (s instanceof Error) return;
      staked.cmp(
        `gauge ${g.address} replay vs totalSupply()`,
        g.netStakeFromEvents,
        s as bigint,
        {},
        { pool: g.pool },
      );
    });
  }
  ctx.results.push(counters.done(`${poolsWithGauges} pools with gauges`));
  ctx.results.push(staked.done(`${poolsWithGauges} pools with gauges`));
}

/**
 * Emissions reaching leaf gauges (NotifyReward) vs Pool.totalEmissions, and cross-chain bookkeeping.
 * @param ctx - Check context
 * @param rootChainIndexed - Whether the root chain (Optimism) is part of this instance
 * @returns Promise resolving when done
 */
export async function checkEmissions(
  ctx: CheckContext,
  rootChainIndexed: boolean,
): Promise<void> {
  const leaf = ctx.chain.contracts.has("SuperchainLeafVoter");
  const c = new Check(
    "rewards.emissions",
    ctx.chainId,
    leaf
      ? "Pool.totalEmissions equals Σ NotifyReward on the pool's leaf gauges (emissions that arrived on this chain). On leaf chains the indexer credits emissions from the root chain's DistributeReward, so this needs Optimism in the same instance."
      : "Pool.totalEmissions equals Σ DistributeReward from the voter to the pool's gauges.",
    "Exact when the root chain is indexed; otherwise skipped (numbers shown).",
  );
  const byPool = gaugesByPool(ctx);
  let notified = 0n;
  let indexed = 0n;
  for (const [pool, gauges] of byPool) {
    const r = ctx.pools.get(pool);
    if (!r) continue;
    const truth = gauges.reduce((a, g) => a + g.notified, 0n);
    notified += truth;
    indexed += big(r.totalEmissions);
    if (rootChainIndexed || !leaf)
      c.cmp(
        `${pool}.totalEmissions`,
        big(r.totalEmissions),
        truth,
        {},
        { notifies: gauges.reduce((a, g) => a + g.notifies, 0) },
      );
  }
  if (leaf && !rootChainIndexed)
    c.skip(
      "root chain (Optimism) is not in this instance; leaf emissions are credited from Optimism's DistributeReward",
    );
  ctx.results.push(
    c.done(
      `Σ NotifyReward on chain ${notified}, Σ Pool.totalEmissions ${indexed}`,
    ),
  );

  const pend = new Check(
    "rewards.cross-chain-pending",
    ctx.chainId,
    "Deferred cross-chain rows (PendingVote, PendingDistribution, PendingRootPoolMapping) for this chain: rows that never resolved to a leaf pool.",
    "Informational: non-zero counts list root pools whose votes / emissions are not attributed.",
  ).informational();
  for (const t of [
    "PendingVote",
    "PendingDistribution",
    "PendingRootPoolMapping",
  ]) {
    const cols = await ctx.idx.columns(t);
    const where = cols.has("leafChainId")
      ? `"leafChainId" = ${ctx.chainId}`
      : cols.has("chainId")
        ? `"chainId" = ${ctx.chainId}`
        : "false";
    const rows = await ctx.idx.pg.query(
      `select count(*) as n from ${ctx.idx.tbl(t)} where ${where}`,
    );
    const n = Number(rows[0]?.n ?? 0);
    pend.stats[t] = n;
    if (n > 0)
      pend.add({
        key: t,
        indexed: `${n} rows`,
        truth: "0 expected once resolved",
      });
  }
  ctx.results.push(
    pend.done(
      Object.entries(pend.stats)
        .filter(([k]) => k !== "compared")
        .map(([k, v]) => `${k} ${v}`)
        .join(", "),
    ),
  );
}

/**
 * Voting-reward claims: the indexer stores USD only, so the USD totals are
 * re-priced with the indexer's own hourly token prices.
 * @param ctx - Check context
 * @returns Promise resolving when done
 */
export async function checkVotingRewardCounts(
  ctx: CheckContext,
): Promise<void> {
  const c = new Check(
    "rewards.voting-claims",
    ctx.chainId,
    "Every pool with fee / bribe (incentive) voting-reward claims on-chain has non-zero totalFeeRewardClaimedUSD / totalBribeClaimedUSD when the claimed token is priced, and none without claims. Token amounts are not stored (USD only), so amounts cannot be compared exactly.",
    "Presence only (informational).",
  ).informational();
  const claimsByPool = new Map<string, { fee: number; bribe: number }>();
  for (const v of ctx.truth.votingRewards.values()) {
    const x = claimsByPool.get(v.pool) ?? { fee: 0, bribe: 0 };
    if (v.kind === "fee") x.fee += v.claims;
    else x.bribe += v.claims;
    claimsByPool.set(v.pool, x);
  }
  for (const [pool, x] of claimsByPool) {
    const r = ctx.pools.get(pool);
    if (!r) continue;
    if (x.fee === 0 && big(r.totalFeeRewardClaimedUSD) !== 0n)
      c.add({
        key: `${pool}.totalFeeRewardClaimedUSD`,
        indexed: String(r.totalFeeRewardClaimedUSD),
        truth: "no claims",
      });
    if (x.bribe === 0 && big(r.totalBribeClaimedUSD) !== 0n)
      c.add({
        key: `${pool}.totalBribeClaimedUSD`,
        indexed: String(r.totalBribeClaimedUSD),
        truth: "no claims",
      });
    if (x.fee > 0 && big(r.totalFeeRewardClaimedUSD) === 0n)
      c.add(
        {
          key: `${pool}.totalFeeRewardClaimedUSD`,
          indexed: "0",
          truth: `${x.fee} claims`,
        },
        0.5,
      );
    if (x.bribe > 0 && big(r.totalBribeClaimedUSD) === 0n)
      c.add(
        {
          key: `${pool}.totalBribeClaimedUSD`,
          indexed: "0",
          truth: `${x.bribe} claims`,
        },
        0.5,
      );
  }
  const totalClaims = [...claimsByPool.values()].reduce(
    (a, x) => a + x.fee + x.bribe,
    0,
  );
  ctx.results.push(
    c.done(
      `${totalClaims} voting-reward claims on chain across ${claimsByPool.size} pools`,
    ),
  );
}
