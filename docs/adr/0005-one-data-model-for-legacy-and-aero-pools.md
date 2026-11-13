# ADR 0005: One data model for legacy and Aero pools

- **Status:** Accepted (2026-11-13). Phase 1 of 3 of the Aero integration
  (pools, swaps, liquidity, positions, prices). Gauges and emissions (phase 2)
  and governance (phase 3) are in ADR 0006, which sets `gaugeAddress`,
  `gaugeIsAlive`, the staking fields and `unstakedFee` on AERO pools.

## Context

Aerodrome and Velodrome merged into **Aero** on 2026-10-21/22. The new contract
system ("MetaDEX"; its CL part is Slipstream V3) is deployed on Base,
Optimism, Ethereum, Arbitrum, Ink, Robinhood Chain (4663) and Arc (5042). Arc
also has an earlier "lite launch" (metadex 1.0.0 / slipstream 1.0.1, its own
factories, NFPM and hook), deployed before the full launch, which holds 35 of
Arc's 43 CL pools. The legacy
Velodrome/Aerodrome gauges were killed, but legacy pools keep trading, and
liquidity is moving: in one sampled window the Aero CL pools on Base did 54,397
swaps against 21,493 on the legacy CL pools.

The protocol team wants one indexer and one database for everything, legacy and
Aero, queryable together.

What the Aero contracts change for this indexer:

- The CL factory and every CL pool event are signature-identical to legacy
  Slipstream. The swap fee comes from a `DynamicSwapFeeHook` instead of the
  legacy fee modules. Positions use a new NonfungiblePositionManager whose
  `IncreaseLiquidity` also carries the position's tick range.
- V2 pools come from two factories (stable, volatile) whose `PoolCreated` has
  no `stable` flag. Pool `Swap` / `Sync` / `Fees` / `Burn` are unchanged,
  `Mint` is the 4-argument form, `Claim` names the account whose fees are
  claimed.
- There are no Optimism root pools: Aero emissions are allocated across chains
  by the root Voter on Base, not by matching leaf pools to root pools.

## Decision

### Reuse the existing entities; tell deployments apart with `Pool.deployment`

Aero pools are `Pool` rows, their positions `NonFungiblePosition` rows, their
users `UserStatsPerPool` rows and their tokens `Token` rows, with the same ids,
scales and semantics as legacy rows. A consumer sums or ranks across both
without knowing which is which.

`Pool.deployment` (`String!`, indexed) says which deployment created the pool,
and is copied onto `PoolSnapshot.deployment`:

| value | pools |
| --- | --- |
| `VELODROME` | Velodrome V2 / Slipstream on Optimism and the superchain leaves |
| `AERODROME` | Aerodrome V2 / Slipstream on Base |
| `AERO` | the Aero (MetaDEX) deployment on every chain, Arc's lite launch included |

It is set once, at `PoolCreated`, from the **config contract** that emitted
it: the legacy `CLFactory` / `PoolFactory` give `AERODROME` on Base and
`VELODROME` elsewhere; the new `AeroCLFactory`, `AeroStablePoolFactory` and
`AeroVolatilePoolFactory` contracts give `AERO`. Nothing depends on a list of
factory addresses being complete.

Three values rather than legacy/new because those are the three deployments a
pool can belong to, and "Aerodrome vs Velodrome" is how the team talks about
legacy pools. `deployment IN (VELODROME, AERODROME)` is "legacy". It is a
String, not a GraphQL enum, like the indexer's other value sets
(`priceSource`, `priceTrustOutcome`), pinned by `POOL_DEPLOYMENT` in
`src/Constants.ts`.

Rejected:

