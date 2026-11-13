/**
 * Completeness: everything the factories and voters created exists in the
 * index (and nothing else), envio registered every dynamic contract at its
 * creation block, and the number of logs the indexer processed matches the
 * chain.
 */
import { httpRequest } from "../lib/http";
import { Check } from "../lib/report";
import { big, lc } from "../lib/util";
import type { CheckContext } from "./context";

/**
 * Pools: set equality with PoolCreated logs, plus creation metadata.
 * @param ctx - Check context
 * @returns void
 */
export function checkPools(ctx: CheckContext): void {
  const c = new Check(
    "completeness.pools",
    ctx.chainId,
    "Every PoolCreated of a configured V2/CL factory up to the pinned block has a Pool row with matching tokens, type, tick spacing, factory and creation block; no extra Pool rows.",
    "Exact: these are copied from the PoolCreated log.",
  );
  let missing = 0;
  let extra = 0;
  for (const p of ctx.truth.pools.values()) {
    const r = ctx.pools.get(p.address);
    const det = { block: p.created.block, tx: p.created.tx };
    if (!r) {
      missing++;
      c.add(
        {
          key: p.address,
          indexed: "missing",
          truth: `${p.kind} pool`,
          detail: det,
        },
        10,
      );
      continue;
    }
    c.eq(`${p.address}.token0`, lc(r.token0_address), p.token0, det);
    c.eq(`${p.address}.token1`, lc(r.token1_address), p.token1, det);
    c.eq(`${p.address}.isCL`, r.isCL === "t", p.kind === "cl", det);
    if (p.kind === "v2")
      c.eq(`${p.address}.isStable`, r.isStable === "t", p.stable, det);
    c.eq(
      `${p.address}.tickSpacing`,
      big(r.tickSpacing),
      BigInt(p.tickSpacing),
      det,
    );
    c.eq(`${p.address}.factoryAddress`, lc(r.factoryAddress), p.factory, det);
    c.eq(
      `${p.address}.createdBlockNumber`,
      big(r.createdBlockNumber),
      BigInt(p.created.block),
      det,
    );
  }
  for (const [a] of ctx.pools) {
    if (!ctx.truth.pools.has(a)) {
      extra++;
      c.add(
        {
          key: a,
          indexed: "present",
          truth: "no PoolCreated from a configured factory",
        },
        5,
      );
    }
  }
  ctx.results.push(
    c.done(
      `chain ${ctx.truth.pools.size} pools, indexed ${ctx.pools.size}; missing ${missing}, extra ${extra}`,
    ),
  );
}

/**
 * Dynamic registrations: envio_addresses vs. what the factories / voters / ALM factories created.
 * @param ctx - Check context
 * @returns Promise resolving when done
 */
