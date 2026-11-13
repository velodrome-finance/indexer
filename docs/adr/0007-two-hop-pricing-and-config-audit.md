# ADR 0007: Two-hop pricing through a tier-3 peer; per-chain config audit

- **Status:** Accepted (2026-11-13). Amends ADR 0003 (tier rule) and ADR 0004
  (canonical sources' freshness).

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
