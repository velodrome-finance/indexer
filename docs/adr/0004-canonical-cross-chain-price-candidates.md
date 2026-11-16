# ADR 0004: Canonical cross-chain sources compete on depth

- **Status:** Superseded (2026-11-16) by ADR 0009 (per-chain entities): the live
  read of the source chain's `Token` is removed. Accepted 2026-11-13; amended
  ADR 0003's rebind fallback.

## Context

ADR 0003 priced every token from local pools and used a cross-chain "rebind"
(`src/PriceOverrides.ts`) only as a fallback when no local pool qualified. A
full Lisk sync on that design (10.5M events) compared Lisk WETH with
production's oracle prices hour by hour:

- Nov 2024–Feb 2025: the oracle had no price; the pool route priced every hour
  correctly.
- Mar 2025–Jan 2026: median error 0.1–0.8%, p95 about 1% (LSK, WBTC, wstETH,
  USD₮0 similar).
- From Feb 2026 Lisk liquidity dries up: median pricing depth falls to
  $1.2–1.5K, just above the $1,000 floor. The route flaps between `pool` and
  `carried`, median error rises to 2.7% (Feb) and 7.2% (June), and from August
  2026 nothing qualifies, so Lisk WETH reads $0. Metal (always thin) is 6–9% off
  at the median for USDC.e and MTL, and its WETH goes to $0 after April 2026.

For an asset that is the same token on every chain, a thin local pool that
scrapes over the floor should not beat the deep canonical market.

The fallback also accepted any source price whose last success was under 7 days
before the block, including prices from the future. Chains are not processed in
time order during a backfill, so the source chain can be months ahead.

## Decision

- **The canonical source is a candidate, not a fallback.** It enters the same
  "deepest qualifying candidate wins" selection as local pools. Its price is the
  source token's stored `pricePerUSDNew`, its depth the source token's stored
  `pricingDepthUSD`, and it must pass the same depth floor and `$1M` ceiling.
- **Depth is stored on `Token.pricingDepthUSD`**: the winning candidate's depth
  on `pool` / `canonical`, kept while carried, cleared when pinned, overridden
  or unpriced. A source with no recorded depth never clears the floor.
- **Time alignment:** the candidate qualifies only while the source's
  `lastSuccessfulPriceTimestamp` is within ±2 hours of the block being priced
  (`CANONICAL_ALIGNMENT_WINDOW_MS`). A source from the future is rejected like a
  stale one.
- **Equivalence list:** WETH on every leaf chain whose `weth` constant is ETH
  1:1 → Optimism WETH. That covers Lisk, Mode, Soneium, Unichain, Ink, Metal,
  Swell and Superseed (the OP-stack predeploy `0x4200…0006`) and Celo (native
  bridge WETH `0xD221…`). Left out: Base (a root deployment with its own deep
  market, and itself a source), Optimism (the source) and Fraxtal, whose `weth`
  is frxETH, a different liquid-staking asset. XVELO → Optimism VELO, rsETH →
  Base wrsETH, SolvBTC → Base SolvBTC and ezETH → Optimism ezETH are kept. No
  source or target is a pinned tier-0 token, and no source is itself a target.
- **Acyclic:** the source is read, never refreshed or routed, so the
  cross-chain read cannot recurse; the local tier rule is unchanged.
- **Provenance:** `priceSource = canonical` (replacing `rebind`), with
  `TokenPriceSnapshot.pricingSourceTokenId` naming the source token and
  `pricingDepthUSD` its depth.

The depth floors are unchanged.

## Consequences

- Leaf-chain WETH and XVELO follow the deep canonical market whenever the
  source chain is processed within two hours of the leaf chain, and fall back to
  local pools, then carry, when it is not.
- Which candidate wins depends on how far apart the chains are being processed,
  so a resync with a different chain interleaving can choose differently for
  the same hour (within the ±2 h band the two prices should agree closely).
- Tokens not on the equivalence list (USDC.e and MTL on Metal, for example)
  still depend on local depth.

## Amendment (2026-11-16): superseded by per-chain entities (ADR 0009)

With every entity per-chain a handler cannot read another chain's `Token`, so
the live canonical candidate is gone, and with it the `canonical` price source
and the `PRICING_CANONICAL_LIVE_READ` switch (ADR 0009 step 4). A leaf token
with a canonical source now resolves: local pools (deepest qualifying), then
the committed hourly seed of the source (`canonical-seed`, ADR 0008), then the
source's own hourly `TokenPriceSnapshot` read from this deployment's ClickHouse
by the `getCanonicalSourcePrice` effect (`canonical-snapshot`, ADR 0009 flow F),
then two-hop routes, then carry. The source never competes with local pools on
depth any more: it is a fallback, like the seed. The consequence above about
chain interleaving no longer applies to the live source; the effect's
remaining dependence on the source chain's progress is described in ADR 0009.
