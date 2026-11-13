# ADR 0003: Derive token prices from indexed pool state

- **Status:** Accepted (2026-11-13); the rebind fallback is superseded by ADR 0004 (canonical sources compete on depth)

## Context

Token USD prices (`Token.pricePerUSDNew`) came from an on-chain price oracle:
one archive `eth_call` per token per hour through the `getTokenPrice` effect.
It was the indexer's largest source of bad data:

- On RPC failure the gateway returned `$0` as a fallback value. The production
  deployment has had every non-stable token at `$0` since 2026-11-03.
- Optimism WETH read `$0` from June 2023 to January 2024; Lisk WETH for its
  first four months.
- Bad reads are added into append-only USD counters, so `PriceOracle.ts` grew a
  spike guard (#668), a first-fetch cap (#728), an absolute ceiling (#788),
  pool-implied hints and re-anchoring (#784/#785), a 7-day carry rule
  (#694/#775) and a 128-entry blacklist.
- Two refresh paths bypassed the hourly throttle (whitelisted-never-priced,
  #862; the spike-rejection return, which did not advance the clock) and every
  refresh wrote a snapshot. Production holds 1.69M `TokenPriceSnapshot` rows
  for Lisk WETH over 15,230 hours.
- A full resync makes millions of archive calls.

The data needed for a better price is already indexed. On Base, the WETH/USDC
CL-100 pool's `sqrtPriceX96` gives a daily WETH price within ~0.5% of the
oracle's (2,351 vs 2,345; 2,228 vs 2,228) and kept working through the outage.
On Optimism, the V2 WETH/USDC reserve ratio gives sane WETH prices for every
month the oracle read zero.

## Decision

Price every token from indexed pool state, in the style of the Uniswap v4
indexer (`findNativePerToken`): through its deepest qualifying pool, with a
minimum-liquidity floor and a 1000× value-imbalance bound. No RPC is involved.
`Token.pricePerUSDNew` (1e18-scaled USD) and the hourly per-token refresh are
unchanged, so the rest of the indexer is unaffected.

- **Tiers** (`src/Pricing/PricingConfig.ts`): 0 = the chain's destination
  token and configured stablecoins, pinned at exactly `$1` (the pin moved out of
  the RPC gateway); 1 = the chain's WETH; 2 = the other configured price
  connectors and the chain's reward token(s); 3 = everything else. A token is
  priced only through a counterparty in a strictly lower tier, so the pricing
  graph is acyclic and a refresh recurses at most three levels.
- **Candidate pools** (`TokenPricingPools`, Postgres-only, `@internal`, never on
  `Token`): at V2 `PoolFactory` and CL `CLFactory` `PoolCreated`, the pool is
  appended to the higher-tier side's list. Only connector-side pools qualify,
  so lists stay small.
- **Selection** (`src/Pricing/PoolRoute.ts`, pure): candidate price = pool
  ratio × counterparty USD price; depth = counterparty reserve × counterparty
  price. Reject candidates with an unpriced counterparty, depth below the chain
  floor (`$5,000` on Optimism and Base, `$1,000` elsewhere), a token side worth
  more than 1000× the counterparty side, or a price above `$1M`. Take the
  deepest survivor.
- **Ratios** (`src/PoolPriceRatio.ts`): CL from `sqrtPriceX96`; V2 volatile from
  the reserve ratio; V2 stable from the marginal price of the `x³y + xy³` curve
  (`y(3x²+y²) / (x(x²+3y²))` on decimal-normalised reserves). The
  constant-product ratio previously used for stable pools is wrong for an
  imbalanced sAMM (it reads 2.0 where the pool trades at 1.08), so the V2 Sync
  writer uses the curve for `Pool.token0Price` / `token1Price` too. All ratios
  are kept as exact fractions until one trailing division; 0-decimal tokens are
  handled (`normalizeTokenAmountTo1e18` previously treated them as 18).
- **Freshness**: before a counterparty's price is used, the counterparty is
  itself refreshed if due. The tier rule bounds this.
- **Missing data** (`src/Pricing/PriceResolution.ts`): if nothing qualifies,
  copy the cross-chain rebind source's stored price when one is configured and
  was set within 7 days (a local route is preferred when one qualifies), else
  carry the last price. A price with no success for 7 days drops to 0.
  `lastUpdatedTimestamp` advances on every refresh, `lastSuccessfulPriceTimestamp`
  only on a successful one.
- **Throttle**: one refresh per token per clock hour, no bypasses. The
  snapshot id is keyed on the hour (`{chainId}-{address}-{epochMs}`), so "at
  most one snapshot per token per hour" holds structurally.
- **Provenance**: `TokenPriceSnapshot.priceSource` is one of `pinned`, `pool`,
  `rebind`, `override`, `carried`, `unpriced`; pool ticks also record
  `pricingPoolId` and `pricingDepthUSD`.

Removed as unnecessary without oracle reads: the upward spike guard, the
first-fetch cap, pool-implied hints and re-anchoring (`getPoolImpliedUSD`), the
cold-sync cross-chain oracle prefetch (`src/ChainBlockTime.ts`), oracle-type
handling, and the whitelisted-never-priced throttle bypass. Kept: the `$1M`
ceiling, the blacklist (applied before any route), rebinds (as a fallback), the
7-day rule, the trust gate (`src/PriceTrust.ts`, ADR 0002) and the #892 TVL cap.
The `getTokenPrice` effect stays exported for scripts; a test asserts nothing
in the handler pricing path references it.

### Alternatives rejected

- **Keep the oracle and harden the fallback.** Removes the `$0` symptom but
  keeps the archive-RPC cost and the per-read poisoning the guards exist for.
- **Price only through a single configured reference pool per chain** (as the
  v4 indexer does for the native token). Simpler, but one drained or migrated
  pool would stop every price on the chain; deepest-qualifying-pool degrades
  gracefully.
- **Exclude stable pools as a pricing source.** The correct marginal price is a
  few lines of exact integer math, and sAMM pools are the deepest venues for
  several pegged connectors.

## Consequences

- No RPC in the pricing path; a resync needs no archive node for prices.
- Prices exist from a token's first qualifying pool, not from an oracle deploy
  block or a working archive RPC, so the Optimism and Lisk WETH gaps should
  close (to be confirmed on the first full resync).
- Tokens with no connector-side pool above the floor are unpriced (they were
  often priced, sometimes badly, by the oracle). Tune the floors in
  `PricingConfig.ts`.
- Several blacklist entries were added only because the oracle froze on a
  wrong value while their pools priced them correctly (e.g. #786 PEPE /
  wOptiDoge, #901 DEUS); they now suppress correct pool prices and should be
  re-audited.
- Snapshot ids change format; rows written before this change keep the
  block-keyed ids and the oracle-era `fresh` / `pool-implied` tags.
- Requires a full resync (new entity, new snapshot fields).
