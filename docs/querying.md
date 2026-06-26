# Querying the indexer: a consumer's guide

A practical guide to querying the indexer and interpreting its output, written
for consumers who have not worked with it before. It covers the GraphQL API, the
value-scaling rules that must be applied to every numeric field, example queries
for common questions, and the data caveats that most affect interpretation. For
the architecture and build instructions, see [`README.md`](../README.md). For
the exhaustive field-by-field reference, see [`docs/schema.md`](schema.md).

## What the indexer provides

The indexer ingests on-chain events for Velodrome V2 (Optimism) and Aerodrome
(Base), together with their superchain deployments, and serves the derived state
as a GraphQL API over Postgres. Consumers do not work with raw logs. They query
clean, aggregated entities such as a pool's TVL, volume, and fees, or a wallet's
position in a pool.

Every row is scoped to a `chainId`, so a single API answers questions for all
[supported chains](../README.md#supported-chains) at once.

### Three kinds of entity

The 39 entity types fall into three categories. Identifying the category of an
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
| **Fee rates** — `baseFee`, `currentFee` | `FEE_SCALE = 1e6` (hundredths of a basis point) | `value / 1e6` gives a fraction. `value / 1e4` gives a percentage (for example, `3000` is 0.30%). |

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
    totalVotesDepositedUSD
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
    priceSource            # filter to fresh / pool-implied / rebind for accepted reads
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
    currentLiquidityStakedUSD   # per-user: as-of-last-activity, 0 may mean stale — see caveats
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
    totalEmissionsUSD          # ÷ 1e18  (see the caveats below)
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

### Cross-chain superswaps (oUSDT via Hyperlane)

```graphql
query SuperSwaps {
  SuperSwap(order_by: { timestamp: desc }, limit: 20) {
    originChainId
    destinationChainId
    sourceChainToken
    destinationChainToken
    oUSDTamount
    timestamp
  }
}
```

## Caveats

The following are non-obvious properties of the data rather than defects.

- **Verify price trust before relying on a USD value.** USD values are gated by
  a price-trust system. A token whose price cannot be trusted contributes `$0` to
  USD aggregates rather than an unreliable figure. Check
  `Token.priceTrustOutcome`, `priceTrustReason`, and `isWhitelisted` when a USD
  value is unexpectedly low or zero. On `TokenPriceSnapshot`, filter
  `priceSource` to `fresh`, `pool-implied`, or `rebind` (or `pricePerUSDNew > 0`)
  to exclude carried and zeroed ticks.
- **Per-user staked-USD is as-of-last-activity, not current.**
  `UserStatsPerPool.currentLiquidityStakedUSD` (CL pools) is revalued only at
  hourly snapshot time, and a snapshot is written only when that user is active.
  An idle staker is never revisited, so the field stays frozen at their last
  action — often `$0` while a real position is still staked. Summed across users
  it under-counts the pool's staked-USD by ~12–31%, and a large share of stakers
  read exactly `$0`. For a current figure, read per-user staked **units**
  (`currentLiquidityStaked`) and value them yourself, or use pool-level
  `Pool.currentLiquidityStakedUSD` (maintained live). Treat `$0` as "possibly
  stale," not "no stake" (issue #902).
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
