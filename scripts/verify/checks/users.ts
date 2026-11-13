/**
 * Per-user (UserStatsPerPool) data against attribution recomputed from logs.
 */
import { Check } from "../lib/report";
import { big, lc, sample } from "../lib/util";
import { ALM_WRAPPER_ABI, V2_GAUGE_ABI, V2_POOL_ABI } from "../lib/viewAbis";
import { type UserPoolTruth, userKey } from "../truth/types";
import { type CheckContext, decimalsOf, to1e18 } from "./context";

interface IdxUser {
  user: string;
  pool: string;
  numberOfSwaps: bigint;
  vol0: bigint;
  vol1: bigint;
  fees0: bigint;
  fees1: bigint;
  lpBalance: bigint;
  added0: bigint;
  added1: bigint;
  removed0: bigint;
  removed1: bigint;
  staked: bigint;
  gaugeDeposits: bigint;
  gaugeWithdrawals: bigint;
  gaugeClaims: bigint;
  gaugeRewards: bigint;
  unstaked0: bigint;
  unstaked1: bigint;
  stakedFees0: bigint;
  stakedFees1: bigint;
  almLp: bigint;
  almAddress: string;
}

const EMPTY_TRUTH = (user: string, pool: string): UserPoolTruth => ({
  user,
  pool,
  swaps: 0,
  vol0: 0n,
  vol1: 0n,
  fees0: 0n,
  fees1: 0n,
  lpBalance: 0n,
  added0: 0n,
  added1: 0n,
  removed0: 0n,
  removed1: 0n,
  staked: 0n,
  gaugeDeposits: 0,
  gaugeWithdrawals: 0,
  gaugeClaims: 0,
  gaugeRewardsClaimed: 0n,
  almLp: 0n,
});

/**
 * Runs all per-user checks.
 * @param ctx - Check context
 * @returns Promise resolving when done
 */