export async function checkRegistrations(ctx: CheckContext): Promise<void> {
  const c = new Check(
    "completeness.registrations",
    ctx.chainId,
    "Every pool, gauge, voting-reward contract and ALM wrapper created on-chain is registered in envio_addresses under the right contract, at its creation block; gauges of pool factories the indexer does not know are listed as failures because their events are never indexed.",
    "Exact.",
  );
  const regs = await ctx.idx.registrations(ctx.chainId);
  const expected = new Map<
    string,
    { contract: string; block: number; why: string }
  >();
  for (const p of ctx.truth.pools.values()) {
    expected.set(p.address, {
      contract: p.kind === "cl" ? "CLPool" : "Pool",
      block: p.created.block,
      why: `PoolCreated tx ${p.created.tx}`,
    });
  }
  for (const g of ctx.truth.gauges.values()) {
    if (g.kind === "unregistered") {
      c.add(
        {
          key: g.address,
          indexed: "not registrable",
          truth: `gauge of pool ${g.pool} from unknown poolFactory ${g.poolFactory}`,
          detail: { block: g.created.block, tx: g.created.tx },
        },
        10,
      );
    } else {
      expected.set(g.address, {
        contract: g.kind === "cl" ? "CLGauge" : "Gauge",
        block: g.created.block,
        why: `GaugeCreated tx ${g.created.tx}`,
      });
    }
    expected.set(g.feeVotingReward, {
      contract: "FeesVotingReward",
      block: g.created.block,
      why: `GaugeCreated tx ${g.created.tx}`,
    });
    const bribe = ctx.truth.votingRewards.get(g.bribeVotingReward);
    expected.set(g.bribeVotingReward, {
      contract: bribe?.contract ?? "BribesVotingReward",
      block: g.created.block,
      why: `GaugeCreated tx ${g.created.tx}`,
    });
  }
  for (const w of ctx.truth.wrappers.values()) {
    expected.set(w.address, {
      contract: w.contract,
      block: w.created.block,
      why: `StrategyCreated tx ${w.created.tx}`,
    });
  }
  let missing = 0;
  for (const [a, e] of expected) {
    const got = (regs.get(a) ?? []).find((x) => x.contract === e.contract);
    if (!got) {
      missing++;
      c.add(
        {
          key: `${e.contract} ${a}`,
          indexed: regs.has(a)
            ? `registered as ${regs
                .get(a)
                ?.map((x) => x.contract)
                .join(",")}`
            : "not registered",
          truth: e.why,
          detail: { block: e.block },
        },
        10,
      );
    } else {
      c.eq(`${e.contract} ${a} registration_block`, got.block, e.block);
    }
  }
  let extra = 0;
  const dynamic = new Set([
    "Pool",
    "CLPool",
    "Gauge",
    "CLGauge",
    "FeesVotingReward",
    "BribesVotingReward",
    "SuperchainIncentiveVotingReward",
    "ALMLPWrapperV1",
    "ALMLPWrapperV2",
  ]);
  for (const [a, list] of regs) {
    for (const x of list) {
      if (x.block < 0 || !dynamic.has(x.contract)) continue;
      if (!expected.has(a)) {
        extra++;
        c.add(
          {
            key: `${x.contract} ${a}`,
            indexed: `registered at ${x.block}`,
            truth: "not created by a configured factory/voter",
          },
          5,
        );
      }
    }
  }
  ctx.results.push(
    c.done(
      `expected ${expected.size} dynamic registrations; missing ${missing}, unexpected ${extra}`,
    ),
  );
}

/**
 * FeeToTickSpacingMapping rows vs the CLFactory TickSpacingEnabled logs.
 * @param ctx - Check context
 * @returns Promise resolving when done
 */
export async function checkTickSpacingFees(ctx: CheckContext): Promise<void> {
  const c = new Check(
    "completeness.tick-spacing-fees",
    ctx.chainId,
    "FeeToTickSpacingMapping has one row per tick spacing enabled by the chain's CLFactories, with the fee of the last TickSpacingEnabled log.",
    "Exact. (Several factories on one chain share the {chainId}-{tickSpacing} id, so the last log over all factories wins.)",
  );
  const rows = await ctx.idx.rowsForChain(
    "FeeToTickSpacingMapping",
    ctx.chainId,
  );
  const byTs = new Map(rows.map((r) => [Number(r.tickSpacing), r]));
  for (const [ts, fee] of ctx.truth.tickSpacingFees) {
    const r = byTs.get(ts);
    if (!r)
      c.add({
        key: `tickSpacing ${ts}`,
        indexed: "missing",
        truth: `fee ${fee}`,
      });
    else c.eq(`tickSpacing ${ts}.fee`, r.fee, fee);
  }
  for (const ts of byTs.keys()) {
    if (!ctx.truth.tickSpacingFees.has(ts))
      c.add({
        key: `tickSpacing ${ts}`,
        indexed: "present",
        truth: "never enabled",
      });
  }
  ctx.results.push(
    c.done(
      `${ctx.truth.tickSpacingFees.size} tick spacings on chain, ${rows.length} rows`,
    ),
  );
}

/**
 * Gauge / voting-reward links on Pool and the gauge alive flag.
 * @param ctx - Check context
 * @returns void
 */
