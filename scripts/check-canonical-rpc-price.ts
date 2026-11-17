/**
 * Live check of the canonical source RPC price
 * (docs/adr/0010-canonical-source-rpc-price.md).
 *
 *   1. Config: for every pool in `CANONICAL_SOURCE_POOLS`, `token0()`,
 *      `token1()` and both tokens' `decimals()` on chain must equal the
 *      configured values.
 *   2. Prices: runs the `getCanonicalSourceRpcPrice` handler for a run of
 *      clock hours per source, through the indexer's own retry / fallback /
 *      rate-limit path, and prints one row per (source, hour).
 *   3. Agreement (with `--reference`): compares each price with the source
 *      chain's own indexed price for the same hour.
 *   4. Volume: prints how many RPC requests the run made.
 *
 * Usage:
 *
 *   npx -y tsx@4.19.2 scripts/check-canonical-rpc-price.ts
 *       [--hours 24] [--step 1] [--end 2026-11-16T05:00:00Z]
 *       [--source 10-0x4200…0006] [--reference prices.tsv] [--out rows.tsv]
 *
 * `--end` is the last hour asked (default: the last complete clock hour);
 * `--step` asks every Nth hour. The reference file is tab-separated with a
 * header, columns `sourceTokenId`, `hourMs`, `priceUSD` (1e18-base integer),
 * e.g. from the source chain's ClickHouse:
 *
 *   SELECT token_id, toUnixTimestamp(toStartOfHour(lastUpdatedTimestamp)) * 1000,
 *          pricePerUSDNew
 *   FROM TokenPriceSnapshot WHERE priceSource = 'pool' AND token_id IN (…)
 *
 * Needs ENVIO_DRPC_API_KEY or the per-chain RPC URLs. Requests: 4 per pool for
 * the config check, then about 2 per source and hour.
 */

import { readFileSync, writeFileSync } from "node:fs";
import "dotenv/config";
import { parseAbi } from "viem";
import { toChecksumAddress } from "../src/Constants";
import {
  getCanonicalRpcStats,
  getCanonicalSourceRpcPrice,
} from "../src/Effects/CanonicalSourceRpcPrice";
import { executeRpc, getRpcStats } from "../src/Effects/RpcGateway";
import { listCanonicalSourcePools } from "../src/PriceOverrides";

const HOUR_MS = 3_600_000;

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const HOURS = Number(opt("--hours") ?? 24);
const STEP = Number(opt("--step") ?? 1);
const END_MS = opt("--end")
  ? Math.floor(Date.parse(opt("--end") as string) / HOUR_MS) * HOUR_MS
  : Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS;
const ONLY_SOURCE = opt("--source");
const REFERENCE = opt("--reference");
const OUT = opt("--out");

type Output = {
  priceUSD: bigint;
  depthUSD: bigint;
  poolAddress: string;
  sourceBlock: number;
  sourceTimestamp: number;
};
type Handler = {
  handler: (a: { input: unknown; context: unknown }) => Promise<Output>;
};

const quietLog = {
  error: (msg: string) => console.error("    [error]", msg),
  warn: (msg: string) => console.warn("    [warn]", msg),
  info: () => {},
  debug: () => {},
};

const TOKEN_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function decimals() view returns (uint8)",
]);

/** 1e18-base USD as a decimal string with 6 places. */
function usd(value: bigint): string {
  return (Number(value / 10n ** 12n) / 1e6).toFixed(6);
}

/**
 * Checks every configured pool's tokens and decimals against the chain.
 *
 * @returns The number of mismatches
 */
async function checkConfig(): Promise<number> {
  let bad = 0;
  for (const { sourceTokenId, pools } of listCanonicalSourcePools()) {
    const chainId = Number(sourceTokenId.slice(0, sourceTokenId.indexOf("-")));
    for (const pool of pools) {
      const address = pool.address as `0x${string}`;
      const result = await executeRpc(
        { log: quietLog },
        { name: "checkCanonicalRpcPrice.config", chainId },
        null,
        async (client) => {
          const [token0, token1, decimals0, decimals1] = await Promise.all([
            client.readContract({
              address,
              abi: TOKEN_ABI,
              functionName: "token0",
            }),
            client.readContract({
              address,
              abi: TOKEN_ABI,
              functionName: "token1",
            }),
            client.readContract({
              address: pool.token0.address as `0x${string}`,
              abi: TOKEN_ABI,
              functionName: "decimals",
            }),
            client.readContract({
              address: pool.token1.address as `0x${string}`,
              abi: TOKEN_ABI,
              functionName: "decimals",
            }),
          ]);
          return { token0, token1, decimals0, decimals1 };
        },
      );
      const onChain = result.value;
      const ok =
        onChain !== null &&
        toChecksumAddress(onChain.token0) === pool.token0.address &&
        toChecksumAddress(onChain.token1) === pool.token1.address &&
        onChain.decimals0 === pool.token0.decimals &&
        onChain.decimals1 === pool.token1.decimals;
      if (!ok) bad++;
      console.log(
        `  ${ok ? "ok " : "BAD"} ${sourceTokenId} pool ${pool.address} (${pool.isCL ? "CL" : "V2"}): ${
          onChain
            ? `token0 ${onChain.token0} (${onChain.decimals0}), token1 ${onChain.token1} (${onChain.decimals1})`
            : `no answer (${result.errorClass})`
        }`,
      );
    }
  }
  return bad;
}

