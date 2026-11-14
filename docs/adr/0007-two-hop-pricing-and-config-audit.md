# ADR 0007: Two-hop pricing through a tier-3 peer; per-chain config audit

- **Status:** Accepted (2026-11-13). Amends ADR 0003 (tier rule) and ADR 0004
  (canonical sources' freshness). Includes the Base depth evaluation. The
  2026-11-13 "when every route fails" amendment (no-expiry carry for tiers
  1–2) is superseded by the 2026-11-14 amendment at the end.

## Context

Single-chain syncs compared hour by hour with production's oracle prices showed
pool-derived prices agreeing with the oracle to a median 0.05–0.4% where both
exist, but leaving tokens unpriced that the oracle priced:

- Tokens that trade only against other non-connector tokens (Mode WBTC, uniBTC
  and BMX; Fraxtal DKDEFI and dUSD) are unreachable under ADR 0003's static
  tier rule (a token is priced only through a strictly lower tier).
- Some chains' pinned set missed the chain's main stablecoin (Metal's bridged
  USDC.e), so nothing on the chain could be priced in a single-chain run.
- Anchor tokens (WETH, connectors, reward tokens, canonical sources) were
  refreshed only when an event happened to touch them, so a canonical source's
  `lastSuccessfulPriceTimestamp` could sit hours before the block another chain
  compared it against (ADR 0004's ±2 h window), and quiet hours had no anchor
  price at all.

## Decision

### One extra hop, still acyclic

A tier-3 token T that has **no** qualifying direct candidate (pool against a
lower tier, or canonical source) may be priced through a tier-3 peer C:

- **Registration.** A pool between two tier-3 tokens is appended to both
  tokens' `TokenPricingPools` lists (a *peer pool*). Direct and peer pools share
  the list; the refresh tells them apart by the counterparty's tier.
- **The peer must have a direct pool route, computed now.** C's price is the
  winner of C's own direct pool candidates (tiers 0–2 counterparties only),
  computed in T's refresh. C's stored price is never used, so a carried C, or a
  C that is itself priced through a peer, is never a hop: chains cannot form,
  and computing C's route never re-enters T or any other tier-3 token. C is not
  written by T's refresh; C refreshes itself as usual. A blacklisted C is
  skipped.
- **The weakest link governs.** The candidate's price is P2's ratio (T in C) ×
  C's direct price. Its depth is `min(depth of C's direct pool P1, C-side depth
  of the peer pool P2)`, and the depth floor, the 1000× imbalance bound (T's
  side of P2 against that minimum) and the deepest-wins comparison all use that
  minimum.
- **Direct routes first.** Two-hop candidates are considered only when no
  direct candidate qualifies, so every token priced today keeps its price.
- **Provenance.** Such a price has `priceSource = pool` and
  `TokenPriceSnapshot.pricingHops = 2`, `pricingPoolId` = P2,
  `pricingViaTokenId` = C, `pricingViaPoolId` = P1, `pricingDepthUSD` = the
  weakest link. Direct `pool` / `canonical` prices record `pricingHops = 1`.

The recursion is bounded: T → (peer C, direct only) → tiers 2 → 1 → 0.

### No time-driven anchor refresh (measured, rejected)

An `indexer.onBlock` handler that refreshed each chain's anchor tokens (WETH,
connectors, reward tokens, canonical sources on the chain) every ~hour of
blocks (`_every` 1,800 on 2 s chains, with `fields: { block: ["timestamp"] }`
for the refresh time) was built and measured on a Mode single-chain sync
against the identical commit without it. With the handler the sync took about
10 minutes to reach block 3.96M, the indexer's main thread was saturated
(112% CPU, 4.7 GB RSS, metrics server unresponsive) and only ~2,200 events had
been processed; without it the same sync passed block 7.45M within 40 s. The
early, event-sparse part of every chain is dominated by block-handler work,
so the cost is not proportional to the benefit, and the handler was removed.
Prices stay event-driven. A cheaper trigger (a block handler that needs no
block fields, or a refresh hooked onto a frequent event) is left for later.

### A token's price clock only advances with its own chain's time

`refreshTokenPrice` refuses (and logs) a call whose `chainId` differs from the
token's chain, so no handler can stamp a token with another chain's block time.

### Per-chain configuration audit

Every pool of every configured chain (16) was discovered over HyperSync
(legacy V2 / CL and Aero factories, lifetime swap counts on all but Optimism,
Base and four small leaf chains) and checked against the pinned set, WETH and
the connectors. Changes: Metal's bridged USDC.e is pinned and a connector (it
is Metal's most-traded stable; WETH / USDC.e alone has 57,852 swaps), Lisk's
USD₮0 (Stargate-bridged USDT0, 477K swaps) is pinned. Kept after checking:
Fraxtal's `0x1217…` OpenUSDT, which has traded within 0.11% of frxUSD over its
whole life. Unichain's USDT (`0x588C…`) and Celo's OpenUSDT are pinned but
have no pool yet. `test/Pricing/ChainPricingConfig.test.ts` fails when a chain
has no pinned stablecoin, when WETH has no pinned counterparty with real
volume, or when a pinned token has no pool and is not explicitly acknowledged,
against `test/Pricing/fixtures/chain_pairings.json`.

## Consequences

- Tokens whose only markets are against other non-connector tokens (Mode BMX
  through wMLT) are priced; most remaining gaps against the oracle are tokens
  whose markets never held the depth floor (Mode BEAST, WBTC, uniBTC; Fraxtal
  DKDEFI, dUSD), where the oracle priced from pools too thin to trust.
- Two oracle failures the old guards could not catch were traced to the same
  mechanism: the oracle's one-token quote through a drained pool returns at
  most that pool's counterparty reserve (Fraxtal FXB20291231 at 4.85e-16 USD,
  Mode STONE at about a third of ETH). The depth floor rejects such pools.
- A tier-2 connector cannot use a tier-3 peer (Fraxtal sfrxETH's deepest market
  is against ezETH), so such tokens stay unpriced while their lower-tier pools
  are thin.

## Amendment (2026-11-13): when every route fails

### Context

A ten-chain legacy sync (Optimism and Base left out) ended with WETH at $0 on
Unichain, Mode and Lisk. The snapshots show one mechanism on all three: the
last qualifying WETH pool's stablecoin side fell under the $1k floor
(Unichain USDC/WETH, $2.2k of USDC on 2026-10-17, $357 at the head, against
$30k of WETH; Mode and Lisk oUSDT/WETH, $1.0–1.4k on their last priced day),
the price was carried for seven days and then dropped to 0. The canonical
source (Optimism WETH) was not in the run. Unichain's USDC/WETH pool has
13.6M swaps, so most of the chain's pools lost one priced side.

Including the source chain would not have saved the history. Envio 3.16 does
not process chains in time order: it aligns their fetch frontiers by the
fraction of each chain's block range from its `start_block` to its head
(`CrossChainState.res`, a 20% margin past the furthest-behind chain).
Optimism and Base start in 2021 and 2023, the leaf chains years later, so at
any common fraction the source chain is months behind the leaf in time. A
source price is a candidate only within ±2 h of the leaf's block, and a
source that has not reached that hour has nothing to offer, so during a
backfill the canonical path serves only the hours near the head. At the head
all chains move together and it works.

### Decision

- **Tiers 1 and 2 carry without expiry** (`carriesWithoutExpiry`). With no
  qualifying route, the chain's WETH, price connectors and reward tokens keep
  their last price indefinitely as `carried`;
  `TokenPriceSnapshot.lastSuccessfulPriceTimestamp` (new) shows how old it is.
  Tier 3 keeps the seven-day rule; tier 0 is pinned.
- **Unpinned stablecoins pinned** where they trade at the peg in the pools'
  own history (1st–99th percentile of pool prices within 0.2–0.6% of $1):
  USD₮0 on Unichain, Soneium, Swell and Mode; Soneium's bridged USDT; Celo's
  USDm (Mento dollar). GHO on Ink and EUR or IDR stablecoins are not pinned.

### Alternatives considered

- **Any-chain canonical** (Ethereum and Arbitrum WETH as further sources).
  It would not fix the backfill: their Aero-only ranges start at the Aero
  launch (2026-10-21), so they could serve leaf hours only after that date,
  and only if their history were kept by hour (a source keeps only its latest
  price today). At the head the single Optimism source already works. Not
  adopted; an hourly source-price table plus several sources is the follow-up
  if leaf history after the Aero launch must be exact.
- **Unlimited carry for tier 1 only.** Tier 2 holds volatile connectors
  (MODE, LSK, CELO, VELO / XVELO) whose stale price can drift far over weeks,
  which argued for keeping their seven-day rule. Rejected: every tier-3 price
  on the chain is built on them, so a 0 there zeroes far more TVL than a stale
  price misstates, and the staleness is visible.

### Trade-offs

- *Staleness.* A carried price is off by the asset's move since the last
  success (Mode WETH: $1,923 carried from 2026-08-19; ETH-like assets move tens
  of percent over months, a connector alt can lose most of its value). The
  alternative, 0, removes half the TVL of each of their pairs and the USD of
  every token priced through them. Staleness is visible per row and per token.
- *Manipulation.* None added: a carried price is the last price that passed
  the floor, the 1000× bound and the ceiling; nothing new can set it.
- *Dead assets.* A connector whose markets die for good keeps its last price
  forever, so its pairs keep a TVL its market no longer supports. Removing it
  from `price_connectors.json` (it then becomes tier 3 and expires after
  seven days) is the operator's remedy.

### Measured

One sync of Optimism in its Aero era (Aero contracts only, from block
158,475,795) with Mode and Unichain from genesis, tier-1 carry in place:

- Unichain WETH: pool-priced to 2026-10-18 12:00, when an LP withdrew $1.65k
  of USDC from the USDC/WETH pool (USDC side $2,152 → $499); then `carried` at
  $2,414 for 26 days, never 0; `canonical` from Optimism WETH ($1,928, depth
  $78.6k) once the chains reached the head together.
- Mode WETH: `carried` at $1,923 from 2026-08-19 to the head, then
  `canonical` at $1,928.
- No `canonical` WETH row anywhere in the backfill, as the alignment argument
  predicts; Optimism ran up to weeks ahead of the leaf chains.
- Share of swaps in pools with both tokens priced at the head: Unichain 94.2%
  (5.6% without the carry and without the source), Mode 90.5% (19.1%).

The same alignment explains xAERO at 0 on the Aero leaf chains of an Aero-only
seven-chain sync: its source (Base AERO, mapped since ADR 0004) ran up to two
days ahead of the leaf chains, so the ±2 h window rejected it except for the
two hours Robinhood Chain happened to be aligned. It takes Base AERO's price
at the head; exact backfill prices need the hourly source table above.

## Base: depth measure and floor kept (2026-11-13)

An Aero-only Base sync (2026-10-21 to 10-30) left 59 tokens with oracle
prices never priced. Replaying price selection offline on that data (156
tokens with ≥24 matched reference hours) under alternative rules:

| rule | ≤1% | 1–5% | >5% | under half | never |
|---|---:|---:|---:|---:|---:|
| balance ≥ $5k (current) | 52 | 25 | 7 | 8 | 64 |
| current + two-hop | 53 | 25 | 7 | 9 | 62 |
| balance ≥ $2.5k | 55 | 30 | 8 | 8 | 55 |
| balance ≥ $1k + two-hop | 63 | 27 | 15 | 12 | 39 |
| CL in-range virtual ≥ $5k + two-hop | 63 | 33 | 16 | 13 | 31 |
| balance ≥ $5k, or ≥ $250 with ≥ $10k 24 h volume | 56 | 25 | 11 | 8 | 56 |

Kept: counterparty balance, $5k on Base. Reasons:

- *The gap is mostly the run's scope.* 71 of the 76 tokens the current rule
  leaves under half priced have legacy Aerodrome pools against a
  pinned / WETH / connector token, which an Aero-only run does not index;
  70 of them traded ≥100 times there in the window (PROS 222k swaps, CTR
  171k, VELVET 83k on legacy CL pools). A production sync sees those pools.
- *Virtual depth is not a cost.* In-range liquidity × price measures how much
  a tick-spacing-1 position quotes, not what it costs to move: LBTC's legacy
  pool shows $2.9B of virtual depth, ZARP $12.8M. A few hundred dollars in a
  one-tick range would clear any virtual floor.
- *Volume is cheap to fake:* washing $10k through a 0.01–0.3% pool costs $1–30.
- *Lower floors add error where it matters.* The 18 tokens a $1k floor adds
  are 15 trusted ones, 5 of them more than 5% from the oracle.
- *Much of the remaining ">5%" is the oracle's.* For PROS (22%), CHECK (49%),
  ALIGN (41%), FOLKS (29%), ELSA (22%), PORTAL (15%) and cbMEGA (15%) the
  busiest legacy market and the Aero pool agree with each other and not with
  the oracle. GOOGL, AAPL and TSLAc ($281–410 here) trade at those prices in
  Aero USDC pools holding $170–500k of USDC (≈36k swaps for GOOGL alone),
  with WETH pools agreeing; the oracle's $0.13–0.23 is wrong.

## Amendment (2026-11-14): 7-day carry for every tier; a route is only as fresh as its base

Supersedes the 2026-11-13 decision that tiers 1–2 carry without expiry.

### Context

The twelve-chain sync at f7c17d0 showed the cost of an unbounded carry.

- Fraxtal sfrxETH (tier 2) was `carried` at $2,992.7 for up to 170 days
  (2025-05-30 to 2025-11-09) while ETH went to about $4,800.
- frxETH (Fraxtal's tier 1) was carried for up to 44 days, through to the head.
- wstETH and ezETH kept being priced `pool` through the stale sfrxETH: wstETH
  $3,202 against DefiLlama's $5,825 on 2025-08-22.
- The harness failed `price.vs-defillama` for wstETH (median error 12.7%),
  ezETH (7.0%) and sfrxETH (6.1%), and `price.vs-prod-oracle` for ezETH.

A wrong price is worse than a missing one: it is added into cumulative USD
counters.

The case the no-expiry carry was added for, drained leaf-chain WETH, is now
covered by the canonical seed (ADR 0008). Every tier-1 or tier-2 token
carried beyond 7 days in that sync was one of these:

| chain | token | carried > 7 days | longest |
|---|---|---:|---:|
| Fraxtal | sfrxETH | 3,892 h | 170 days |
| Fraxtal | frxETH | 1,019 h | 44 days |
| Mode | MODE | 609 h | 65 days |
| Metal | MTL | 109 h | 99 days |
| Fraxtal | sUSDe | 78 h | 33 days |
| Lisk | LSK | 36 h | 13 days |
| Soneium, Fraxtal, Mode, Celo, Unichain | XVELO | 149 h in all | 10–15 days |

None of them is a leaf WETH that the seed covers. The XVELO rows fall after
the VELO seed's last hour (2026-11-03): rebuild the seed before a resync and
they go away. For every other row in the table, carrying was the wrong
answer.

### Decision

- **The 7-day carry applies to every tier again** (`PRICE_CARRY_WINDOW_MS`;
  `carriesWithoutExpiry` is removed). `TokenPriceSnapshot.lastSuccessfulPriceTimestamp`
  stays and dates every carried row.
- **A pool route is only as fresh as its base.** A pool candidate counts
  only when its counterparty is pinned, or last succeeded at most
  `COUNTERPARTY_FRESHNESS_MS` = 2 h before the block (`isCounterpartyPriceFresh`).
  This covers direct routes and the first hop of two-hop routes, since the
  peer's direct price is built from the same candidates. A counterparty that
  is only carrying is no base: the token carries its own last price instead,
  and expires after 7 days like any other.

### Why 2 hours

- A healthy counterparty is refreshed right before it is used whenever it is
  due, so its last success is inside the current clock hour.
- A quiet market is not a stale one. The refresh re-prices the counterparty
  from stored pool state whatever the event traffic.
- Only a counterparty whose own routes fail ages past an hour. The second
  hour absorbs a one-hour gap, the same slack as the canonical window.

Measured on the twelve-chain sync before choosing (pool-priced rows whose
counterparty's last success was older than N at that hour):

| chain | pool rows | > 1 h | > 2 h | > 6 h | > 24 h | > 7 d |
|---|---:|---:|---:|---:|---:|---:|
| Fraxtal | 94,033 | 11,212 | 10,992 | 10,472 | 9,267 | 5,895 |
| Mode, Metal, Swell | 141,284 | 12 | 2 | 0 | 0 | 0 |
| the other eight chains | 348,756 | 0 | 0 | 0 | 0 | 0 |

The choice of N only matters on Fraxtal, and there almost all affected rows
are more than a day stale, so 2 h, 6 h or 24 h differ by a few percent.

### Measured (Fraxtal, one sync at 7bd82b5)

Harness price checks (`--only price`) all pass: `price.coverage`,
`price.vs-prod-oracle` and `price.vs-defillama`. Before, at f7c17d0,
`price.vs-defillama` and `price.vs-prod-oracle` failed.

| token | DefiLlama median error, before → after | oracle median error, before → after |
|---|---|---|
| wstETH | 12.7% (n=193) → 2.9% (n=54) | n/a |
| ezETH | 7.0% (n=298) → 1.2% (n=144) | 5.5% → 1.15% |
| sfrxETH | 6.1% (n=328) → 1.0% (n=161) | 1.09% → 0.13% |
| frxETH | 0.96% → 0.96% | 0.06% → 0.05% |

Hours by source, before (f7c17d0) → after:

| token | pool | carried | of which > 7 days | unpriced |
|---|---|---|---|---|
| wstETH | 2,220 → 441 | 354 → 528 | 0 → 0 | 2,566 → 4,171 |
| ezETH | 4,918 → 1,169 | 1,990 → 2,512 | 0 → 0 | 5,653 → 8,880 |
| sfrxETH | 8,606 → 5,891 | 4,371 → 2,462 | 3,892 → 0 | 3,363 → 8,198 |
| frxETH | 14,103 → 14,103 | 3,183 → 2,164 | 1,019 → 0 | 35 → 1,056 |
| WFRAX | 8,044 → 7,367 | 2,631 → 2,882 | 0 → 0 | 5,729 → 6,157 |
| XVELO | 4,580 → 4,178 (+11,168 → 11,734 seed) | 140 → 140 | 49 → 0 | 0 → 75 |

- Token-hours with activity that have a price fell from 83.0% to 77.3%. The
  hours lost are the wrong prices.
- Swaps in pools with both tokens priced at the head fell from 79.2% to 13.2%.
  frxETH's last qualifying market drained on 2026-10-01: frxUSD/frxETH, the
  pool with 1.09M swaps, holds $35 of frxUSD at the head. The 79.2% counted
  frxETH at a 44-day-old price.

### Follow-up, not done

frxETH has traded within about 1% of ETH for two years: the quarterly median
of its pool price against Optimism WETH ranges from −0.02% to −1.04%, and the
5th percentile is never below −1.9%. Mapping Fraxtal frxETH to Optimism WETH
in `CANONICAL_SOURCES` would let the seed and the live source cover the
drained hours. It would restore most of the 79% at about 1% error. It was
left out in ADR 0004 because frxETH is not redeemable 1:1 on demand; that
remains a decision to take on its own.

## Amendment (2026-11-14): connectors may use a connector peer

An Optimism-only sync showed WBTC unpriced from June to November 2023 and
again in February and March 2024. Its only deep market then was the stable
WBTC / tBTC pool (about 18 WBTC and 17 tBTC); its WETH pool held a few hundred
dollars. Both tokens are price connectors (tier 2), and the tier rule lets a
token price only through a strictly lower tier, so the pool was never a
candidate.

The two-hop rule now covers tier 2 as well as tier 3: a pool between two
connectors is registered for both as a peer pool, and a connector with no
qualifying direct candidate may be priced through a connector peer whose own
price comes, in the same refresh, from a direct route through tiers 0 and 1.
Everything else is unchanged: the peer's stored, carried or two-hop price is
never used, the weaker hop sets the depth, and direct routes win. The
construction stays acyclic for the same reason as in tier 3.