export function checkGaugeLinks(ctx: CheckContext): void {
  const c = new Check(
    "completeness.gauge-links",
    ctx.chainId,
    "Pool.gaugeAddress, feeVotingRewardAddress, bribeVotingRewardAddress and gaugeIsAlive match the latest GaugeCreated / GaugeKilled / GaugeRevived of the pool's voter.",
    "Exact.",
  );
  const latest = new Map<
    string,
    typeof ctx.truth.gauges extends Map<string, infer G> ? G : never
  >();
  for (const g of ctx.truth.gauges.values()) {
    const cur = latest.get(g.pool);
    if (
      !cur ||
      g.created.block > cur.created.block ||
      (g.created.block === cur.created.block &&
        g.created.logIndex > cur.created.logIndex)
    )
      latest.set(g.pool, g);
  }
  for (const [pool, g] of latest) {
    const r = ctx.pools.get(pool);
    if (!r) continue;
    const det = { block: g.created.block, tx: g.created.tx };
    c.eq(`${pool}.gaugeAddress`, lc(r.gaugeAddress), g.address, det);
    c.eq(
      `${pool}.feeVotingRewardAddress`,
      lc(r.feeVotingRewardAddress),
      g.feeVotingReward,
      det,
    );
    c.eq(
      `${pool}.bribeVotingRewardAddress`,
      lc(r.bribeVotingRewardAddress),
      g.bribeVotingReward,
      det,
    );
    c.eq(`${pool}.gaugeIsAlive`, r.gaugeIsAlive === "t", g.alive, det);
  }
  for (const [a, r] of ctx.pools) {
    if (!latest.has(a) && r.gaugeAddress)
      c.add({
        key: `${a}.gaugeAddress`,
        indexed: String(r.gaugeAddress),
        truth: "no GaugeCreated",
      });
  }
  ctx.results.push(c.done(`${latest.size} pools with gauges`));
}

/**
 * envio_chains.events_processed against the number of configured-event logs on chain.
 * @param ctx - Check context
 * @param eventsProcessed - Value from envio_chains
 * @returns void
 */
export function checkEventsProcessed(
  ctx: CheckContext,
  eventsProcessed: number,
): void {
  const c = new Check(
    "completeness.events-processed",
    ctx.chainId,
    "envio_chains.events_processed equals the number of logs of configured events emitted, up to the pinned block, by the static contracts of config.yaml and by every dynamic contract the factories / voters created.",
    "Exact: envio processes each matching log once; the count persists across restarts.",
  );
  let total = 0;
  for (const v of ctx.truth.eventCounts.values()) total += v;
  c.cmp(
    "events_processed",
    BigInt(eventsProcessed),
    BigInt(total),
    {},
    {
      unregisteredLogs: [...ctx.truth.unregisteredEventCounts.values()].reduce(
        (a, b) => a + b,
        0,
      ),
    },
  );
  c.stats.onchain = total;
  c.stats.indexer = eventsProcessed;
  ctx.results.push(
    c.done(
      `indexer ${eventsProcessed}, chain ${total} (diff ${eventsProcessed - total})`,
    ),
  );
}

/**
 * Per event type: on-chain log count vs. the counters the indexer stores.
 * @param ctx - Check context
 * @returns void
 */
