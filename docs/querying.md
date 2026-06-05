# Querying the indexer — a consumer's guide

How to go from "I've never seen this indexer" to pulling real answers out of it.
This is the **data-consumer** view: the GraphQL API, the handful of scaling
rules you must know, and copy-paste recipes for the questions people actually
ask. For the architecture / how-it's-built view, see
[`README.md`](../README.md); for the exhaustive field-by-field reference, see
[`docs/schema.md`](schema.md).

## What the indexer gives you

The indexer ingests on-chain events for Velodrome V2 (Optimism) and Aerodrome
(Base) plus their superchain deployments, and serves the **derived state** as a
GraphQL API over Postgres. You don't deal with raw logs — you query clean,
aggregated entities like "this pool's TVL, volume, and fees" or "this wallet's
position in this pool".

Every row is scoped to a `chainId`, so the same API answers questions for all
[supported chains](../README.md#supported-chains) at once.

### Three kinds of entity

The 39 entity types fall into three buckets — knowing which is which saves you
from querying the wrong thing:

| Kind | What it is | Examples | Use it for |
| ---- | ---------- | -------- | ---------- |
| **Latest-state aggregates** | One row per thing, always holding the *current* value | `Pool`, `Token`, `UserStatsPerPool`, `NonFungiblePosition`, `VeNFTState`, `ALM_LP_Wrapper` | "What is X right now?" |
| **Snapshots** | Hourly, epoch-aligned copies of an aggregate | `PoolSnapshot`, `TokenPriceSnapshot`, `UserStatsPerPoolSnapshot`, … | "How did X change over time?" (charts, TVL history) |
| **Internal buffers** | Short-lived bookkeeping rows the indexer uses to correlate events; mostly deleted once consumed | `PoolTransferInTx`, `CLPoolMintEvent`, `Pending*`, `Tx*Registry` | **Ignore these** — not meant for consumers |

The buffers are listed under
[*Internal buffers & deferred state*](schema.md#internal-buffers--deferred-state)
in the schema reference. If a table name ends in `_event`, `InTx`, `Registry`,
`Pending*`, or `Mint`/`Initialize` placeholders, it's plumbing — skip it.

## Where to query

The indexer exposes a **Hasura GraphQL** endpoint. Hasura auto-generates one
query field per entity, plus filtering, ordering, pagination, and aggregation —
no custom resolvers to learn.

- **Local dev** (`pnpm dev`): GraphQL at `http://localhost:8080/v1/graphql`,
  interactive console at `http://localhost:8080/console` (default admin secret
  `testing`). The console's GraphiQL tab is the fastest way to explore — it has
  autocomplete and the full schema browser.
- **Hosted deployment**: your deployment serves the same GraphQL endpoint at a
  public URL. Point any GraphQL client (Apollo, urql, `graphql-request`, plain
  `fetch`, or `curl`) at it.

A request is just an HTTP POST:

```bash
curl -s https://<your-endpoint>/v1/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ Pool(limit: 1) { id name totalLiquidityUSD } }"}'
```

## Query basics

Hasura gives every entity these arguments:

- `where: { field: { _eq / _gt / _lt / _gte / _lte / _in / _ilike: value } }` — filter
- `order_by: { field: desc | asc }` — sort
- `limit` / `offset` — paginate
- `distinct_on: [field]` — deduplicate

…and, **if your deployment enables Hasura aggregations**, an `_aggregate`
companion field (`Pool_aggregate`) for `sum`, `count`, `avg`, `min`, `max`
without pulling every row. Some deployments disable server-side aggregation — if
`Pool_aggregate` isn't in the schema, fetch the rows and sum client-side.

Two things to expect in responses:

- **`BigInt` fields come back as strings** (e.g. `"1234500000000000000"`), because
  the values exceed JS's safe integer range. Parse them with a big-number library,
  not `Number()`.
- **Entity names are used verbatim** as the query field (`Pool`, not `pools`).

## The 5 scaling rules (read this before trusting any number)

Almost every "the numbers look wrong" question is a scaling mistake. Raw values
are fixed-point integers; you divide to get a human number. There are only five
rules:

| Field group | Scale | To get a human number |
| ----------- | ----- | --------------------- |
| **USD fields** — anything ending in `USD` (`totalLiquidityUSD`, `totalVolumeUSD`, `totalFeesGeneratedUSD`, `*ClaimedUSD`, …) | `1e18` | `value / 1e18` → dollars |
| **Raw token amounts** — `reserve0/1`, `totalVolume0/1`, `lpBalance`, `totalLiquidityAdded/RemovedToken0/1`, `oUSDTamount`, … | `10^token.decimals` | `value / 10^decimals` → whole tokens |
| **Token prices** — `Token.pricePerUSDNew` | `1e18` | `value / 1e18` → **USD per whole token** (the name says "per USD" but it is USD-per-token) |
| **Pool price ratios** — `Pool.token0Price` / `token1Price` | `1e18` (already decimal-adjusted) | `value / 1e18` → whole counter-token per whole token |
| **Fee *rates*** — `baseFee`, `currentFee` | `FEE_SCALE = 1e6` (hundredths of a basis point) | `value / 1e6` → fraction; `value / 1e4` → percent (e.g. `3000` → 0.30%) |

**One exception to the raw-token rule:** the four fee-*amount* fields
`totalFeesGenerated0/1` and `totalFeesContributed0/1` are **`1e18`-normalized**,
not raw decimals (issue #812 / [ADR 0001](adr/0001-canonical-fee-field-scaling.md)),
so divide them by `1e18` regardless of token decimals. The
`totalStaked/UnstakedFeesCollected0/1` fields are still raw token units. When in
doubt, each field's exact scale is in its [`schema.md`](schema.md) description.

## Recipes

Real questions → queries you can paste into the console (Base = `chainId: 8453`,
Optimism = `10`).

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

`token0_id` / `token1_id` are `{chainId}-{address}` keys into `Token`. Either
fetch the tokens in a second query by id, or use the nested relationship if your
deployment exposes it (`token0 { symbol pricePerUSDNew }`).

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

### A pool's TVL / volume history (for a chart)

Snapshots are hourly. Filter the pool's snapshots by time and read them in order.

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
    priceTrustOutcome      # see "Trust the price?" below
  }
  TokenPriceSnapshot(
    where: { chainId: { _eq: 8453 }, address: { _eq: "0x..." } }
    order_by: { lastUpdatedTimestamp: asc }
  ) {
    lastUpdatedTimestamp
    pricePerUSDNew
    priceSource            # filter to fresh / pool-implied / rebind for real reads
  }
}
```

### Everything a wallet has done in a pool

`UserStatsPerPool` is one row per `(user, pool)` — liquidity, swaps, fees paid,
gauge rewards, votes, ALM, all in one place.

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
    currentLiquidityStakedUSD
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

### veNFT locks and how they voted

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

### Bribes & fee rewards on a pool

```graphql
query PoolIncentives {
  Pool(where: { id: { _eq: "8453-0x..." } }) {
    name
    totalBribeClaimedUSD       # ÷ 1e18
    totalFeeRewardClaimedUSD   # ÷ 1e18
    totalEmissionsUSD          # ÷ 1e18  (see caveat below)
    bribeVotingRewardAddress
    feeVotingRewardAddress
  }
}
```

### Total TVL across a chain (aggregate, no row dump)

Works only where the deployment exposes Hasura aggregations. If `Pool_aggregate`
isn't in the schema, fetch every pool on the chain (paginating with
`limit`/`offset`) and sum `totalLiquidityUSD` client-side instead.

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

## Caveats a consumer must know

These are the non-obvious things that bite people. None are bugs — they're
properties of the data.

- **Trust the price before trusting the USD.** USD values are gated by a
  price-trust system: a token whose price can't be trusted contributes **$0** to
  USD aggregates rather than a garbage number. Check `Token.priceTrustOutcome` /
  `priceTrustReason` and `isWhitelisted` when a USD figure looks suspiciously
  low or zero. On `TokenPriceSnapshot`, filter `priceSource` to
  `fresh` / `pool-implied` / `rebind` (or `pricePerUSDNew > 0`) to drop carried
  and zeroed ticks.
- **Some legacy pools show `totalEmissionsUSD = 0` despite real emissions.**
  Gauges that stopped emitting before the chain's price oracle could value the
  reward token (AERO/Base pre-2024-06-14, VELO/OP pre-2024-01-10) are
  permanently `$0` in USD even though `totalEmissions` (token units) is non-zero.
  188 pools are affected (issue #738).
- **Reward-token amounts are per-chain, not cross-chain summable.** Fields like
  `totalEmissions`, `totalGaugeRewardsClaimed`, `totalEmissionsRedistributed`
  are in the chain's single reward token (AERO on Base, VELO on Optimism), 18-dec.
  Summing them across chains is meaningless — sum the `*USD` companions instead
  (issue #813).
- **Bribe/fee-reward raw token-unit sums don't exist.** Because bribes are
  arbitrary heterogeneous tokens, only the `*USD` aggregates
  (`totalBribeClaimedUSD`, `totalFeeRewardClaimedUSD`) are kept — there is no
  raw token-amount counterpart (issue #813).
- **Snapshots are hourly and epoch-aligned**, not per-event. For a value at an
  exact block, read the latest-state aggregate; for trends, read the snapshot
  series. A snapshot's `timestamp` is the epoch it represents.
- **Addresses are stored checksummed.** Match them exactly (or use `_ilike` for
  case-insensitive matching). Entity `id`s are deterministic strings —
  `{chainId}-{address}` for pools/tokens, `{chainId}-{userAddress}-{poolAddress}`
  for user stats, `{entityId}-{epochMs}` for snapshots. Each entity's exact `id`
  format is on its `id` field in [`schema.md`](schema.md).

## Pointers

- [`docs/schema.md`](schema.md) — every entity and field, with per-field scale
  and `id` format
- [`README.md`](../README.md) — architecture, supported chains, how to run it
- [ADR 0001](adr/0001-canonical-fee-field-scaling.md) — why fee fields are scaled
  the way they are
- [Envio HyperIndex docs](https://docs.envio.dev/) — the underlying platform and
  its Hasura GraphQL layer
