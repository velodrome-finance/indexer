# ADR 0008: Committed hourly seed for canonical sources

- **Status:** Accepted (2026-11-14). Extends ADR 0004 (canonical cross-chain
  candidates) and ADR 0007 (when every route fails).

## Context

A canonical source (ADR 0004: Optimism WETH for leaf WETH, Optimism VELO for
XVELO, Base AERO for xAERO, …) is a candidate only while its last success is
within ±2 h of the block being priced. Envio 3.16 aligns chains by the
fraction of each chain's block range, not by time (ADR 0007), so during a
backfill the source chain is almost never inside that window. Leaf reward
tokens were therefore unpriced or stale through the backfilled history: in a
ten-chain sync XVELO was unpriced in 9,469 of 15,194 Fraxtal snapshots and in
all of Celo's, and xAERO was 0 on every Aero leaf chain. Emissions are stored
in USD at the event's price, so the history would stay understated after a
full resync. Query-time repair is not enough; stored prices must be right.

## Decision

- **A committed seed.** `src/constants/canonical_price_seed.json` holds, per
  canonical source token, an hourly price series: `startHour`, a per-source
  `scale` and one comma-separated string of integer prices in units of
  10^-scale USD (empty field = no price that hour). It is imported with the
  module and decoded once, on first use, into arrays of 1e18 prices; a lookup
  is one array index per (source, hour). No RPC, no store reads.
- **Fallback only.** In `resolveTokenPrice`, after the local candidates and
  the live canonical candidate: if nothing qualified and the token has a
  canonical source whose live price is outside the ±2 h window (or missing or
  unpriced), the seed's price of that source for the block's clock hour is
  used, falling back at most two hours to the past when that hour has no
  price, never forward. Then two-hop (tier 3), then carry. A qualifying local
  pool and a live canonical source inside the window always win.
- **Provenance.** `priceSource = canonical-seed`, `pricingSourceTokenId` =
  the source, new `TokenPriceSnapshot.pricingSeedHour` = the hour used,
  `pricingDepthUSD` unset (the seed has no depth). The price counts as a
  success (`lastSuccessfulPriceTimestamp` advances).
- **Outside the seed's range** (before its first hour, or more than two hours
  after its last) nothing changes.
- **Refresh.** `scripts/build-canonical-price-seed.ts` rebuilds the file from
  TSV files and/or a deployment's ClickHouse `TokenPriceSnapshot` history (per
  clock hour, the last `pool`-sourced price of each source token, so the seed
  never feeds on carried, canonical or seeded rows), connecting with the
  `ENVIO_CLICKHOUSE_*` variables. Run it before each resync.

### Why a fallback and not a candidate competing on depth

The seed has no depth to compete with: it is a price, not a market the block
saw. Giving it a nominal depth would let a constant decide against real local
books. As a fallback it changes nothing where the indexer already had a
qualifying route, so every price that existed before keeps its value. The
cost is an inconsistency with the head, where the live source competes on
depth and can beat a thin but qualifying local pool: in a backfill the thin
pool wins instead. Local pools that clear the floor track the canonical
market closely (Metal WETH: median 0.36% from Optimism's oracle, p95 1.9%),
so the difference is small.

## The first seed

| source | hours | provenance |
|---|---|---|
| Optimism WETH | 2024-10-01 00:00 – 2026-11-03 11:00 UTC, 18,320 of 18,324 | production oracle; one missing hour filled from the Aero-only sync |
| Optimism VELO | 2024-10-01 00:00 – 2026-11-03 10:00 UTC, 18,299 of 18,323 | production oracle |
| Base AERO (`0x3f5b…`) | 2026-10-22 01:00 – 2026-11-04 23:00 UTC, 335 of 335 | pool-derived (`priceSource = pool`) from the Aero-only seven-chain sync, which had reached 2026-11-04 on Base |

- No series has a hole longer than two hours (a test checks this).
- The file is 391 KB.
- VELO has two hour-to-hour moves above 30%: +146% at 2024-12-13 09:00 and
  −44% at 2025-10-10 21:00. Both are real. Leaf XVELO pools on Fraxtal, Mode
  and Lisk show the same jump within the hour (0.149 → 0.355 on 2024-12-13;
  0.041 → 0.027 on 2025-10-10, the market-wide liquidation that evening), and
  both levels persisted.
- Optimism WETH after 2026-11-03 is not in the seed: the Aero-only sync had
  reached only 2026-10-29 on Optimism.
- Left out: Optimism ezETH, the source for Swell and Ink ezETH. Neither the
  oracle export nor the Aero-only sync has a series for it. Base wrsETH
  (Swell rsETH) and Base SolvBTC (Ink SolvBTC) are left out for the same
  reason. Their targets behave exactly as before.

## Measured (Metal, chain 1750, one sync)

Before: the ten-chain legacy sync at the earlier tip, without the USDC.e pin,
tier-1/2 carry or seed. After: this change. The hourly share is over the
hours from the token's first snapshot to the head.

| token | hours priced before | hours priced after | after, by source |
|---|---:|---:|---|
| WETH | 34.4% | 100% | 11,506 pool, 65 canonical-seed, 7 carried |
| XVELO | 7.2% | 100% | 1,632 pool, 2,179 canonical-seed |
| MTL (through WETH) | 37.0% | 99.4% | 6,218 pool, 125 carried, 40 unpriced |

- Against Optimism's oracle series, the `pool` rows are an independent check:
  Metal WETH median 0.36%, p95 1.9%; XVELO median 1.1%, p95 5.4%. The
  `canonical-seed` rows match that series exactly, which is circular.
- The oracle reference for Metal has no WETH or XVELO rows. MTL against the
  oracle: 99.4% of its hours priced at a median 8.5% (before: 60% at 9.4%);
  that gap comes from its WETH and USDC.e pools, not from the seed.
- Swaps in pools with both tokens priced at the head: 100% (before: 0%).

Most of the WETH gain comes from the USDC.e pin and the tier-1 carry
(ADR 0007). XVELO's gain is mostly the seed.

## Consequences

- Leaf WETH, XVELO and xAERO now get the right hourly price throughout a
  backfill wherever the seed covers the hour, so stored emissions and TVL
  history are valued correctly.
- Prices in the seed's range depend on the committed file. Rebuild it before
  each resync, or the most recent hours fall back to carry.
- A future canonical source needs a seed series before it helps backfills.
  Without one it behaves as before.
