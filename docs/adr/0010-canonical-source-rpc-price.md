# ADR 0010: Canonical source price over RPC for the backfill window

- **Status:** Accepted (2026-11-17). Extends ADR 0008 (canonical price seed)
  and ADR 0009 flow F (canonical snapshot effect). Narrows the "no RPC" rule
  of ADR 0003 by one cached, low-volume read.

## Context

A leaf token with a canonical source (WETH on a leaf chain → Optimism WETH,
XVELO → Optimism VELO, xAERO → Base AERO) and no qualifying local pool is
priced from the committed seed (ADR 0008) and, past the seed's end, from the
source chain's own `TokenPriceSnapshot` in ClickHouse (ADR 0009).

Per-chain mode runs every chain independently. In a full backfill the small
chains reach the head hours or days before Optimism and Base do. For every
hour after the seed's last hour and before the source chain has indexed it,
neither answer exists, so the leaf token carries its last price. Those rows
are history and are not rewritten when the source catches up. Measured in the
seven-chain Aero run of 2026-11-17: xAERO on the leaf chains carried $0.4706
for up to 80 hours while AERO fell to $0.4359, and on Fraxtal (XVELO seed
ending 2026-11-03) only 57.7% of swaps were in fully priced pools.

Rebuilding the seed right before a sync shortens the window but cannot close
it: the sync itself takes days, and the seed ends when it was built. Starting
the source chains first and adding the others later was rejected as an
operating procedure.

## Decision

- **A third fallback, after the seed and the snapshot.** In
  `resolveTokenPrice`, when no local pool qualifies, the seed has no hour and
  the snapshot effect has no answer, the `getCanonicalSourceRpcPrice` effect
  (`src/Effects/CanonicalSourceRpcPrice.ts`) reads the source's price from the
  source chain over RPC. Then two-hop, then carry, as before.
- **What is read.** `CANONICAL_SOURCE_POOLS` (`src/PriceOverrides.ts`) lists,
  per source, its pools against a pinned stablecoin: Optimism WETH (two CL
  USDC/WETH pools), Optimism VELO (the V2 USDC/VELO pool), Base AERO (the V2
  AERO/USDC pool). A CL pool is read with `slot0` and the two token balances,
  a V2 pool with `getReserves`. Each pool offers pool ratio × $1 at the
  stablecoin side's depth, and the deepest one that passes the source chain's
  own rules (depth floor, 1000× imbalance bound, $1M ceiling) sets the price:
  the same selection the source chain applies to its local pools.
- **At which block.** The last block at or before 600 seconds before the start
  of the asking block's clock hour. The asking block is inside that hour, so
  the block read is at least ten minutes old on the wall clock and is final in
  every way the indexer can run (envio's reorg window is 200 blocks: 400 s on
  Optimism, 40 s on Base). It is found from the timestamp by interpolation
  (`src/Effects/BlockAtTimestamp.ts`): one `eth_getBlockByNumber` per hour
  once the chain's block time is known.
- **Cache key = (source, hour).** The input carries nothing about who asks, so
  one read serves every leaf chain, token and worker. The effect is
  `cache: true, crossChain: true`: envio stores each answer in Postgres
  (`envio_effect_getCanonicalSourceRpcPrice`) and never asks again, across
  restarts. Both a price and a settled "no pool qualifies at that block" are
  facts about a final block and are cached.
- **Nothing is cached without an answer.** On an RPC failure (after the
  gateway's retries and the fallback endpoint) or when the source head has not
  reached the hour, the effect throws. Envio then stores nothing, the token
  carries, and the next hour's refresh asks again. After a failure the effect
  skips RPC for 60 seconds.
- **Provenance.** `priceSource = canonical-rpc`, `pricingSourceTokenId` = the
  source, `pricingPoolId` = the source chain's pool, `pricingDepthUSD` = that
  pool's stablecoin-side depth, `pricingSeedHour` = the timestamp of the block
  read. The price counts as a success.
- **Switch.** `PRICING_CANONICAL_RPC_EFFECT` (default on; off under a test
  runner).

### Order: why RPC comes last

The seed and the snapshot cost no RPC and are what a later resync will see
for the same hours, so they come first. RPC is asked only when both are
empty. Sources without a configured pool (wrsETH and SolvBTC on Base, ezETH)
get no RPC price and still carry in the window; they price few pools.

### RPC volume

Per source and hour: one block lookup (none when another source on the same
chain already found that hour's block) and one batched request of 1 to 6
`eth_call`s. For the three sources that is about 10 calls per hour of the
window, whatever the number of leaf chains: about 1,200 calls for a five-day
window. Up to four worker processes may each read an hour once before the
first answer is stored.

### Keeping the reads for later syncs

1. The Postgres effect cache holds them for as long as the database lives.
2. `.envio/cache/getCanonicalSourceRpcPrice.tsv` is the effect's seed file: a
   dump of that table, committed like the token metadata cache, is loaded into
   a fresh database, so a resync does not repeat the reads.
3. Rebuilding the canonical price seed from a synced source
   (`scripts/build-canonical-price-seed.ts`) turns the same hours into
   `canonical-seed` hours, which are never asked over RPC at all.

## Checked against the chain (2026-11-17)

`scripts/check-canonical-rpc-price.ts` verifies the configured pools
(`token0`, `token1`, decimals) on chain and compares the effect's prices with
the source chain's own indexed price of the same hour. 120 hours ending
2026-11-16 05:00 UTC, three sources, 360 source-hours, all priced, no retry:

| Source | Median difference | 95th percentile | Largest |
| --- | --- | --- | --- |
| Optimism WETH | 0.12% | 0.47% | 2.14% |
| Optimism VELO | 0.00% | 0.51% | 2.95% |
| Base AERO | 0.10% | 0.60% | 3.13% |

The reference is the source's price at its first event of the hour and the
RPC read is ten minutes before the hour, so the difference is the price's
movement over at least ten minutes; the largest ones are hours in which the
price moved by that much. The RPC price is on average about three times
closer to the source's price of the hour than the previous hour's snapshot
is (mean difference 0.08–0.19% against 0.21–0.78%). The run made 364 block requests and 480 pool reads in 43 seconds.

## Consequences

- Handlers now make RPC calls for prices in one case. The volume is bounded
  by the number of hours in the window, not by events, pools or chains.
- A `canonical-rpc` price is the source pool's spot price at one block, as a
  `pool` price is. It has no time weighting.
- Adding a canonical source that should be covered means adding its pools to
  `CANONICAL_SOURCE_POOLS` (`test/PriceOverrides.test.ts` checks the shape;
  the check script checks the chain).
