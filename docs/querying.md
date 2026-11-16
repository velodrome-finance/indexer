# Querying the indexer: a consumer's guide

A practical guide to querying the indexer and interpreting its output, written
for consumers who have not worked with it before. It covers the GraphQL API, the
value-scaling rules that must be applied to every numeric field, example queries
for common questions, and the data caveats that most affect interpretation. For
the architecture and build instructions, see [`README.md`](../README.md). For
the exhaustive field-by-field reference, see [`docs/schema.md`](schema.md).

## What the indexer provides

The indexer ingests on-chain events for Velodrome V2 (Optimism) and Aerodrome
(Base), together with their superchain deployments, and for Aero (MetaDEX), the
merged deployment launched on 2026-10-21 (Base, Optimism, Ethereum, Arbitrum,
Ink, Robinhood Chain, Arc), and serves the derived state as a GraphQL API over
Postgres. Consumers do not work with raw logs. They query clean, aggregated
entities such as a pool's TVL, volume, and fees, or a wallet's position in a
pool.

Legacy and Aero pools are the same entities (`Pool`, `NonFungiblePosition`,
`UserStatsPerPool`, snapshots), so one query covers both. To tell them apart,
filter on `Pool.deployment` (also on `PoolSnapshot`): `VELODROME`, `AERODROME`
or `AERO`. For example, Aero pools on Base by volume:

```graphql
query {
  Pool(
    where: { chainId: { _eq: 8453 }, deployment: { _eq: "AERO" } }
    order_by: { totalVolumeUSD: desc }
    limit: 10
  ) { name isCL totalVolumeUSD totalLiquidityUSD }
}
```

