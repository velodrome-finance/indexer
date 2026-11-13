/**
 * Token metadata, whitelist flags, and USD prices against two references:
 * production's old oracle export and DefiLlama's public coins API.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { httpRequest } from "../lib/http";
import { Check } from "../lib/report";
import { big, lc } from "../lib/util";
import type { CheckContext } from "./context";

/** DefiLlama chain slugs (extend when chains are added to config.yaml). */
export const LLAMA_SLUG: Record<number, string> = {
  1: "ethereum",
  10: "optimism",
  130: "unichain",
  252: "fraxtal",
  1135: "lisk",
  1750: "metal",
  1868: "soneium",
  1923: "swellchain",
  5330: "superseed",
  8453: "base",
  34443: "mode",
  42161: "arbitrum",
  42220: "celo",
  57073: "ink",
  4663: "robinhood",
  5042: "arc",
};

/** Production oracle prices are only meaningful before this date (outage from 2026-11-03). */
const PROD_REF_CUTOFF = Date.UTC(2026, 10, 3) / 1000;

/**
 * Token decimals / symbol against the chain, and pool tokens having a Token row.
 * @param ctx - Check context
 * @returns void
 */
export function checkTokenMetadata(ctx: CheckContext): void {
  const c = new Check(
    "token.metadata",
    ctx.chainId,
    "Every pool token has a Token row whose decimals and symbol equal decimals() / symbol() at the pinned block (bytes32 symbols decoded). An empty indexed symbol or a decimals value that differs from the chain is a failure.",
    "Exact.",
  );
  if (!ctx.rpc) {
    ctx.results.push(c.skip("no RPC").done(""));
    return;
  }
  let emptySymbols = 0;
  for (const t of ctx.truth.tokens) {
    const r = ctx.tokens.get(t);
    const m = ctx.tokenMeta.get(t);
    if (!r) {
      c.add(
        {
          key: t,
          indexed: "missing",
          truth: `pool token${m?.symbol ? ` ${m.symbol}` : ""}`,
        },
        5,
      );
      continue;
    }
    if (!m || m.decimals === null) {
      c.add(
        {
          key: `${t}.decimals`,
          indexed: String(r.decimals),
          truth: `decimals() reverted: ${m?.error ?? "?"}`,
        },
        0.5,
      );
      continue;
    }
    c.eq(`${t}.decimals`, r.decimals, m.decimals, { symbol: m.symbol ?? "" });
    if (!r.symbol) emptySymbols++;
    if (m.symbol !== null) c.eq(`${t}.symbol`, r.symbol ?? "", m.symbol);
  }
  ctx.results.push(
    c.done(
      `${ctx.truth.tokens.size} pool tokens; ${emptySymbols} indexed with an empty symbol`,
    ),
  );
}

/**
 * Token.isWhitelisted against the last WhitelistToken event of the chain's voter.
 * @param ctx - Check context
 * @returns void
 */
export function checkWhitelist(ctx: CheckContext): void {
  const c = new Check(
    "token.whitelist",
    ctx.chainId,
    "Token.isWhitelisted equals the last WhitelistToken(token, bool) of the chain's voter (false when never emitted).",
    "Exact.",
  );
  for (const [a, r] of ctx.tokens) {
    c.eq(
      `${a}.isWhitelisted`,
      r.isWhitelisted === "t",
      ctx.truth.whitelist.get(a) ?? false,
      { symbol: r.symbol ?? "" },
    );
    // Aero schema: isListedOnAero follows the token registry's last ListingSet.
    if ("isListedOnAero" in r) {
      const h = ctx.truth.listingHistory.get(a);
      const listed = h && h.length > 0 ? h[h.length - 1].value : false;
      c.eq(`${a}.isListedOnAero`, r.isListedOnAero === "t", listed, {
        symbol: r.symbol ?? "",
      });
    }
  }
  ctx.results.push(
    c.done(
      `${ctx.tokens.size} tokens, ${[...ctx.truth.whitelist.values()].filter(Boolean).length} whitelisted on chain`,
    ),
  );
}

interface PricePoint {
  price: number;
  source: string;
}

/**
 * Loads TokenPriceSnapshot rows of a chain from ClickHouse.
 * @param ctx - Check context
 * @returns address -> hour -> point
 */