/**
 * Reads the reference prices.
 *
 * @param path - TSV file (`sourceTokenId`, `hourMs`, `priceUSD`)
 * @returns Prices by `${sourceTokenId}|${hourMs}`
 */
function readReference(path: string): Map<string, bigint> {
  const prices = new Map<string, bigint>();
  for (const line of readFileSync(path, "utf8").split("\n").slice(1)) {
    const [sourceTokenId, hourMs, priceUSD] = line.split("\t");
    if (!sourceTokenId || !hourMs || !priceUSD) continue;
    prices.set(`${sourceTokenId}|${Number(hourMs)}`, BigInt(priceUSD));
  }
  return prices;
}

async function main(): Promise<void> {
  // The RPC rate limiter waits on an unref'd timer, which alone does not keep
  // a script's event loop alive.
  const keepAlive = setInterval(() => {}, 1_000);
  console.log("Canonical source pools on chain");
  const bad = await checkConfig();

  const reference = REFERENCE ? readReference(REFERENCE) : undefined;
  const sources = listCanonicalSourcePools()
    .map((s) => s.sourceTokenId)
    .filter((id) => !ONLY_SOURCE || id === ONLY_SOURCE);
  const hours: number[] = [];
  for (let i = HOURS - 1; i >= 0; i--) hours.push(END_MS - i * STEP * HOUR_MS);

  const before = getCanonicalRpcStats();
  const started = Date.now();
  const rows: string[] = [
    [
      "sourceTokenId",
      "hour",
      "priceUSD",
      "depthUSD",
      "pool",
      "sourceBlock",
      "sourceTime",
      "referenceUSD",
      "diffPct",
    ].join("\t"),
  ];
  const diffs = new Map<string, number[]>();
  let failed = 0;
  // Oldest hour first and every source per hour, as a backfill asks them.
  for (const hourMs of hours) {
    for (const sourceTokenId of sources) {
      const hour = new Date(hourMs).toISOString();
      try {
        const out = await (
          getCanonicalSourceRpcPrice as unknown as Handler
        ).handler({
          input: { sourceTokenId, hourMs },
          context: { cache: true, log: quietLog },
        });
        const ref = reference?.get(`${sourceTokenId}|${hourMs}`);
        let diffPct = "";
        if (ref !== undefined && ref > 0n && out.priceUSD > 0n) {
          const diff =
            Number(((out.priceUSD - ref) * 1_000_000n) / ref) / 10_000;
          diffPct = diff.toFixed(4);
          const list = diffs.get(sourceTokenId) ?? [];
          list.push(Math.abs(diff));
          diffs.set(sourceTokenId, list);
        }
        rows.push(
          [
            sourceTokenId,
            hour,
            usd(out.priceUSD),
            usd(out.depthUSD),
            out.poolAddress,
            out.sourceBlock,
            out.sourceTimestamp
              ? new Date(out.sourceTimestamp * 1000).toISOString()
              : "",
            ref === undefined ? "" : usd(ref),
            diffPct,
          ].join("\t"),
        );
      } catch (error) {
        failed++;
        rows.push(
          [
            sourceTokenId,
            hour,
            "",
            "",
            "",
            "",
            "",
            "",
            `no answer: ${error instanceof Error ? error.message : error}`,
          ].join("\t"),
        );
      }
    }
  }
  const elapsedMs = Date.now() - started;

  if (OUT) {
    writeFileSync(OUT, `${rows.join("\n")}\n`);
    console.log(`\n${rows.length - 1} rows written to ${OUT}`);
  } else {
    console.log(`\n${rows.join("\n")}`);
  }

  const after = getCanonicalRpcStats();
  const asked = hours.length * sources.length;
  const requests =
    after.blockRequests -
    before.blockRequests +
    // Every pool read is one batched HTTP request.
    (after.poolReads - before.poolReads);
  console.log(
    `\n${asked} source-hours in ${(elapsedMs / 1000).toFixed(1)} s: ${after.priced - before.priced} priced, ${after.none - before.none} without a price, ${failed} without an answer`,
  );
  console.log(
    `RPC: ${after.blockRequests - before.blockRequests} getBlock + ${after.poolReads - before.poolReads} pool reads = ${requests} requests (${(requests / Math.max(asked, 1)).toFixed(2)} per source-hour)`,
  );
  for (const [sourceTokenId, list] of diffs) {
    const sorted = [...list].sort((a, b) => a - b);
    const at = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    console.log(
      `vs reference ${sourceTokenId}: n=${sorted.length} |diff| median ${at(0.5).toFixed(3)}% p95 ${at(0.95).toFixed(3)}% max ${sorted[sorted.length - 1].toFixed(3)}%`,
    );
  }
  console.log("RPC stats:", JSON.stringify(getRpcStats()));
  if (bad > 0 || failed > 0) process.exitCode = 1;
  clearInterval(keepAlive);
}

main();