export function checkEventCounters(ctx: CheckContext): void {
  const c = new Check(
    "completeness.event-counters",
    ctx.chainId,
    "Per event type, the number of logs on-chain equals the sum of the counters the indexer keeps for it (Pool.numberOfSwaps, numberOfFlashLoans, numberOfGaugeDeposits / Withdrawals / RewardClaims).",
    "Exact: each handled log increments its counter once.",
  );
  const sum = (
    field: string,
    pred: (r: Record<string, string | null>) => boolean,
  ) => {
    let s = 0n;
    for (const r of ctx.pools.values()) if (pred(r)) s += big(r[field]);
    return s;
  };
  const ev = (k: string) => BigInt(ctx.truth.eventCounts.get(k) ?? 0);
  const isCL = (r: Record<string, string | null>) => r.isCL === "t";
  const isV2 = (r: Record<string, string | null>) => r.isCL !== "t";
  const rows: [string, bigint, bigint][] = [
    [
      "Pool.Swap / Σ numberOfSwaps (V2)",
      sum("numberOfSwaps", isV2),
      ev("Pool.Swap"),
    ],
    [
      "CLPool.Swap / Σ numberOfSwaps (CL)",
      sum("numberOfSwaps", isCL),
      ev("CLPool.Swap"),
    ],
    [
      "CLPool.Flash / Σ numberOfFlashLoans",
      sum("numberOfFlashLoans", isCL),
      ev("CLPool.Flash"),
    ],
    [
      "Gauge+CLGauge Deposit / Σ numberOfGaugeDeposits",
      sum("numberOfGaugeDeposits", () => true),
      ev("Gauge.Deposit") + ev("CLGauge.Deposit"),
    ],
    [
      "Gauge+CLGauge Withdraw / Σ numberOfGaugeWithdrawals",
      sum("numberOfGaugeWithdrawals", () => true),
      ev("Gauge.Withdraw") + ev("CLGauge.Withdraw"),
    ],
    [
      "Gauge+CLGauge ClaimRewards / Σ numberOfGaugeRewardClaims",
      sum("numberOfGaugeRewardClaims", () => true),
      ev("Gauge.ClaimRewards") + ev("CLGauge.ClaimRewards"),
    ],
  ];
  for (const [k, a, b] of rows) {
    c.cmp(k, a, b);
    c.stats[k] = `${a}/${b}`;
  }
  ctx.results.push(
    c.done(
      rows.map(([k, a, b]) => `${k.split(" / ")[0]} ${a}/${b}`).join("; "),
    ),
  );
}

/**
 * envio's per-handler metrics (when the instance is running) against on-chain counts summed over the verified chains.
 * @param results - Where to push the result
 * @param metricsUrl - Prometheus endpoint
 * @param truths - Event counts per verified chain
 * @param instanceChains - All chains the instance indexes
 * @returns Promise resolving when done
 */
export async function checkHandlerMetrics(
  results: CheckContext["results"],
  metricsUrl: string | undefined,
  truths: Map<number, Map<string, number>>,
  instanceChains: number[] | undefined,
): Promise<void> {
  const c = new Check(
    "completeness.handler-metrics",
    0,
    "envio_processing_handler_total{contract,event} equals the on-chain log count summed over the instance's chains.",
    "Exact, but only meaningful when the process has run from the first block without a restart and the instance indexes only the verified chains; otherwise informational.",
  ).informational();
  if (!metricsUrl) {
    results.push(c.skip("no metrics endpoint").done(""));
    return;
  }
  let text: string;
  try {
    const res = await httpRequest(metricsUrl, { timeoutMs: 5000 });
    text = res.body.toString();
  } catch (e) {
    results.push(
      c
        .skip(
          `metrics not reachable (${(e as Error).message}); the instance is probably stopped`,
        )
        .done(""),
    );
    return;
  }
  const allVerified =
    !instanceChains || instanceChains.every((x) => truths.has(x));
  if (!allVerified) {
    results.push(
      c
        .skip(
          "the instance indexes chains that were not verified in this run; handler totals are not per chain",
        )
        .done(""),
    );
    return;
  }
  const want = new Map<string, number>();
  for (const m of truths.values())
    for (const [k, v] of m) want.set(k, (want.get(k) ?? 0) + v);
  const got = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m =
      /^envio_processing_handler_total\{contract="([^"]+)",event="([^"]+)"\}\s+([0-9.e+]+)/.exec(
        line,
      );
    if (m) got.set(`${m[1]}.${m[2]}`, Number(m[3]));
  }
  for (const k of new Set([...want.keys(), ...got.keys()]))
    c.cmp(k, BigInt(Math.round(got.get(k) ?? 0)), BigInt(want.get(k) ?? 0));
  results.push(c.done(`${got.size} handler series compared`));
}