export async function checkUsers(ctx: CheckContext): Promise<void> {
  const idx = new Map<string, IdxUser>();
  await ctx.idx.streamForChain("UserStatsPerPool", ctx.chainId, (r) => {
    const u: IdxUser = {
      user: lc(r.userAddress),
      pool: lc(r.poolAddress),
      numberOfSwaps: big(r.numberOfSwaps),
      vol0: big(r.totalSwapVolumeAmount0),
      vol1: big(r.totalSwapVolumeAmount1),
      fees0: big(r.totalFeesContributed0),
      fees1: big(r.totalFeesContributed1),
      lpBalance: big(r.lpBalance),
      added0: big(r.totalLiquidityAddedToken0),
      added1: big(r.totalLiquidityAddedToken1),
      removed0: big(r.totalLiquidityRemovedToken0),
      removed1: big(r.totalLiquidityRemovedToken1),
      staked: big(r.currentLiquidityStaked),
      gaugeDeposits: big(r.numberOfGaugeDeposits),
      gaugeWithdrawals: big(r.numberOfGaugeWithdrawals),
      gaugeClaims: big(r.numberOfGaugeRewardClaims),
      gaugeRewards: big(r.totalGaugeRewardsClaimed),
      unstaked0: big(r.totalUnstakedFeesCollected0),
      unstaked1: big(r.totalUnstakedFeesCollected1),
      stakedFees0: big(r.totalStakedFeesCollected0),
      stakedFees1: big(r.totalStakedFeesCollected1),
      almLp: big(r.almLpAmount),
      almAddress: lc(r.almAddress),
    };
    idx.set(userKey(u.user, u.pool), u);
  });
  const keys = new Set([...idx.keys(), ...ctx.truth.users.keys()]);
  const pools = ctx.truth.pools;
  const gaugeAddrs = new Set(ctx.truth.gauges.keys());
  const nfpms = new Set(ctx.chain.contracts.get("NFPM") ?? []);
  const protocol = new Map<string, string>();
  for (const a of nfpms) protocol.set(a, "NFPM");
  for (const a of gaugeAddrs) protocol.set(a, "gauge");
  for (const a of pools.keys()) protocol.set(a, "pool");
  for (const a of ctx.truth.votingRewards.keys())
    protocol.set(a, "voting reward");
  for (const a of ctx.truth.wrappers.keys()) protocol.set(a, "ALM wrapper");

  const swaps = new Check(
    "user.swaps",
    ctx.chainId,
    "UserStatsPerPool.numberOfSwaps and totalSwapVolumeAmount0/1 per (user, pool) equal the pool's Swap logs grouped by the transaction sender (tx.from, the attribution rule of #814), V2 volume Σ(in+out), CL Σ|amount|.",
    "Exact.",
  );
  const fees = new Check(
    "user.fees-contributed",
    ctx.chainId,
    "V2: UserStatsPerPool.totalFeesContributed0/1 equal Σ Fees logs grouped by tx.from, 1e18-normalised. All pools: Σ over users of totalFeesContributed0/1 equals Pool.totalFeesGenerated0/1.",
    "Exact (normalisation is a multiplication for ≤ 18 decimals).",
  );
  const lp = new Check(
    "user.lp-balance",
    ctx.chainId,
    "V2 UserStatsPerPool.lpBalance equals the holder's LP balance replayed from Transfer logs (the pool's gauge excluded, as the handler skips it) and, for a sample, balanceOf() at the pinned block.",
    "Exact.",
  );
  const liq = new Check(
    "user.v2-liquidity-attribution",
    ctx.chainId,
    "V2 UserStatsPerPool.totalLiquidityAdded/RemovedToken0/1 per user equal the Mint / Burn amounts attributed to the liquidity provider: for a Mint, the recipient of the minted LP (address(1) skipped); for a Burn, the account that sent the LP tokens into the pool in that transaction.",
    "Exact.",
  );
  const stake = new Check(
    "user.gauge",
    ctx.chainId,
    "UserStatsPerPool.currentLiquidityStaked and gauge counters per user equal the gauge logs: V2 Σ Deposit(to) − Σ Withdraw(from) (Gauge.balanceOf() for a sample); CL Σ liquidity of NFTs the user deposited that the gauge still holds; deposits / withdrawals / claims counts and Σ ClaimRewards per user.",
    "Exact.",
  );
  const sums = new Check(
    "user.sums-equal-pool",
    ctx.chainId,
    "Σ over users of numberOfSwaps, totalSwapVolumeAmount0/1, totalUnstakedFeesCollected0/1, totalStakedFeesCollected0/1, numberOfGaugeDeposits equals the Pool field.",
    "Exact: every pool-level increment has a matching user-level increment.",
  );
  const attribution = new Check(
    "user.protocol-addresses",
    ctx.chainId,
    "No UserStatsPerPool row of a protocol contract (pool, NFPM, gauge, voting reward, ALM wrapper) carries swap, liquidity or fee-collection amounts: those belong to the user behind the contract.",
    "Exact (zero).",
  );
  const alm = new Check(
    "user.alm",
    ctx.chainId,
    "UserStatsPerPool.almLpAmount equals the holder's ALM wrapper balance replayed from the wrapper's Transfer logs (wallets only).",
    "Exact.",
  );

  const poolSums = new Map<string, Record<string, bigint>>();
  for (const k of keys) {
    const i = idx.get(k);
    const [user, pool] = k.split("|");
    const t = ctx.truth.users.get(k) ?? EMPTY_TRUTH(user, pool);
    const p = pools.get(pool);
    if (!p) continue;
    if (i) {
      const s = poolSums.get(pool) ?? {};
      const add = (f: string, v: bigint) => {
        s[f] = (s[f] ?? 0n) + v;
      };
      add("numberOfSwaps", i.numberOfSwaps);
      add("totalVolume0", i.vol0);
      add("totalVolume1", i.vol1);
      add("totalFeesGenerated0", i.fees0);
      add("totalFeesGenerated1", i.fees1);
      add("totalUnstakedFeesCollected0", i.unstaked0);
      add("totalUnstakedFeesCollected1", i.unstaked1);
      add("totalStakedFeesCollected0", i.stakedFees0);
      add("totalStakedFeesCollected1", i.stakedFees1);
      add("numberOfGaugeDeposits", i.gaugeDeposits);
      poolSums.set(pool, s);
    }
    const iv = i ?? ({} as Partial<IdxUser>);
    swaps.cmp(
      `${user}@${pool}.numberOfSwaps`,
      iv.numberOfSwaps ?? 0n,
      BigInt(t.swaps),
      {},
      { rowExists: !!i },
    );
    swaps.cmp(`${user}@${pool}.totalSwapVolumeAmount0`, iv.vol0 ?? 0n, t.vol0);
    swaps.cmp(`${user}@${pool}.totalSwapVolumeAmount1`, iv.vol1 ?? 0n, t.vol1);
    if (p.kind === "v2") {
      const d0 = decimalsOf(ctx, p.token0);
      const d1 = decimalsOf(ctx, p.token1);
      fees.cmp(
        `${user}@${pool}.totalFeesContributed0`,
        iv.fees0 ?? 0n,
        to1e18(t.fees0, d0),
      );
      fees.cmp(
        `${user}@${pool}.totalFeesContributed1`,
        iv.fees1 ?? 0n,
        to1e18(t.fees1, d1),
      );
      const isGauge =
        gaugeAddrs.has(user) && ctx.truth.gauges.get(user)?.pool === pool;
      if (!isGauge)
        lp.cmp(
          `${user}@${pool}.lpBalance`,
          iv.lpBalance ?? 0n,
          t.lpBalance < 0n ? 0n : t.lpBalance,
          {},
          { rowExists: !!i },
        );
      else if ((iv.lpBalance ?? 0n) !== 0n)
        lp.add({
          key: `${user}@${pool}.lpBalance (gauge)`,
          indexed: String(iv.lpBalance),
          truth: "0 (gauge is skipped)",
        });
      liq.cmp(
        `${user}@${pool}.totalLiquidityAddedToken0`,
        iv.added0 ?? 0n,
        t.added0,
        {},
        { role: protocol.get(user) ?? "" },
      );
      liq.cmp(
        `${user}@${pool}.totalLiquidityAddedToken1`,
        iv.added1 ?? 0n,
        t.added1,
        {},
        { role: protocol.get(user) ?? "" },
      );
      liq.cmp(
        `${user}@${pool}.totalLiquidityRemovedToken0`,
        iv.removed0 ?? 0n,
        t.removed0,
        {},
        { role: protocol.get(user) ?? "" },
      );
      liq.cmp(
        `${user}@${pool}.totalLiquidityRemovedToken1`,
        iv.removed1 ?? 0n,
        t.removed1,
        {},
        { role: protocol.get(user) ?? "" },
      );
    }
    stake.cmp(
      `${user}@${pool}.currentLiquidityStaked`,
      iv.staked ?? 0n,
      t.staked < 0n ? 0n : t.staked,
      {},
      { kind: p.kind },
    );
    stake.cmp(
      `${user}@${pool}.numberOfGaugeDeposits`,
      iv.gaugeDeposits ?? 0n,
      BigInt(t.gaugeDeposits),
    );
    stake.cmp(
      `${user}@${pool}.numberOfGaugeWithdrawals`,
      iv.gaugeWithdrawals ?? 0n,
      BigInt(t.gaugeWithdrawals),
    );
    stake.cmp(
      `${user}@${pool}.numberOfGaugeRewardClaims`,
      iv.gaugeClaims ?? 0n,
      BigInt(t.gaugeClaims),
    );
    stake.cmp(
      `${user}@${pool}.totalGaugeRewardsClaimed`,
      iv.gaugeRewards ?? 0n,
      t.gaugeRewardsClaimed,
    );
    if (!protocol.has(user))
      alm.cmp(`${user}@${pool}.almLpAmount`, iv.almLp ?? 0n, t.almLp);
    const role = protocol.get(user);
    if (role && i) {
      for (const [f, v] of [
        ["numberOfSwaps", i.numberOfSwaps],
        ["totalLiquidityAddedToken0", i.added0],
        ["totalLiquidityAddedToken1", i.added1],
        ["totalLiquidityRemovedToken0", i.removed0],
        ["totalLiquidityRemovedToken1", i.removed1],
        ["totalUnstakedFeesCollected0", i.unstaked0],
        ["totalUnstakedFeesCollected1", i.unstaked1],
      ] as [string, bigint][]) {
        if (v !== 0n)
          attribution.add(
            {
              key: `${role} ${user}@${pool}.${f}`,
              indexed: String(v),
              truth: "0",
            },
            Math.log10(Number(v) + 1),
          );
      }
      attribution.compared++;
    }
  }
  for (const [pool, s] of poolSums) {
    const r = ctx.pools.get(pool);
    if (!r) continue;
    for (const [f, v] of Object.entries(s))
      sums.cmp(`${pool} Σ users ${f}`, v, big(r[f]));
  }

  // On-chain samples: LP balances, gauge balances, ALM balances.
  if (ctx.rpc) {
    const B = ctx.truth.pinnedBlock;
    const v2Holders = sample(
      [...ctx.truth.users.values()].filter(
        (u) =>
          pools.get(u.pool)?.kind === "v2" &&
          u.lpBalance > 0n &&
          !gaugeAddrs.has(u.user),
      ),
      ctx.opts.sample,
      `lp-${ctx.chainId}`,
    );
    const res = await ctx.rpc.calls(
      B,
      v2Holders.map((u) => ({
        to: u.pool,
        abi: V2_POOL_ABI,
        fn: "balanceOf",
        args: [u.user],
      })),
    );
    v2Holders.forEach((u, i) => {
      const b = res[i];
      if (b instanceof Error) return;
      lp.cmp(
        `${u.user}@${u.pool}.lpBalance vs balanceOf()`,
        idx.get(userKey(u.user, u.pool))?.lpBalance ?? 0n,
        b as bigint,
        {},
        { block: B },
      );
    });
    const v2Stakers = sample(
      [...ctx.truth.users.values()].filter(
        (u) => pools.get(u.pool)?.kind === "v2" && u.staked > 0n,
      ),
      ctx.opts.sample,
      `st-${ctx.chainId}`,
    );
    const gaugeOf = new Map<string, string>();
    for (const g of ctx.truth.gauges.values())
      if (g.kind === "v2") gaugeOf.set(g.pool, g.address);
    const sres = await ctx.rpc.calls(
      B,
      v2Stakers
        .filter((u) => gaugeOf.has(u.pool))
        .map((u) => ({
          to: gaugeOf.get(u.pool) as string,
          abi: V2_GAUGE_ABI,
          fn: "balanceOf",
          args: [u.user],
        })),
    );
    v2Stakers
      .filter((u) => gaugeOf.has(u.pool))
      .forEach((u, i) => {
        const b = sres[i];
        if (b instanceof Error) return;
        stake.cmp(
          `${u.user}@${u.pool}.currentLiquidityStaked vs Gauge.balanceOf()`,
          idx.get(userKey(u.user, u.pool))?.staked ?? 0n,
          b as bigint,
          {},
          { block: B },
        );
      });
    const almHolders: { w: string; pool: string; holder: string }[] = [];
    for (const w of ctx.truth.wrappers.values())
      for (const [h, b] of w.balances)
        if (b > 0n && h !== w.address)
          almHolders.push({ w: w.address, pool: w.pool, holder: h });
    const ah = sample(almHolders, ctx.opts.sample, `alm-${ctx.chainId}`);
    const ares = await ctx.rpc.calls(
      B,
      ah.map((x) => ({
        to: x.w,
        abi: ALM_WRAPPER_ABI,
        fn: "balanceOf",
        args: [x.holder],
      })),
    );
    ah.forEach((x, i) => {
      const b = ares[i];
      if (b instanceof Error) return;
      alm.cmp(
        `${x.holder}@${x.pool}.almLpAmount vs wrapper.balanceOf()`,
        idx.get(userKey(x.holder, x.pool))?.almLp ?? 0n,
        b as bigint,
        {},
        { wrapper: x.w },
      );
    });
  }
  const n = `${idx.size} indexed rows, ${ctx.truth.users.size} (user, pool) pairs with on-chain activity`;
  ctx.results.push(swaps.done(n));
  ctx.results.push(fees.done(n));
  ctx.results.push(lp.done(n));
  ctx.results.push(liq.done(n));
  ctx.results.push(stake.done(n));
  ctx.results.push(sums.done(`${poolSums.size} pools`));
  ctx.results.push(
    attribution.done(
      `${[...idx.values()].filter((u) => protocol.has(u.user)).length} rows keyed by protocol contracts`,
    ),
  );
  if (ctx.truth.wrappers.size === 0) alm.skip("no ALM wrappers on this chain");
  ctx.results.push(alm.done(`${ctx.truth.wrappers.size} ALM wrappers`));
}
