/**
 * USD aggregates re-derived from the swaps and the indexer's own hourly
 * prices (TokenPriceSnapshot). This isolates the aggregation path (decimals,
 * trust gating, min-of-legs, fee rate) from the price itself, which the price
 * checks cover.
 */
import { decodeLog } from "../lib/abi";
import {
  LOG_FIELDS,
  hypersyncStream,
  hypersyncUrl,
  parseHsTimestamp,
} from "../lib/hypersync";
import { Check } from "../lib/report";
import { big, sample } from "../lib/util";
import type { PoolTruth } from "../truth/types";
import type { CheckContext } from "./context";

const E18 = 10n ** 18n;

function usd(amount: bigint, decimals: number, price: bigint): bigint {
  const norm =
    decimals <= 18
      ? amount * 10n ** BigInt(18 - decimals)
      : amount / 10n ** BigInt(decimals - 18);
  return (norm * price) / E18;
}

/**
 * Pool.totalVolumeUSD (all pools in the sample) and V2 totalFeesGeneratedUSD re-derived per swap.
 * @param ctx - Check context
 * @param cp - ClickHouse checkpoint of the pinned block
 * @returns Promise resolving when done
 */
export async function checkUsdAggregates(
  ctx: CheckContext,
  cp: bigint,
): Promise<void> {
  const vol = new Check(
    "usd.volume",
    ctx.chainId,
    "For a sample of pools, Pool.totalVolumeUSD equals Σ over Swap logs of the smaller non-zero trusted leg, each leg = |amount| × the token's TokenPriceSnapshot price of that hour (indexed decimals; untrusted tokens count 0).",
    "Relative 0.5% (rounding only): the swap handler refreshes both token prices before valuing the swap, so the price in effect is the token's TokenPriceSnapshot of that hour.",
  );
  const fee = new Check(
    "usd.v2-fees",
    ctx.chainId,
    "For the V2 pools of the sample, Pool.totalFeesGeneratedUSD equals Σ over swaps of the fee the pool actually took (the Fees log, input token) valued at that hour's price.",
    "Relative 0.5%: same valuation rule as the handler (input leg when credible, else the min leg) with the fee actually taken, so only the fee rate and price timing can differ.",
  );
  if (!ctx.idx.ch) {
    ctx.results.push(
      vol.skip("no ClickHouse").done(""),
      fee.skip("no ClickHouse").done(""),
    );
    return;
  }
  const active = [...ctx.truth.pools.values()].filter(
    (p) => p.swaps > 0 && ctx.pools.has(p.address),
  );
  const busiest = [...active]
    .sort((a, b) => b.swaps - a.swaps)
    .slice(0, Math.ceil(ctx.opts.snapshotPools / 2));
  const chosen: PoolTruth[] = [
    ...new Set([
      ...busiest,
      ...sample(active, ctx.opts.snapshotPools, `usd-${ctx.chainId}`),
    ]),
  ].slice(0, ctx.opts.snapshotPools);
  const priceCache = new Map<string, Map<number, bigint>>();
  const prices = async (token: string) => {
    let m = priceCache.get(token);
    if (!m) {
      m = new Map();
      const rows = await ctx.idx.ch?.query(
        `SELECT toUnixTimestamp(lastUpdatedTimestamp) AS ts, pricePerUSDNew AS p FROM envio_history_TokenPriceSnapshot
         WHERE chainId = ${ctx.chainId} AND lower(address) = '${token}' AND envio_checkpoint_id <= ${cp} AND envio_change = 'SET'
         ORDER BY id, envio_checkpoint_id DESC LIMIT 1 BY id`,
      );
      for (const r of rows ?? [])
        m.set(Math.floor(Number(r.ts) / 3600), big(r.p));
      priceCache.set(token, m);
    }
    return m;
  };
  const trusted = (t: string) =>
    ctx.tokens.get(t)?.priceTrustOutcome === "TRUSTED";
  const dec = (t: string) => Number(ctx.tokens.get(t)?.decimals ?? 18);
  for (const p of chosen) {
    const r = ctx.pools.get(p.address);
    if (!r) continue;
    const [p0, p1] = await Promise.all([prices(p.token0), prices(p.token1)]);
    const priceAt = (m: Map<number, bigint>, ts: number) => {
      const h = Math.floor(ts / 3600);
      for (let k = h; k > h - 24 * 7; k--) {
        const v = m.get(k);
        if (v !== undefined) return v;
      }
      return 0n;
    };
    const tm = ctx.reg.topicMap(p.kind === "cl" ? "CLPool" : "Pool");
    let volume = 0n;
    let fees = 0n;
    let lastFees: { tx: string; a0: bigint; a1: bigint } | undefined;
    await hypersyncStream(
      hypersyncUrl(ctx.chainId, ctx.chain.hypersyncUrl),
      {
        from_block: p.created.block,
        to_block: ctx.truth.pinnedBlock + 1,
        logs: [
          {
            address: [p.address],
            topics: [
              [...tm.values()]
                .filter((d) => d.name === "Swap" || d.name === "Fees")
                .map((d) => d.topic0),
            ],
          },
        ],
        field_selection: { log: LOG_FIELDS, block: ["number", "timestamp"] },
      },
      (page) => {
        const bts = new Map(
          page.blocks.map((b) => [b.number, parseHsTimestamp(b.timestamp)]),
        );
        page.logs.sort(
          (a, b) =>
            a.block_number - b.block_number || a.log_index - b.log_index,
        );
        for (const l of page.logs) {
          const def = tm.get(l.topic0 ?? "");
          if (!def) continue;
          const d = decodeLog(def, l);
          const ts = bts.get(l.block_number) ?? 0;
          const pr0 = trusted(p.token0) ? priceAt(p0, ts) : 0n;
          const pr1 = trusted(p.token1) ? priceAt(p1, ts) : 0n;
          if (def.name === "Fees") {
            lastFees = {
              tx: l.transaction_hash ?? "",
              a0: d.amount0 as bigint,
              a1: d.amount1 as bigint,
            };
            continue;
          }
          let a0: bigint;
          let a1: bigint;
          if (p.kind === "cl") {
            a0 =
              (d.amount0 as bigint) < 0n
                ? -(d.amount0 as bigint)
                : (d.amount0 as bigint);
            a1 =
              (d.amount1 as bigint) < 0n
                ? -(d.amount1 as bigint)
                : (d.amount1 as bigint);
          } else {
            a0 = (d.amount0In as bigint) + (d.amount0Out as bigint);
            a1 = (d.amount1In as bigint) + (d.amount1Out as bigint);
          }
          const u0 = usd(a0, dec(p.token0), pr0);
          const u1 = usd(a1, dec(p.token1), pr1);
          const v =
            u0 !== 0n && u1 !== 0n ? (u0 < u1 ? u0 : u1) : u0 !== 0n ? u0 : u1;
          volume += v;
          if (
            p.kind === "v2" &&
            lastFees &&
            lastFees.tx === l.transaction_hash
          ) {
            // Same valuation rule as the handler (input leg if credible, else the min leg),
            // but with the fee the pool actually took instead of the stored rate.
            const in0 = (d.amount0In as bigint) > 0n;
            const amountIn = in0
              ? (d.amount0In as bigint)
              : (d.amount1In as bigint);
            const feeAmt = in0 ? lastFees.a0 : lastFees.a1;
            const inUsd = usd(
              amountIn +
                (in0 ? (d.amount0Out as bigint) : (d.amount1Out as bigint)),
              dec(in0 ? p.token0 : p.token1),
              in0 ? pr0 : pr1,
            );
            const counter = in0 ? u1 : u0;
            const base =
              inUsd !== 0n && (counter === 0n || inUsd <= counter * 10n)
                ? inUsd
                : v;
            if (amountIn > 0n) fees += (base * feeAmt) / amountIn;
          }
        }
      },
    );
    const det = { kind: p.kind, swaps: p.swaps };
    vol.cmp(
      `${p.address}.totalVolumeUSD`,
      big(r.totalVolumeUSD),
      volume,
      { rel: 0.005, abs: E18 },
      det,
    );
    if (p.kind === "v2")
      fee.cmp(
        `${p.address}.totalFeesGeneratedUSD`,
        big(r.totalFeesGeneratedUSD),
        fees,
        { rel: 0.005, abs: E18 / 10n },
        { ...det, currentFee: String(r.currentFee) },
      );
  }
  ctx.results.push(vol.done(`${chosen.length} pools re-streamed`));
  ctx.results.push(
    fee.done(`${chosen.filter((p) => p.kind === "v2").length} V2 pools`),
  );
}
