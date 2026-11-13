/**
 * Indexer verification harness: compares an indexer instance with ground truth
 * recomputed from raw logs (HyperSync) and contract state (RPC), and writes a
 * report. See docs/verification.md.
 *
 * Usage:
 *   npx -y tsx@4.19.2 scripts/verify/run.ts --velo scratch/verify [--chains 1750,252] [--out DIR]
 *   npx -y tsx@4.19.2 scripts/verify/run.ts --pg postgres://u:p@host:5432/db [--pg-schema public]
 *        [--ch-url http://host:8123 --ch-db db --ch-user u --ch-password-env VAR] [--metrics URL] ...
 * Options:
 *   --only a,b        run only checks whose id starts with one of the prefixes
 *   --sample N        items per RPC-sampled comparison (default 25)
 *   --snapshot-pools N pools re-streamed for snapshot value checks (default 8)
 *   --ref-prices DIR  directory with prod_prices_<chainId>.tsv (production oracle export)
 *   --no-defillama    skip the DefiLlama price comparison
 *   --allow-live      do not fail when the instance advanced during the run
 * Exit code: 0 when no check failed, 1 when a check failed, 2 on a harness error.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  checkEventCounters,
  checkEventsProcessed,
  checkGaugeLinks,
  checkHandlerMetrics,
  checkPools,
  checkRegistrations,
  checkTickSpacingFees,
} from "./checks/completeness";
import {
  type CheckContext,
  type CheckOptions,
  loadCommon,
} from "./checks/context";
import {
  checkEmissions,
  checkGaugeTotals,
  checkVotingRewardCounts,
} from "./checks/gauges";
import { checkCLPools, checkV2Pools } from "./checks/pools";
import { checkAlmWrappers, checkPositions } from "./checks/positions";
import { checkSnapshots } from "./checks/snapshots";
import { checkStores } from "./checks/store";
import {
  checkPrices,
  checkTokenMetadata,
  checkWhitelist,
} from "./checks/tokens";
import { checkUsdAggregates } from "./checks/usd";
import { checkUsers } from "./checks/users";
import { AbiRegistry } from "./lib/abi";
import { loadIndexerConfig } from "./lib/config";
import { loadEnv } from "./lib/env";
import { hypersyncStats } from "./lib/hypersync";
import { Indexed } from "./lib/indexed";
import { type CheckResult, type RunReport, writeReport } from "./lib/report";
import { rpcFor, rpcStats } from "./lib/rpc";
import { targetFromOptions } from "./lib/target";
import { buildChainTruth } from "./truth/build";

function parseArgs(argv: string[]): Record<string, string | undefined> {
  const o: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a
      .slice(2)
      .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) o[k] = "true";
    else {
      o[k] = next;
      i++;
    }
  }
  return o;
}

async function main(): Promise<number> {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const target = targetFromOptions(args);
  const cfg = loadIndexerConfig();
  const reg = new AbiRegistry(cfg);
  const out = path.resolve(
    args.out ??
      path.join(
        "scripts",
        "verify",
        "out",
        `${target.label.replace(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      ),
  );
  mkdirSync(out, { recursive: true });
  process.env.VERIFY_RPC_LEDGER ??= path.join(out, "rpc-ledger.tsv");
  const only = args.only ? args.only.split(",") : undefined;
  const want = (id: string) => !only || only.some((p) => id.startsWith(p));
  const opts: CheckOptions = {
    sample: Number(args.sample ?? 25),
    snapshotPools: Number(args.snapshotPools ?? 8),
    refPriceDir: args.refPrices,
    defillama: args.noDefillama !== "true",
    defillamaSamples: Number(args.defillamaSamples ?? 40),
  };
  const log = (m: string) =>
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

  const idx = new Indexed(target);
  await idx.connect();
  const startedAt = new Date().toISOString();
  const progress = await idx.progress();
  const requested = args.chains
    ? args.chains.split(",").map(Number)
    : progress.map((p) => p.chainId);
  const report: RunReport = {
    target: target.label,
    startedAt,
    finishedAt: "",
    chains: [],
    results: [],
    usage: {},
    warnings: [],
  };
  const truthCounts = new Map<number, Map<string, number>>();

  for (const chainId of requested) {
    const pr = progress.find((p) => p.chainId === chainId);
    const chain = cfg.chains.get(chainId);
    if (!pr || !chain) {
      report.warnings.push(
        `chain ${chainId}: ${!pr ? "not indexed by the target" : "not in config.yaml"}; skipped`,
      );
      continue;
    }
    if (pr.progressBlock < chain.startBlock) {
      report.warnings.push(`chain ${chainId}: no progress yet; skipped`);
      continue;
    }
    const pinned = pr.progressBlock;
    log(
      `chain ${chainId}: pinned at block ${pinned} (${pr.eventsProcessed} events processed); building ground truth`,
    );
    const truth = await buildChainTruth(chain, reg, {
      pinnedBlock: pinned,
      log,
    });
    truthCounts.set(chainId, truth.eventCounts);
    report.chains.push({
      chainId,
      pinnedBlock: pinned,
      pinnedTimestamp: new Date(truth.pinnedTimestamp * 1000).toISOString(),
      truthSeconds: truth.stats.seconds,
      truthLogs: truth.stats.logs,
      notes: truth.notes.slice(0, 50),
    });
    const ctx: CheckContext = {
      chainId,
      chain,
      truth,
      idx,
      rpc: rpcFor(chain.rpcEnvVar, chainId),
      reg,
      opts,
      log,
      pools: new Map(),
      tokens: new Map(),
      tokenMeta: new Map(),
      results: [],
    };
    if (!ctx.rpc)
      report.warnings.push(
        `chain ${chainId}: no RPC URL (${chain.rpcEnvVar ?? "none in config.yaml"}); contract-state checks skipped`,
      );
    await loadCommon(ctx);
    const cp = idx.ch ? await idx.chCheckpointAt(chainId, pinned) : 0n;
    const steps: [string, () => void | Promise<void>][] = [
      ["completeness.pools", () => checkPools(ctx)],
      ["completeness.registrations", () => checkRegistrations(ctx)],
      ["completeness.gauge-links", () => checkGaugeLinks(ctx)],
      ["completeness.tick-spacing-fees", () => checkTickSpacingFees(ctx)],
      [
        "completeness.events-processed",
        () => checkEventsProcessed(ctx, pr.eventsProcessed),
      ],
      ["completeness.event-counters", () => checkEventCounters(ctx)],
      ["pool.v2", () => checkV2Pools(ctx)],
      ["pool.cl", () => checkCLPools(ctx)],
      ["gauge", () => checkGaugeTotals(ctx)],
      [
        "rewards.emissions",
        () =>
          checkEmissions(
            ctx,
            progress.some((p) => p.chainId === 10),
          ),
      ],
      ["rewards.voting-claims", () => checkVotingRewardCounts(ctx)],
      ["user", () => checkUsers(ctx)],
      ["position", () => checkPositions(ctx)],
      ["alm", () => checkAlmWrappers(ctx)],
      [
        "token",
        () => {
          checkTokenMetadata(ctx);
          checkWhitelist(ctx);
        },
      ],
      ["price", () => checkPrices(ctx)],
      ["snapshot", () => checkSnapshots(ctx, cp)],
      ["usd", () => checkUsdAggregates(ctx, cp)],
    ];
    for (const [id, fn] of steps) {
      if (!want(id)) continue;
      log(`chain ${chainId}: ${id}`);
      try {
        await fn();
      } catch (e) {
        ctx.results.push({
          id: `${id}.harness-error`,
          chainId,
          title: `Harness error while running ${id}`,
          status: "fail",
          tolerance: "-",
          summary: String((e as Error).stack ?? e).slice(0, 800),
          stats: {},
          offenderCount: 1,
          offenders: [],
        });
      }
    }
    report.results.push(...ctx.results);
    const fails = ctx.results.filter((r) => r.status === "fail").length;
    log(`chain ${chainId}: ${ctx.results.length} results, ${fails} failing`);
  }

  if (want("store")) {
    log("store consistency (Postgres vs ClickHouse)");
    try {
      report.results.push(...(await checkStores(idx, requested)));
    } catch (e) {
      report.results.push({
        id: "store.harness-error",
        chainId: 0,
        title: "Harness error",
        status: "fail",
        tolerance: "-",
        summary: String(e).slice(0, 800),
        stats: {},
        offenderCount: 1,
        offenders: [],
      });
    }
  }
  if (want("completeness.handler-metrics")) {
    const r: CheckResult[] = [];
    await checkHandlerMetrics(
      r,
      target.metricsUrl,
      truthCounts,
      target.chains,
      new Map(report.chains.map((c) => [c.chainId, c.pinnedBlock])),
    );
    report.results.push(...r);
  }

  const after = await idx.progress();
  for (const p of after) {
    const b = progress.find((x) => x.chainId === p.chainId);
    if (
      b &&
      b.progressBlock !== p.progressBlock &&
      requested.includes(p.chainId)
    ) {
      report.warnings.push(
        `chain ${p.chainId} advanced from ${b.progressBlock} to ${p.progressBlock} during the run: the instance is live, so row values may be newer than the pinned block. Stop the instance for an exact run.`,
      );
    }
  }
  idx.close();
  report.finishedAt = new Date().toISOString();
  report.usage = {
    hypersyncRequests: hypersyncStats.requests,
    hypersyncMB: Math.round(hypersyncStats.bytes / 1e6),
    hypersyncLogs: hypersyncStats.logs,
    rpcRequests: rpcStats.requests,
    rpcRetries: rpcStats.retries,
    rpcFailures: rpcStats.failures,
  };
  const files = writeReport(out, report);
  const failed = report.results.filter((r) => r.status === "fail");
  log(`report: ${files.join(", ")}`);
  log(
    `${report.results.length} results: ${failed.length} fail, ${report.results.filter((r) => r.status === "warn").length} warn, ${report.results.filter((r) => r.status === "skip").length} skip`,
  );
  for (const f of failed)
    log(`  FAIL ${f.chainId} ${f.id}: ${f.summary.slice(0, 160)}`);
  const liveWarning = report.warnings.some((w) => w.includes("advanced"));
  if (liveWarning && args.allowLive !== "true")
    log("instance advanced during the run (use --allow-live to accept)");
  return failed.length > 0 || (liveWarning && args.allowLive !== "true")
    ? 1
    : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
