/**
 * Builds the ground truth of one or more chains without an indexer and
 * prints a summary (and optionally checks the truth itself against contract
 * state with --selfcheck). Useful to test the harness's log replay.
 *
 * Usage:
 *   npx -y tsx@4.19.2 scripts/verify/truth-cli.ts --chains 1750,252 [--block N] [--selfcheck] [--out dir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AbiRegistry } from "./lib/abi";
import { loadIndexerConfig } from "./lib/config";
import { loadEnv } from "./lib/env";
import { hypersyncHeight, hypersyncStats, hypersyncUrl } from "./lib/hypersync";
import { rpcStats } from "./lib/rpc";
import { jsonReplacer } from "./lib/util";
import { buildChainTruth } from "./truth/build";
import { selfCheckTruth } from "./truth/selfcheck";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadEnv();
  const repo = arg("repo");
  const cfg = repo
    ? loadIndexerConfig(path.join(repo, "config.yaml"))
    : loadIndexerConfig();
  const reg = new AbiRegistry(cfg);
  const chains = (arg("chains") ?? "").split(",").filter(Boolean).map(Number);
  const out = arg("out");
  for (const id of chains) {
    const chain = cfg.chains.get(id);
    if (!chain) throw new Error(`chain ${id} not in config.yaml`);
    const url = hypersyncUrl(id, chain.hypersyncUrl);
    const head = (await hypersyncHeight(url)) - 1;
    const block = Number(
      arg("block") ?? Math.min(head, chain.endBlock ?? head),
    );
    console.log(`chain ${id}: building truth to block ${block}`);
    const t = await buildChainTruth(chain, reg, {
      pinnedBlock: block,
      log: (m) => console.log(m),
    });
    const pools = [...t.pools.values()];
    console.log(
      JSON.stringify(
        {
          chain: id,
          block,
          pinnedTimestamp: new Date(t.pinnedTimestamp * 1000).toISOString(),
          v2Pools: pools.filter((p) => p.kind === "v2").length,
          clPools: pools.filter((p) => p.kind === "cl").length,
          gauges: t.gauges.size,
          unregisteredGauges: [...t.gauges.values()].filter(
            (g) => g.kind === "unregistered",
          ).length,
          votingRewards: t.votingRewards.size,
          wrappers: t.wrappers.size,
          nfts: t.nfts.size,
          nftsWithoutPool: [...t.nfts.values()].filter(
            (n) => !n.pool && !n.burned,
          ).length,
          users: t.users.size,
          tokens: t.tokens.size,
          eventCounts: Object.fromEntries([...t.eventCounts.entries()].sort()),
          unregisteredEventCounts: Object.fromEntries(
            t.unregisteredEventCounts,
          ),
          notes: t.notes.slice(0, 20),
          seconds: t.stats.seconds,
        },
        null,
        1,
      ),
    );
    if (process.argv.includes("--selfcheck")) {
      const res = await selfCheckTruth(t, chain, reg, {
        log: (m) => console.log(m),
      });
      console.log(JSON.stringify(res, jsonReplacer, 1));
    }
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(
        path.join(out, `truth-pools-${id}.json`),
        JSON.stringify(
          pools.map((p) => ({
            ...p,
            positions: p.positions.size,
            pendingPrincipal: p.pendingPrincipal.size,
            activeHours: p.activeHours.size,
          })),
          jsonReplacer,
          1,
        ),
      );
    }
  }
  console.log(
    `hypersync: ${hypersyncStats.requests} requests, ${(hypersyncStats.bytes / 1e6).toFixed(0)} MB; rpc: ${rpcStats.requests} requests`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