- **Separate `AeroPool` / `AeroPosition` entities.** Every consumer query and
  every aggregate (TVL per chain, a wallet's positions) would have to union two
  types, and the pricing, snapshot and user-stats code would fork.
- **Inferring the deployment from `factoryAddress`.** Works, but every consumer
  would need the factory list, and it grows with every deployment.

### Fields that do not apply to Aero pools stay at their creation defaults

No existing field gets a second meaning. On an `AERO` pool:

- `rootPoolMatchingHash` is **null** (the field became nullable). Aero has no
  root pools, and a null hash cannot match a `RootPoolCreated`.
- Legacy-gauge and vote fields (`gaugeAddress`, `gaugeIsAlive`,
  `totalEmissions*`, `totalVotesDeposited*`, voting-reward fields,
  `veNFTamountStaked`) stay at their creation defaults until Aero gauges are
  indexed (phase 2). `gaugeEmissionsCap` is null and `minStakeTime` 0: those
  were seeded from the legacy `CLGaugeConfig`, which is not passed for Aero
  pools.
- `unstakedFee` is null (Aero's CustomUnstakedFeeModule is not indexed yet).
- `baseFee` / `currentFee` / `feeCap` / `scalingFactor` keep their meaning
  (ADR 0001); for Aero CL pools they come from the `DynamicSwapFeeHook`, for
  Aero V2 pools from the factories' `SetDefaultFee` and the V2 CustomFeeModules.
  As on legacy V2 pools, a V2 swap's fee is valued from the pool's `Fees`
  event and `currentFee` is the swap's effective rate (ADR 0001, 2026-11-13
  amendment).

Each of these is noted on the field in `schema.graphql`.

### Keep Aero pools out of the legacy root/leaf machinery

An Aero CL pool on Optimism or Ink can share (chain, token0, token1,
tickSpacing) with a legacy leaf pool. The Aero handlers therefore skip
`flushPendingRootPoolMappingAndVotes` (and its `getWhere`) and the V2 leaf
`getRootPoolAddress` RPC, and the null `rootPoolMatchingHash` keeps them out of
`RootPoolCreated` matching (which also filters on the leaf factory already).

### Tick-spacing fees are per factory

`FeeToTickSpacingMapping` is keyed `{chainId}-{factoryAddress}-{tickSpacing}`
(new `factoryAddress` field). Chains have several CL factories, and their fees
for one tick spacing differ: on Arc, tick spacing 50 is 0.05% on the lite
launch and 0.30% on the Aero CLFactory. The previous `{chainId}-{tickSpacing}`
id let the last factory to enable a spacing set the default fee of every pool
on the chain.

### Aero positions are created from the NFPM's own events

The Aero NFPM's `IncreaseLiquidity(tokenId, liquidity, amount0, amount1,
tickLower, tickUpper)` gives the range, but no NFPM event names the pool. The
pool comes from the `CLPool.Mint` the NFPM caused, found by primary key on
every value both events carry (`AeroNFPMMintPool`, keyed by tx, NFPM, range,
liquidity and amounts). The mint `Transfer` parks the recipient
(`AeroNFPMPendingMint`) until that `IncreaseLiquidity` creates the position.
This replaces the legacy "closest preceding Mint in the tx" guess and needs no
registry list and no scan; it also handles an increase (no Transfer) and two
mints in one tx.

`NFPM.Collect` is indexed for the Aero NFPM: the principal from
`DecreaseLiquidity` is tracked per position (`NFPMPositionPendingPrincipal`),
and the rest of each Collect is credited as fees to the position's owner. On
Aero pools `CLPool.Collect` therefore no longer creates a `UserStatsPerPool` row
for the NFPM contract; on legacy pools it still does (legacy NFPMs' Collect is
not indexed).

All three entities are handler scratch state: Postgres-only and `@internal`.

### The Aero token list is a price-trust signal

USD aggregates only count tokens that pass the price-trust gate (ADR 0002):
legacy-whitelisted or a configured connector. The Aero-only chains have no
legacy whitelist, and on Base the legacy Voter un-whitelisted 466 tokens at the
merge (`WhitelistToken(false)` on 2026-10-21), so without a new signal every
non-connector leg of an Aero pool (a Robinhood stock token, EURC on Arc) would
count `$0` towards TVL.

Aero keeps its curated list in a `TokenRegistry` on every chain
(`0x5646…63E1`; on 2026-11-13: 234 listed tokens on Base, 55 on Ethereum, 53
on Robinhood, 42 on Arbitrum, 28 on Optimism, 11 on Ink, 7 on Arc). Its
`ListingSet(token, listed)` is indexed into a new `Token.isListedOnAero`, and
the gate trusts a token that is whitelisted **or** listed **or** a connector
(new reason `LISTED`, between `WL` and `CONNECTOR`). `isWhitelisted` keeps its
legacy meaning; the two signals never overwrite each other. The registry's
other events (tiers, canonical references, registration requests) are not
indexed; `CanonicalSet` could later feed ADR 0004's canonical sources.

### Reward tokens: legacy and Aero side by side

`CHAIN_CONSTANTS` now separates `legacy` (reward token, LpHelper, on-chain
oracle) from `aero` (`rewardToken`, `startBlock`); Aero-only chains have no
`legacy` block, so no fake oracle values exist.

On Base both AERO tokens coexist: the legacy reward token stays AERO v1
(`0x9401…8631`) for every block, because the legacy Voter and gauges only ever
paid AERO v1 (residual legacy claims after the merge still do), and the Aero
reward token is AERO (`0x3f5b…a4Ee`). A block switch would mislabel legacy
claims. Both are tier-2 price connectors. They are not linked as canonical
equivalents: the v1→Aero conversion is a one-way migration contract with its
own opening schedule, so each AERO prices from its own pools.

On the leaf chains the Aero reward token is the chain's xAERO receipt token
(redeemable 1:1 for AERO on Base), a tier-2 connector whose canonical source
is Base AERO (ADR 0004).

## Consequences

- One query covers legacy and Aero pools; `deployment` splits them.
- Requires a full resync: new fields (`Pool.deployment`,
  `PoolSnapshot.deployment`, `FeeToTickSpacingMapping.factoryAddress`), new
  `FeeToTickSpacingMapping` ids and new entities.
- Aero pools have no gauge data until phase 2. Until then a position staked in
  an Aero gauge is owned by the gauge (the gauge transfer looks like any other
  transfer). Phase 2 sets `Pool.gaugeAddress` for Aero pools, after which the
  existing stake/unstake path keeps the real owner.
- Phase 2 must decide where Aero emissions go: `totalEmissions` is documented
  as single-reward-token per chain, and Ink would then mix XVELO (legacy) and
  xAERO (Aero).