async function loadPriceSnapshots(
  ctx: CheckContext,
): Promise<Map<string, Map<number, PricePoint>>> {
  const out = new Map<string, Map<number, PricePoint>>();
  if (!ctx.idx.ch) return out;
  const rows = await ctx.idx.ch.query(
    `SELECT lower(address) AS a, toUnixTimestamp(lastUpdatedTimestamp) AS ts, pricePerUSDNew AS p, ifNull(priceSource, '') AS s
     FROM envio_history_TokenPriceSnapshot
     WHERE chainId = ${ctx.chainId} AND envio_change = 'SET'
     ORDER BY id, envio_checkpoint_id DESC LIMIT 1 BY id`,
  );
  for (const r of rows) {
    const a = r.a as string;
    const m = out.get(a) ?? new Map();
    m.set(Math.floor(Number(r.ts) / 3600), {
      price: Number(big(r.p)) / 1e18,
      source: r.s as string,
    });
    out.set(a, m);
  }
  return out;
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/**
 * Price coverage and accuracy.
 * @param ctx - Check context
 * @returns Promise resolving when done
 */
export async function checkPrices(ctx: CheckContext): Promise<void> {
  const cov = new Check(
    "price.coverage",
    ctx.chainId,
    "For every token, the share of clock hours with pool activity (a handled log of a pool holding the token) that have a positive hourly price (TokenPriceSnapshot). Tokens that hold real liquidity (≥ $10k on the priced side of their pools at the pinned block) but are unpriced now are listed.",
    "Informational: unpriced is by design below the $1,000 depth floor (ADR 0003); the list is for review.",
  ).informational();
  const prod = new Check(
    "price.vs-prod-oracle",
    ctx.chainId,
    "Hourly TokenPriceSnapshot prices against production's old oracle (export, valid before 2026-11-03), per token over the hours both have a positive price.",
    "Per token with ≥ 24 shared hours: median relative error ≤ 5% (the two use different methods; deep tokens agree within ~1%). The oracle is known to be wrong for some tokens, so a failure needs a third reference (DefiLlama check).",
  );
  const llama = new Check(
    "price.vs-defillama",
    ctx.chainId,
    "Daily DefiLlama prices (coins.llama.fi chart API, keyless) against the indexed hourly price of the same hour, per token DefiLlama knows.",
    "Per token: median relative error ≤ 5% over the sampled days.",
  );
  if (!ctx.idx.ch) {
    for (const c of [cov, prod, llama])
      ctx.results.push(c.skip("no ClickHouse").done(""));
    return;
  }
  const snaps = await loadPriceSnapshots(ctx);
  const symbol = (a: string) =>
    ctx.tokens.get(a)?.symbol ?? ctx.tokenMeta.get(a)?.symbol ?? "";

  // ---- coverage ----
  const activeByToken = new Map<string, Set<number>>();
  for (const p of ctx.truth.pools.values()) {
    for (const t of [p.token0, p.token1]) {
      const s = activeByToken.get(t) ?? new Set<number>();
      for (const h of p.activeHours) s.add(h);
      activeByToken.set(t, s);
    }
  }
  let totActive = 0;
  let totPriced = 0;
  for (const [t, hours] of activeByToken) {
    const m = snaps.get(t);
    let priced = 0;
    for (const h of hours) if ((m?.get(h)?.price ?? 0) > 0) priced++;
    totActive += hours.size;
    totPriced += priced;
    cov.stats[`${symbol(t) || t}`] = `${priced}/${hours.size}`;
  }
  // Unpriced tokens with liquidity: value the priced side of each pool at current prices.
  const priceNow = (a: string) =>
    Number(big(ctx.tokens.get(a)?.pricePerUSDNew)) / 1e18;
  const dec = (a: string) =>
    Number(ctx.tokenMeta.get(a)?.decimals ?? ctx.tokens.get(a)?.decimals ?? 18);
  const liquidityUsd = new Map<string, number>();
  for (const p of ctx.truth.pools.values()) {
    const r = ctx.pools.get(p.address);
    if (!r) continue;
    const res0 = Number(big(r.reserve0)) / 10 ** dec(p.token0);
    const res1 = Number(big(r.reserve1)) / 10 ** dec(p.token1);
    if (priceNow(p.token1) > 0)
      liquidityUsd.set(
        p.token0,
        (liquidityUsd.get(p.token0) ?? 0) + res1 * priceNow(p.token1),
      );
    if (priceNow(p.token0) > 0)
      liquidityUsd.set(
        p.token1,
        (liquidityUsd.get(p.token1) ?? 0) + res0 * priceNow(p.token0),
      );
  }
  for (const [t, usd] of liquidityUsd) {
    if (usd >= 10_000 && priceNow(t) === 0) {
      cov.add(
        {
          key: `${symbol(t)} ${t}`,
          indexed: "price 0 at pinned block",
          truth: `≈$${Math.round(usd)} of counterparty liquidity`,
          detail: {
            lastSuccess:
              ctx.tokens.get(t)?.lastSuccessfulPriceTimestamp ?? "never",
          },
        },
        usd / 1e6,
      );
    }
  }
  ctx.results.push(
    cov.done(
      `${totPriced}/${totActive} token-hours with activity have a positive price (${((100 * totPriced) / Math.max(1, totActive)).toFixed(1)}%)`,
    ),
  );

  // ---- production oracle export ----
  const refFile = ctx.opts.refPriceDir
    ? path.join(ctx.opts.refPriceDir, `prod_prices_${ctx.chainId}.tsv`)
    : "";
  if (!refFile || !existsSync(refFile)) {
    ctx.results.push(
      prod
        .skip(`no reference file ${refFile || "(--ref-prices not set)"}`)
        .done(""),
    );
  } else {
    const ref = new Map<string, Map<number, number>>();
    for (const line of readFileSync(refFile, "utf8").split("\n")) {
      const [a, hour, price] = line.split("\t");
      if (!a || !hour) continue;
      const ts = Date.parse(`${hour.replace(" ", "T")}Z`) / 1000;
      if (!(ts < PROD_REF_CUTOFF)) continue;
      const m = ref.get(lc(a)) ?? new Map();
      m.set(Math.floor(ts / 3600), Number(price));
      ref.set(lc(a), m);
    }
    let tokensCompared = 0;
    for (const [t, m] of snaps) {
      const rm = ref.get(t);
      if (!rm) continue;
      const errs: number[] = [];
      let worst = { h: 0, idx: 0, ref: 0, err: 0 };
      for (const [h, pt] of m) {
        const rp = rm.get(h);
        if (!(pt.price > 0) || !(rp && rp > 0)) continue;
        const e = Math.abs(pt.price / rp - 1);
        errs.push(e);
        if (e > worst.err) worst = { h, idx: pt.price, ref: rp, err: e };
      }
      if (errs.length < 24) continue;
      tokensCompared++;
      const med = quantile(errs, 0.5);
      const p95 = quantile(errs, 0.95);
      prod.stats[`${symbol(t) || t}`] =
        `n=${errs.length} median=${(med * 100).toFixed(2)}% p95=${(p95 * 100).toFixed(2)}%`;
      prod.compared++;
      if (med > 0.05) {
        prod.add(
          {
            key: `${symbol(t)} ${t}`,
            indexed: `median err ${(med * 100).toFixed(1)}%`,
            truth: `prod oracle, n=${errs.length}`,
            detail: {
              p95: `${(p95 * 100).toFixed(1)}%`,
              worstHour: new Date(worst.h * 3600_000).toISOString(),
              worstIndexed: worst.idx,
              worstRef: worst.ref,
            },
          },
          med,
        );
      }
    }
    ctx.results.push(
      prod.done(`${tokensCompared} tokens with ≥ 24 shared priced hours`),
    );
  }

  // ---- DefiLlama ----
  const slug = LLAMA_SLUG[ctx.chainId];
  if (!ctx.opts.defillama || !slug) {
    ctx.results.push(
      llama
        .skip(
          slug
            ? "disabled (--no-defillama)"
            : `no DefiLlama slug for chain ${ctx.chainId}`,
        )
        .done(""),
    );
    return;
  }
  let compared = 0;
  let unknown = 0;
  const tokens = [...snaps.keys()]
    .filter((t) => [...(snaps.get(t)?.values() ?? [])].some((p) => p.price > 0))
    .slice(0, ctx.opts.defillamaSamples);
  for (const t of tokens) {
    const m = snaps.get(t);
    if (!m) continue;
    const hours = [...m.keys()].sort((a, b) => a - b);
    const start = hours[0] * 3600;
    const days = Math.min(
      500,
      Math.max(1, Math.floor((hours[hours.length - 1] * 3600 - start) / 86400)),
    );
    let body: {
      coins?: Record<
        string,
        { prices: { timestamp: number; price: number }[] }
      >;
    };
    try {
      const res = await httpRequest(
        `https://coins.llama.fi/chart/${slug}:${t}?start=${start}&span=${days}&period=1d&searchWidth=600`,
        { timeoutMs: 30_000 },
      );
      body = JSON.parse(res.body.toString());
    } catch {
      continue;
    }
    const series = Object.values(body.coins ?? {})[0]?.prices ?? [];
    if (series.length === 0) {
      unknown++;
      continue;
    }
    const errs: number[] = [];
    let worst = { ts: 0, idx: 0, ref: 0, err: 0 };
    for (const pt of series) {
      const h = Math.floor(pt.timestamp / 3600);
      // Use the indexed price of that hour, else the latest earlier hour (a carried price is what the index serves).
      let ip: PricePoint | undefined;
      for (let k = h; k > h - 6 && !ip; k--) ip = m.get(k);
      if (!ip || !(ip.price > 0) || !(pt.price > 0)) continue;
      const e = Math.abs(ip.price / pt.price - 1);
      errs.push(e);
      if (e > worst.err)
        worst = { ts: pt.timestamp, idx: ip.price, ref: pt.price, err: e };
    }
    if (errs.length === 0) continue;
    compared++;
    const med = quantile(errs, 0.5);
    llama.compared++;
    llama.stats[`${symbol(t) || t}`] =
      `n=${errs.length} median=${(med * 100).toFixed(2)}% max=${(worst.err * 100).toFixed(1)}%`;
    if (med > 0.05) {
      llama.add(
        {
          key: `${symbol(t)} ${t}`,
          indexed: `median err ${(med * 100).toFixed(1)}%`,
          truth: `DefiLlama daily, n=${errs.length}`,
          detail: {
            worstDay: new Date(worst.ts * 1000).toISOString(),
            worstIndexed: worst.idx,
            worstRef: worst.ref,
          },
        },
        med,
      );
    }
  }
  ctx.results.push(
    llama.done(`${compared} tokens compared, ${unknown} unknown to DefiLlama`),
  );
}