For Aero pools, swaps, liquidity, positions, prices and gauge staking
(`gaugeAddress`, `gaugeIsAlive`, `currentLiquidityStaked*`, staked positions)
are in the shared entities. Aero emissions, allocations and governance have
their own `Aero*` / `SAero*` entities because their semantics differ; the
legacy emission and vote fields keep their defaults on AERO pools. See
[Aero gauges, emissions and governance](#aero-gauges-emissions-and-governance).

Every row is scoped to a `chainId`, so a single API answers questions for all
[supported chains](../README.md#supported-chains) at once.

### Three kinds of entity

The entity types fall into four categories (append-only Aero event rows are
the fourth; see [below](#aero-gauges-emissions-and-governance)). Identifying the category of an
entity prevents querying the wrong one.

| Kind | What it is | Examples | Use it for |
| ---- | ---------- | -------- | ---------- |
| **Latest-state aggregates** | One row per thing, always holding the current value | `Pool`, `Token`, `UserStatsPerPool`, `NonFungiblePosition`, `VeNFTState`, `ALM_LP_Wrapper` | The current value of an entity |
| **Snapshots** | Hourly, epoch-aligned copies of an aggregate | `PoolSnapshot`, `TokenPriceSnapshot`, `UserStatsPerPoolSnapshot`, … | Historical and time-series queries (charts, TVL over time) |
| **Internal buffers** | Short-lived bookkeeping rows used to correlate events, mostly deleted once consumed | `PoolTransferInTx`, `CLPoolMintEvent`, `Pending*`, `Tx*Registry` | Not intended for consumers |

The buffers are listed under
[*Internal buffers & deferred state*](schema.md#internal-buffers--deferred-state)
in the schema reference. A table whose name ends in `_event`, `InTx`, or
`Registry`, begins with `Pending`, or is a `Mint` or `Initialize` placeholder is
internal bookkeeping and is not intended for consumers.

## Where to query

The indexer exposes a Hasura GraphQL endpoint. Hasura auto-generates one query
field per entity, together with filtering, ordering, pagination, and
aggregation. There are no custom resolvers.

- **Local development** (`pnpm dev`): the GraphQL endpoint is served at
  `http://localhost:8080/v1/graphql` and the interactive console at
  `http://localhost:8080/console` (default admin secret `testing`). The
  console's GraphiQL tab is the most efficient way to explore the schema. It
  provides autocomplete and a schema browser.
- **Hosted deployment**: the deployment serves the same GraphQL endpoint at a
  public URL. Any GraphQL client (Apollo, urql, `graphql-request`, `fetch`, or
  `curl`) can query it.

A request is an HTTP POST:

```bash
curl -s https://<your-endpoint>/v1/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ Pool(limit: 1) { id name totalLiquidityUSD } }"}'
```

## Query basics

Hasura provides the following arguments on every entity:

- `where: { field: { _eq / _gt / _lt / _gte / _lte / _in / _ilike: value } }` — filter
- `order_by: { field: desc | asc }` — sort
- `limit` / `offset` — paginate
- `distinct_on: [field]` — deduplicate

Where the deployment enables Hasura aggregations, each entity also has an
`_aggregate` companion field (`Pool_aggregate`) for `sum`, `count`, `avg`,
`min`, and `max` without retrieving every row. Some deployments disable
server-side aggregation. If `Pool_aggregate` is absent from the schema, retrieve
the rows and sum them client-side.

Two characteristics of the response are worth noting:

- **`BigInt` fields are returned as strings** (for example
  `"1234500000000000000"`), because the values exceed the safe integer range in
  JavaScript. Parse them with a big-number library rather than `Number()`.
- **Entity names are used verbatim** as the query field (`Pool`, not `pools`).

## The five scaling rules

Most reports of incorrect numbers are scaling mistakes. Raw values are
fixed-point integers, and a division converts them to a human-readable number.
There are five rules.

| Field group | Scale | To obtain a human-readable number |
| ----------- | ----- | --------------------------------- |
| **USD fields** — any field ending in `USD` (`totalLiquidityUSD`, `totalVolumeUSD`, `totalFeesGeneratedUSD`, `*ClaimedUSD`, …) | `1e18` | `value / 1e18` gives dollars |
| **Raw token amounts** — `reserve0/1`, `totalVolume0/1`, `lpBalance`, `totalLiquidityAdded/RemovedToken0/1`, `oUSDTamount`, … | `10^token.decimals` | `value / 10^decimals` gives whole tokens |
| **Token prices** — `Token.pricePerUSDNew` | `1e18` | `value / 1e18` gives the USD price of one whole token. Despite the field name, the value is USD-per-token. |
| **Pool price ratios** — `Pool.token0Price` / `token1Price` | `1e18`, already decimal-adjusted | `value / 1e18` gives whole counter-token per whole token |
| **Fee rates** — `baseFee`, `currentFee` | `FEE_SCALE = 1e6` (hundredths of a basis point) | `value / 1e6` gives a fraction. `value / 1e4` gives a percentage (for example, `3000` is 0.30%). On CL and V2 pools `baseFee` is the configured fee and `currentFee` the rate the latest swap actually paid (dynamic-fee pools move it swap to swap); see [ADR 0001](adr/0001-canonical-fee-field-scaling.md). |

The four fee-amount fields `totalFeesGenerated0/1` and `totalFeesContributed0/1`
are an exception to the raw-token rule. They are `1e18`-normalized rather than
raw decimals (issue #812,
[ADR 0001](adr/0001-canonical-fee-field-scaling.md)), so divide them by `1e18`
regardless of token decimals. The `totalStakedFeesCollected0/1` and
`totalUnstakedFeesCollected0/1` fields remain raw token units. Each field's exact
scale is documented in its [`schema.md`](schema.md) description.

## Example queries

The following queries map common questions to GraphQL and can be pasted into the
console. Base is `chainId: 8453` and Optimism is `chainId: 10`.

### Top 10 pools by TVL on a chain

```graphql
query TopPools {
  Pool(
    where: { chainId: { _eq: 8453 } }
    order_by: { totalLiquidityUSD: desc }
    limit: 10
  ) {
    id
    name
    isCL
    isStable
    totalLiquidityUSD      # ÷ 1e18
    totalVolumeUSD         # ÷ 1e18
    totalFeesGeneratedUSD  # ÷ 1e18
    token0_address
    token1_address
  }
}
```

### One pool's current state, with its tokens

`token0_id` and `token1_id` are `{chainId}-{address}` keys into `Token`.
Retrieve the tokens in a second query by id, or use the nested relationship if
the deployment exposes it (`token0 { symbol pricePerUSDNew }`).

```graphql
query OnePool {
  Pool(where: { id: { _eq: "8453-0x..." } }) {
    name
    reserve0          # ÷ 10^token0.decimals
    reserve1          # ÷ 10^token1.decimals
    token0Price       # ÷ 1e18  (token1 per token0)
    currentFee        # ÷ 1e4 → percent
    gaugeIsAlive
    veNFTamountStaked # legacy vote weight, ÷ 1e18 (0 on superchain leaf pools: see RootPool)
    token0_id
    token1_id
  }
}
```

### A pool's TVL and volume history (for a chart)

Snapshots are hourly. Filter a pool's snapshots by time and read them in order.

```graphql
query PoolHistory {
  PoolSnapshot(
    where: {
      poolAddress: { _eq: "0x..." }
      chainId: { _eq: 8453 }
      timestamp: { _gte: "2026-05-01T00:00:00Z" }
    }
    order_by: { timestamp: asc }
  ) {
    timestamp
    totalLiquidityUSD
    totalVolumeUSD
    totalFeesGeneratedUSD
  }
}
```

### A token's current price and price history

```graphql
query TokenPrice {
  Token(where: { chainId: { _eq: 8453 }, symbol: { _eq: "AERO" } }) {
    address
    decimals
    pricePerUSDNew         # ÷ 1e18 → USD per token
    isWhitelisted
    priceTrustOutcome      # see the caveats below
  }
  TokenPriceSnapshot(
    where: { chainId: { _eq: 8453 }, address: { _eq: "0x..." } }
    order_by: { lastUpdatedTimestamp: asc }
  ) {
    lastUpdatedTimestamp
    pricePerUSDNew
    priceSource            # pinned / pool / canonical-seed / canonical-snapshot = priced this hour
    pricingPoolId          # pool the price came through (priceSource = pool)
    pricingSourceTokenId   # cross-chain source token (priceSource = canonical-*)
    pricingDepthUSD        # depth of the winning candidate, ÷ 1e18 → USD
  }
}
```

### A wallet's full activity in a pool

`UserStatsPerPool` holds one row per `(user, pool)`, covering liquidity, swaps,
fees paid, gauge rewards, votes, and ALM in a single entity.

```graphql
query UserInPool {
  UserStatsPerPool(
    where: {
      userAddress: { _eq: "0x..." }
      chainId: { _eq: 8453 }
    }
    order_by: { totalSwapVolumeUSD: desc }
  ) {
    poolAddress
    lpBalance
    currentLiquidityStakedUSD   # per-user: as-of-last-activity, $0 may mean stale — see caveats
    totalSwapVolumeUSD
    totalFeesContributedUSD
    totalGaugeRewardsClaimedUSD
    totalBribeClaimedUSD
  }
}
```

### A wallet's concentrated-liquidity (CL) positions

```graphql
query UserPositions {
  NonFungiblePosition(
    where: { owner: { _eq: "0x..." }, chainId: { _eq: 8453 } }
  ) {
    tokenId
    pool
    tickLower
    tickUpper
    liquidity
    isStakedInGauge
  }
}
```

### veNFT locks and their vote allocations

```graphql
query VeNFT {
  VeNFTState(where: { chainId: { _eq: 10 }, owner: { _eq: "0x..." } }) {
    tokenId
    totalValueLocked     # ÷ 1e18 (governance token)
    isPermanent
    locktime
    votesPerPool {       # derived reverse relation
      poolAddress
      veNFTamountStaked
    }
  }
}
```

### Bribes and fee rewards on a pool

```graphql
query PoolIncentives {
  Pool(where: { id: { _eq: "8453-0x..." } }) {
    name
    totalBribeClaimedUSD       # ÷ 1e18
    totalFeeRewardClaimedUSD   # ÷ 1e18
    totalEmissionsUSD          # ÷ 1e18  (see the caveats below; 0 on superchain leaf pools)
    bribeVotingRewardAddress
    feeVotingRewardAddress
  }
}
```

### Total TVL across a chain

This query requires a deployment that exposes Hasura aggregations. If
`Pool_aggregate` is absent from the schema, retrieve every pool on the chain
(paginating with `limit` and `offset`) and sum `totalLiquidityUSD` client-side.

```graphql
query ChainTVL {
  Pool_aggregate(where: { chainId: { _eq: 8453 } }) {
    aggregate {
      count
      sum { totalLiquidityUSD }   # ÷ 1e18
    }
  }
}
```

### Votes and emissions of a superchain leaf pool (Mode, Lisk, Metal, …)

A superchain leaf pool is voted for, and gets its emissions, on Optimism through
a placeholder "root pool". Since the per-chain flip (ADR 0009) those numbers are
stored only on Optimism, in `RootPool` (one per root pool) and `RootPoolVote`
(one per veNFT and root pool); the leaf `Pool`'s `veNFTamountStaked`,
`totalEmissions` and `totalEmissionsUSD` stay `0`. Find the root pool of a leaf
pool by its pair:

```graphql
query LeafPoolVotes {
  # a CL leaf pool: its rootPoolMatchingHash, e.g. "34443_0x..._0x..._100"
  RootPool(where: { rootPoolMatchingHash: { _eq: "34443_0x..._0x..._100" } }) {
    rootPoolAddress
    veNFTamountStaked          # Voter.weights(rootPool), ÷ 1e18
    totalEmissions             # VELO, ÷ 1e18
    totalEmissionsUSD          # ÷ 1e18
    gaugeAddress gaugeIsAlive
  }
  # a V2 leaf pool: the leaf chain records its root pool
  RootPool_LeafPool(where: { leafPoolAddress: { _eq: "0x..." } }) {
    rootPoolAddress
  }
}
```

A CL root pool also has to match the leaf pool's factory: the leaf pool's
`factoryAddress` equals the root pool's `rootFactoryAddress`. The ClickHouse
layer does this join for you (`pools`, `leaf_pool_root_totals`; see
[`clickhouse.md`](clickhouse.md)).

### Cross-chain superswaps (oUSDT via Hyperlane)

The `SuperSwap` entity was removed at the per-chain flip (ADR 0009). Each chain
writes its own side, keyed by the Hyperlane message id: `SuperSwapOriginLeg` at
the origin's `CrossChainSwap` and `SuperSwapDestinationLeg` at the destination's
first oUSDT swap after `ProcessId`. Both are ClickHouse-only, so there is no
GraphQL query for them any more; the `super_swap_legs` view in the ClickHouse
layer joins them (same fields as the entity, with `origin_timestamp` and
`destination_timestamp`), and also finds the SuperSwaps the handler-side
stitching used to lose.

## What changed for GraphQL consumers (per-chain entities, 2026-11)

Every entity is now stored per chain (ADR 0009). Chains index independently, a
chain can be added without a resync, and no handler reads another chain's rows.
For API consumers:

| what | before | after |
|---|---|---|
| `chainId` on an entity | a declared field on 51 entities | envio's own column, on **every** entity (same name and values; also on entities that had none, such as `VeNFTPoolVote` and `OUSDTSwaps`) |
| primary key | `id` | `(id, chainId)`: `X_by_pk` needs both `id` and `chainId`; ids keep their `{chainId}-…` format, so filtering on `id` alone still finds one row |
| superchain leaf pool votes (`Pool.veNFTamountStaked`) | written onto the leaf pool by Optimism's handlers | `0`; on Optimism's `RootPool.veNFTamountStaked` |
| superchain leaf pool emissions (`Pool.totalEmissions`, `totalEmissionsUSD`, and in `PoolSnapshot`) | added onto the leaf pool by Optimism's `DistributeReward` | `0`; on `RootPool.totalEmissions` / `totalEmissionsUSD` |
| a leaf user's vote (`UserStatsPerPool.veNFTamountStaked` on a leaf pool) and leaf-keyed `VeNFTPoolVote` rows | written by Optimism's `Voted` / `Abstained` | not written; `RootPoolVote` (veNFT × root pool, on Optimism) |
| `SuperSwap` | entity | removed; ClickHouse `super_swap_legs` |
| `PendingVote`, `PendingDistribution`, `PendingRootPoolMapping` | internal | removed |
| `RootPool_LeafPool` | CL and V2 rows, written by Optimism and the leaf | V2 rows only, written by the leaf chain; CL leaf pools match their `RootPool` by `rootPoolMatchingHash` and factory |
| `TokenPriceSnapshot.priceSource = canonical` | the live price of the source chain's `Token` | no longer written; leaf tokens fall back to `canonical-seed` / `canonical-snapshot` (the source's hourly price) |

Local pools (Optimism's and Base's own pools, Aero pools) keep their vote and
emission fields as before. A `0` on a superchain leaf pool means "stored on
the root chain", not "no votes".

## Aero gauges, emissions and governance

Aero replaced weekly veNFT votes with continuously allocated sAERO and
emissions minted on claim ([ADR 0006](adr/0006-aero-gauges-and-governance.md)).
The entities follow three conventions:

- **Every row belongs to the chain its events came from.** sAERO and the root
  Voter's allocation ledger are on Base (8453). Each chain's LeafVoter books its
  own gauge allocations. Root and leaf are not reconciled by the indexer (a
  dispatch can be in flight or rejected), so join them in the query.
- **Emission amounts are in the chain's reward token**: AERO on Base, xAERO
  elsewhere, both 18 decimals and redeemable 1:1, so they sum across chains as
  AERO-equivalent (but not with the legacy VELO / AERO v1 emission fields).
  Allocations are undecayed AERO amounts; voting power at time `t` is the amount
  for a permanent stake, else `amount × (stakeEnd − t) / 126,144,000`.
- **Event rows and snapshots live in ClickHouse** (`AeroGaugeStakeEvent`,
  `AeroEmissionsEvent`, `AeroAllocationEvent`, `SAeroPositionEvent`,
  `AeroVotingRewardsEvent`, `AeroRedemptionEvent`, `AeroMinterEvent`,
  `AeroMigrationEvent`, hourly `AeroGaugeSnapshot`, `AeroLeafVoterStateSnapshot`,
  `SAeroEscrowStateSnapshot`, `AeroMinterSnapshot`). The current-state entities
  (`AeroGauge`, `SAeroPosition`, `AeroLeafAllocation`, …) are in both stores and
  on GraphQL. In ClickHouse every entity is a view returning the latest
  version of each row, and `BigInt` columns are strings: cast them
  (`toUInt256(amount)`, `toInt256(...)` for signed fields) before summing.

| Question | Entity |
| --- | --- |
| A pool's gauge, rewards manager, cap, weight, emissions credited / minted / forfeited | `AeroGauge` (`pool_id` = `Pool.id`) |
| Emissions per gauge over time | `AeroGaugeSnapshot` (cumulative; diff consecutive hours) |
| A wallet's claims, penalties and deferred emissions | `AeroEmissionsEvent` (`account`) |
| Stake / unstake history | `AeroGaugeStakeEvent`; current stake on `UserStatsPerPool` / `NonFungiblePosition.isStakedInGauge` |
| xAERO minted, redeemed and outstanding per chain | `AeroLeafVoterState`; redemptions in `AeroRedemptionEvent` |
| sAERO positions and supply | `SAeroPosition`, `SAeroEscrowState`, history in `SAeroPositionEvent` |
| Where a position's power is booked (per chain, Base view) | `AeroRootAllocation` (`targetChainId` 0 = idle CHAIN0) |
| A position's allocation per gauge on a chain | `AeroLeafAllocation` (current), `AeroAllocationEvent` (history) |
| Gauge weight | `AeroGauge.totalAllocated` (undecayed), `lastGaugeWeight` (decayed, at last settlement) |
| Fees and incentives for allocators | `AeroVotingRewardsManager`, `AeroIncentiveProgram`, `AeroVotingRewardsEvent` |
| AERO minted by the Minter | `AeroMinterState`, `AeroMinterSnapshot` |
| Legacy veAERO / veVELO migrated | `AeroMigrationTotals`, `AeroMigrationEvent` |

Top Aero gauges on a chain by emissions minted:

```graphql
query TopAeroGauges {
  AeroGauge(
    where: { chainId: { _eq: 8453 } }
    order_by: { totalEmissionsMinted: desc }
    limit: 10
  ) {
    gaugeAddress poolAddress isCL emissionCap
    totalAllocated lastGaugeWeight          # AERO, ÷ 1e18
    totalEmissionsCredited totalEmissionsMinted totalEmissionsForfeited  # reward token, ÷ 1e18
    totalEmissionsMintedUSD                  # ÷ 1e18
  }
}
```

A position's allocations everywhere (root view on Base, leaf books per chain):

```graphql
query PositionAllocations($tokenId: numeric!) {
  AeroRootAllocation(where: { tokenId: { _eq: $tokenId }, amount: { _gt: 0 } }) {
    targetChainId amount
  }
  AeroLeafAllocation(where: { tokenId: { _eq: $tokenId }, allocated: { _gt: 0 } }) {
    chainId gaugeAddress poolAddress allocated
  }
}
```

Emissions minted per chain per day (ClickHouse; cumulative snapshot at the
end of each day, differenced):

```sql
SELECT chainId, day,
       minted_cum - lagInFrame(minted_cum, 1, toUInt256(0))
         OVER (PARTITION BY chainId ORDER BY day) AS minted
FROM (
  SELECT chainId, toDate(timestamp) AS day,
         max(toUInt256(totalEmissionsMinted)) AS minted_cum
  FROM AeroLeafVoterStateSnapshot
  GROUP BY chainId, day
)
ORDER BY day, chainId;
```

Notes:

- `Pool.gaugeIsAlive` on an AERO pool means "activated and emission cap > 0";
  a cap of 0 is Aero's only way to switch a gauge off.
- `AeroGauge.emissionCap` is null until the first cap event or settlement: the
  factory's default cap applies (never 0).
- Base claims are redeemed to AERO automatically; those internal redemptions
  are counted on the totals but have no `AeroRedemptionEvent` row.
- Delegation of sAERO votes is not indexed.

## Caveats

The following are non-obvious properties of the data rather than defects.

- **Verify price trust before relying on a USD value.** USD values are gated by
  a price-trust system. A token whose price cannot be trusted contributes `$0` to
  USD aggregates rather than an unreliable figure. Check
  `Token.priceTrustOutcome`, `priceTrustReason`, `isWhitelisted` and
  `isListedOnAero` when a USD value is unexpectedly low or zero. A token is
  trusted when it is legacy-whitelisted **or** listed in the Aero TokenRegistry
  **or** a configured price connector for its chain — and not
  operator-blacklisted. `priceTrustReason` records which: `WL`
  (legacy-whitelisted), `LISTED` (on Aero's token list), `CONNECTOR` (a canonical base asset — WETH, USDC, the
  chain's gov token — trusted without a `WhitelistToken` event, issue #898),
  `BLACKLISTED`, or `NON_WL` (no trust signal). This is why USD is populated on
  leaf chains that never whitelisted tokens on-chain (e.g. **Mode**, **Swell**)
  and on WETH-paired pools on **Soneium**/**Metal** — connector legs count even
  when `isWhitelisted` is `false`. On `TokenPriceSnapshot`, filter `priceSource`
  to `pinned`, `pool`, `canonical-seed` or `canonical-snapshot` (`canonical` on
  rows written before the per-chain flip), or `pricePerUSDNew > 0`, to exclude
  carried and zeroed ticks. There is at most one snapshot per token per clock
  hour.
- **Token prices come from indexed pool state, not an on-chain oracle.** Each
  token is priced once per hour through its deepest qualifying pool against a
  lower-tier counterparty (stablecoins at $1 → WETH → price connectors and the
  reward token → everything else). A token with no qualifying pool keeps its
  last price for up to 7 days, then reads `0`. Rows written before this change
  (ADR 0003) carry the oracle-era tags `fresh` / `pool-implied`.
- **Per-user staked-USD is as-of-last-activity, not current.**
  `UserStatsPerPool.currentLiquidityStakedUSD` (CL pools) is revalued only at
  hourly snapshot time, and a snapshot is written only when that user is active.
  An idle staker is never revisited, so the field stays frozen at their last
  action — often `$0` while a real position is still staked. Summed across users
  it under-counts the pool's staked-USD by ~12–31%, and a large share of stakers
  read exactly `$0`. For a current figure, read per-user staked **units**
  (`currentLiquidityStaked`) and value them yourself, or use pool-level
  `Pool.currentLiquidityStakedUSD` (live for CL pools; V2 pool-level staked-USD
  has its own staleness, see #899). Treat `$0` as "possibly stale," not "no
  stake" (issue #902).
- **Some legacy pools report `totalEmissionsUSD = 0` despite real emissions.**
  Gauges that stopped emitting before the chain's price oracle could value the
  reward token (AERO on Base before 2024-06-14, VELO on Optimism before
  2024-01-10) are permanently `$0` in USD even though `totalEmissions` in token
  units is non-zero. 188 pools are affected (issue #738).
- **Reward-token amounts are per-chain and are not summable across chains.**
  Fields such as `totalEmissions`, `totalGaugeRewardsClaimed`, and
  `totalEmissionsRedistributed` are denominated in the chain's single reward
  token (AERO on Base, VELO on Optimism), 18-dec. Summing them across chains is
  not meaningful. Sum the `*USD` companion fields instead (issue #813).
- **Raw token-unit sums for bribes and fee rewards are not stored.** Because
  bribes are arbitrary heterogeneous tokens, only the `*USD` aggregates
  (`totalBribeClaimedUSD`, `totalFeeRewardClaimedUSD`) are retained. There is no
  raw token-amount counterpart (issue #813).
- **Snapshots are hourly and epoch-aligned**, not per-event. For a value at an
  exact block, read the latest-state aggregate. For trends, read the snapshot
  series. A snapshot's `timestamp` is the epoch it represents.
- **Addresses are stored checksummed.** Match them exactly, or use `_ilike` for
  case-insensitive matching. Entity `id`s are deterministic strings:
  `{chainId}-{address}` for pools and tokens,
  `{chainId}-{userAddress}-{poolAddress}` for user stats, and
  `{entityId}-{epochMs}` for snapshots. Each entity's exact `id` format is
  documented on its `id` field in [`schema.md`](schema.md).

## Further reference

- [`docs/schema.md`](schema.md) — every entity and field, with per-field scale
  and `id` format
- [`README.md`](../README.md) — architecture, supported chains, and how to run
  the indexer
- [ADR 0001](adr/0001-canonical-fee-field-scaling.md) — the rationale for the
  fee-field scaling
- [Envio HyperIndex docs](https://docs.envio.dev/) — the underlying platform and
  its Hasura GraphQL layer
