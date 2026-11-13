# ADR 0006: Two-hop pricing through a tier-3 peer, and an hourly anchor refresh

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

### An hourly, time-driven refresh of anchor tokens

`src/handlers/PriceAnchorRefresh.ts` (`indexer.onBlock`) refreshes, every
`getAnchorRefreshBlockInterval(chainId)` blocks, each chain's anchor tokens:
WETH, connectors, reward tokens and the canonical sources that live on the
chain (pinned tokens excluded). The interval is about one hour of blocks at the
chain's fastest block time (1,800 on 2 s chains, Base included; 3,600 on 1 s
chains; 300 on Ethereum; 14,400 on Arbitrum / Robinhood; 7,200 on Arc). The
refresh keeps its once-per-clock-hour throttle, so extra calls are no-ops.

### A token's price clock only advances with its own chain's time

`refreshTokenPrice` refuses (and logs) a call whose `chainId` differs from the
token's chain, so no handler can stamp a token with another chain's block time.

## Consequences

- See the round-3 report for the coverage table per chain.
