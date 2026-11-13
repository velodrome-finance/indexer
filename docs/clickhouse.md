# Querying the indexer in ClickHouse

This guide is for analysts who query the indexer's ClickHouse database with SQL. It covers how
to connect, the analytics layer (typed tables and views built on top of what envio writes), the
units and types, worked queries for the questions the protocol team asks most, and what the
data cannot tell you. The GraphQL API is described in [`querying.md`](querying.md); the field
reference is [`schema.md`](schema.md).

## Contents

- [Why there is a layer on top of envio's tables](#why-there-is-a-layer-on-top-of-envios-tables)
- [Connecting](#connecting)
- [Installing and operating the layer](#installing-and-operating-the-layer)
- [How the layer stays exact](#how-the-layer-stays-exact)
- [Object catalogue](#object-catalogue)
- [Units, types and overflow](#units-types-and-overflow)
- [Worked queries](#worked-queries)
- [Limits and data-quality caveats](#limits-and-data-quality-caveats)
- [Proposals for envio's own ClickHouse tables](#proposals-for-envios-own-clickhouse-tables)

## Why there is a layer on top of envio's tables

envio (HyperIndex 3.16) writes every entity stored in ClickHouse to an append-only table
`envio_history_<Entity>`, one row per block in which the entity changed, sorted by
`(id, envio_checkpoint_id)`, plus a view named after the entity that picks the newest row per
id. Querying those directly is slow and awkward:

- **Current state costs a full scan.** The `Pool` view sorts every stored version to keep the
  newest. On the ten-chain test database (764 pools, 54 M `Pool` versions) a
  `GROUP BY chainId` over it took **35.6 s and read 4.6 GiB**; in production (27.6 M versions of
  a single pool, 248 GiB of `Pool` history) the same query ran out of memory at 32 GiB. The
  layer's `pools` view answers it in milliseconds.
- **Numbers are strings.** Every `BigInt` declared with `precision` above 38 (almost all of them
  here) is a `String` column (upstream enviodev/hyperindex#1816). Sums need casts, sorting is
  lexicographic, and every value still needs scaling (USD by 1e18, token amounts by the token's
  decimals).
- **Snapshots are sparse and loosely ordered.** The hourly `*Snapshot` entities exist only for
  hours with activity, are sorted by an id that starts with the chain and address, and a reorg
  can leave a rolled-back row next to its replacement.

The layer is a set of typed storage tables, kept up to date from envio's history tables, and
analyst views on top of them. It lives in its own database (`analytics_<indexer database>` by
default) and never writes to envio's.

## Connecting

ClickHouse speaks HTTP (port 8123/8443, or what your host maps) and the native protocol. Any
client works: `clickhouse-client`, DBeaver/DataGrip (ClickHouse JDBC), Grafana, Metabase,
Python `clickhouse-connect`, or `curl`.

```bash
# native client; set the analytics database as the default so the names below resolve
clickhouse-client --host <host> --secure --user <user> --password --database analytics_<db>

# HTTP
curl -s "https://<host>:8443/?database=analytics_<db>" --user '<user>:<password>' \
  --data-binary "SELECT chain_name, round(sum(tvl_usd)) FROM pools GROUP BY chain_name"
```

On the dev box: `velo chsql <stack>/<instance>` opens a client on the instance's envio
database; add `-q "USE analytics_velo_<instance>"` or qualify the names. A read-only `reader`
user exists for the protocol team (SELECT/SHOW only); its password is in the stack's secret
file, not in this repository.

All the views below are in the analytics database. Analysts never need envio's own database,
except through the views that read it directly (`user_pool_snapshots`, `freshness`).

## Installing and operating the layer

Everything is in [`clickhouse/`](../clickhouse): `analytics.py` (the CLI, Python 3.9+ standard
library only), `layer.py` (the column mapping of every storage table), `sql/views.sql` (the
analyst views), `queries/` (the worked queries below) and `tests/`.

Connection settings come from the environment, the same variables the indexer reads:

| variable | meaning |
|---|---|
| `ENVIO_CLICKHOUSE_HOST` | URL of the ClickHouse HTTP interface, e.g. `https://host:8443` |
| `ENVIO_CLICKHOUSE_USERNAME` / `ENVIO_CLICKHOUSE_PASSWORD` | a user that can read the indexer database and create the analytics one |
| `ENVIO_CLICKHOUSE_DATABASE` | the indexer's database (read only) |
| `ANALYTICS_DATABASE` | optional, default `analytics_<indexer database>` |

```bash
python3 clickhouse/analytics.py install   # create or upgrade; backfill what is not yet loaded; start refreshes
python3 clickhouse/analytics.py status    # per table: watermark, commit frontier, source rows still to load, refresh state
python3 clickhouse/analytics.py verify    # prove each table equals argMax over envio's history (see below)
python3 clickhouse/analytics.py refresh   # run every refresh now and wait for it
python3 clickhouse/analytics.py rebuild   # drop the layer's tables and install again (full backfill)
python3 clickhouse/analytics.py drop      # drop the analytics database
python3 clickhouse/analytics.py render    # print the SQL install would run, without running it
python3 clickhouse/analytics.py queries   # run clickhouse/queries/*.sql, print rows and timings
```

On the dev box, `velo env <instance> --show-secrets` prints the variables for an instance.

**`install` is idempotent.** Run it after deploying a new version of the layer, after a schema
change, or whenever in doubt. It:

1. creates the analytics database and a `_meta` table (source database, envio instance id,
   layer version, which tables finished their backfill);
2. **rebuilds from scratch when the indexer was reset** (envio writes a new instance id to
   `envio_info` on every fresh start) or when the layer version changed;
3. creates each storage table and, if its backfill has not completed, loads it from the history
   up to the current commit frontier, in chunks of about 2 M source rows cut at primary-index
   marks (`ANALYTICS_BACKFILL_CHUNK_ROWS`). A backfill cut off half way starts that table again;
4. creates one refreshable materialized view per table (`_refresh_<table>`, every minute,
   `ANALYTICS_REFRESH_EVERY`), which appends what envio committed since the table's watermark;
5. creates or replaces the views.

**Backfill from existing history** is what `install` does on first run. On the ten-chain test
database (≈ 120 M history rows read) it took TBD_BACKFILL. **Rebuild** = `rebuild` (drop and
backfill again) — needed only after a change to the layer's storage tables. **After an indexer
reset** envio empties its database; the refreshes stop loading (their source no longer matches
the recorded instance), `status` prints `STALE`, and `install` rebuilds once the new run has
written its first batch. Re-run `install` after the reset (a cron line running `install` hourly
is a safe way to automate it).

Requirements: ClickHouse 24.10 or later (refreshable materialized views, `mergeTreeIndex`,
`keccak256`); a user with `CREATE DATABASE` (or an analytics database created for you) and
`SELECT` on the indexer database. The analytics database must not be the indexer's: a reset
runs `TRUNCATE DATABASE` on it.

The ClickHouse server here is capped at 2.4 GiB shared by several indexers, so the CLI runs
single-threaded backfill inserts of small blocks and retries a statement the server killed for
lack of memory (every statement it sends is safe to repeat). Raise
`ANALYTICS_MAX_THREADS` / `ANALYTICS_MAX_MEMORY` on a bigger server.

## How the layer stays exact

**What envio writes.** Each batch is inserted into the history tables (one row per entity per
block it changed in, `envio_change` = `SET` or `DELETE`, `envio_checkpoint_id` increasing), then
one row per chain into `envio_chains` (a `ReplacingMergeTree`) moves the *commit frontier*, the
highest committed checkpoint. Rows above the frontier belong to a batch still in flight; if the
indexer dies before committing, the next start deletes them (`ALTER TABLE … DELETE` on
resume) and re-runs the batch, reusing the same checkpoint ids. A reorg does not delete
anything in ClickHouse: envio writes the restored state (or a `DELETE` for entities the reorg
created) as new rows at a later checkpoint. Checkpoint ids are shared by all chains.

**What the layer does.** Each storage table is a `ReplacingMergeTree(_version, _deleted)` keyed
by the entity's natural key (derived from envio's id, so `DELETE` rows, which carry only the
id, land on the right key). `_version` is `envio_checkpoint_id`, `_deleted` is
`envio_change = 'DELETE'`. Its refresh reads only history rows with
`watermark < envio_checkpoint_id <= frontier`, where the watermark is the newest version the
table already holds (minus one, so a refresh that died half way through a checkpoint is
completed). Consequences:

- a row is never loaded before envio committed it, so **readers never see uncommitted rows**,
  and rows that a crash left above the frontier are deleted by envio before the frontier can
  pass them, so they are never loaded either;
- a reorg's restored state has a higher checkpoint and replaces what it reverts;
- reading the table with `FINAL` (all views do) gives, per key, the row with the highest
  version, without the deleted ones: exactly `argMax(row, envio_checkpoint_id)` over the
  committed history;
- the refresh is idempotent (loading a row twice changes nothing), so retries are safe.

The watermark comes from part metadata (the tables are partitioned by
`intDiv(_version, 10^12)`, one partition in practice, so `max(_version)` is read from the parts'
min/max index, not from the column), and the window is bounded by a primary-key-sized skip
index on the history table, so a refresh reads roughly the granules that changed.

The hourly and daily pool series use the same machinery with the key `(pool, period)`: the row
kept for a period is the pool's last version written in that period, i.e. its state at the end
of the period, exactly, from the per-block history (not from the hourly snapshots).

**Freshness.** The layer trails the indexer by at most one refresh period (1 minute) plus the
refresh's own run time. `freshness` and `analytics.py status` show both sides.

**The proof.** `analytics.py verify` stops the refreshes, takes each table's watermark `W`,
and compares the table, read with `FINAL`, against an independent computation over envio's
history: per id (per id and period for the series), `argMax` of every raw envio column by
`envio_checkpoint_id` over rows with checkpoint `<= W`, keeping ids whose latest change is a
`SET`. Both sides are compared as text, column by column, so a lossy cast would show up too.
It reports missing keys, extra keys and mismatches per column. Results:

TBD_VERIFY

`clickhouse/tests/test_mechanism.py` plays the edge cases on a synthetic envio database (rows
above the frontier; a `DELETE`; a crash whose rows envio trims and re-writes with reused
checkpoint ids; a reorg rollback; the hourly series; an indexer reset) and runs `verify` after
each step; all checks pass.

## Object catalogue

Views (the analyst API). Flows in the series are per period; `*_total` columns are cumulative
since the pool or user started.

| view | grain | what it answers |
|---|---|---|
| `chains` | chain | chain names, which deployment legacy pools there belong to, Aero chains, wound-down chains |
| `tokens` | token | symbol, decimals, current USD price, price trust (`is_price_trusted`), `is_unpriced` |
| `pool_dim` | pool | static pool facts: pair, type (`CL100`, `vAMM`, `sAMM`), tokens and decimals |
| `pools` | pool | current TVL, reserves, staked USD and share, cumulative volume / fees / swaps / rewards, fee rates, price, gauge and reward addresses |
| `pool_hourly` / `pool_daily` | pool × hour / day with a change | end-of-period TVL, reserves, staked; flows in the period: volume, fees, swaps, collected fees, emissions, rewards |
| `chain_hourly` / `chain_daily` | chain × deployment × hour / day | totals of the above; TVL and staked USD carried forward for pools without a change |
| `user_pools` | user × pool | swaps, volume, fees paid, liquidity added / removed, fees collected, rewards, LP balance, ALM |
| `user_pool_snapshots(chain_id, user)` | user × pool × active hour | a wallet's hourly history on one chain (parameterized view over envio's snapshots) |
| `positions` | CL NFT position that exists | owner, pool, range, in range, staked, token amounts and USD value at the current price |
| `venfts` / `venft_votes` | veNFT / veNFT × pool | lock amount and end, owner; current vote weights |
| `alm_wrappers` | ALM LP wrapper | its pool, LP supply and strategy position |
| `token_prices_hourly` | token × hour with a refresh | USD price, how it was obtained (`price_source`), pricing pool and depth |
| `freshness` | chain | last committed block, last pool change and price refresh, layer watermark |
| `known_data_issues` | chain × range | ranges where the indexed data is known to be wrong or incomplete |

Storage tables (exact integers, for reconciliation work; read them with `FINAL`):
`_pool`, `_token`, `_user_pool`, `_position`, `_venft`, `_venft_vote`, `_alm_wrapper`,
`_token_price`, `_pool_hour`, `_pool_day`, plus `_meta`. Column meanings follow the schema
(`docs/schema.md`), renamed to snake_case; the mapping is listed in `clickhouse/layer.py`.

Naming rules: addresses are lowercase hex everywhere in the layer (envio's ids keep checksummed
addresses and appear as `envio_id`); `chain_id` is the EVM chain id; `deployment` is
`VELODROME`, `AERODROME` (legacy Base) or `AERO`; times are `DateTime` in UTC.

## Units, types and overflow

| family | envio column | storage table | views |
|---|---|---|---|
| USD values (`*USD`, 1e18-scaled) | `String` (precision 76) | `Int256`, exact | `Float64` dollars (`*_usd`) |
| raw token amounts (reserves, volumes, collected fees, liquidity added / removed, staked reserves) | `String` | `Int256` | `Float64` whole tokens, divided by the token's decimals |
| 1e18-normalized fee amounts (`totalFeesGenerated0/1`, `totalFeesContributed0/1`) | `String` | `Int256` | `Float64` ÷ 1e18 regardless of decimals |
| reward-token amounts, votes, veNFT locks (18 decimals) | `String` | `Int256` | `Float64` ÷ 1e18; one reward token per chain, not summable across chains |
| prices (`token0Price`, `pricePerUSDNew`, `sqrtPriceX96`) | `String` | `Int256` | `Float64` |
| CL liquidity (`uint128`) | `String` | `Int256` | `Float64` |
| counters (`numberOf*`) | `String` | `UInt64` | `UInt64` totals, `Int64` per period |
| ticks, tick spacing, base fee, min stake time (precision ≤ 38) | `Decimal(24,0)` | `Int64` | `Int64` |
| fee rates (`baseFee`, `currentFee`, 1e6 scale) | `Decimal` / `String` | `Int64` / `Int256` | `Float64` percent (`*_fee_pct`) |
| timestamps | `DateTime64(3)` | `DateTime64(3)` | `DateTime` |

Why these types, from the ten-chain data (maxima over every stored version of `Pool`, 53 M
rows; `Token`, `TokenPriceSnapshot`, `NonFungiblePosition`, `ALM_LP_Wrapper` all versions):

| family | largest value seen | digits | fits `Decimal(38,0)`? |
|---|---|---|---|
| USD, cumulative (`totalVolumeUSD`) | 1.98e27 ($1.98 B) | 28 | yes, 10 orders of magnitude of headroom |
| USD, level (`totalLiquidityUSD`, `currentLiquidityStakedUSD`) | 9.97e24 ($9.97 M) | 25 | yes |
| token price (`pricePerUSDNew`) | 1.26e23 ($126 k per token) | 24 | yes (prices are capped at $1 M) |
| pricing depth (`pricingDepthUSD`) | 9.40e24 | 25 | yes |
| raw token amounts (`reserve0`, `totalVolume0`) | 7.86e32 | 33 | today, with 5 orders to spare; a token with a 1e30 supply would break it |
| 1e18-normalized fees (`totalFeesGenerated0`) | 1.11e30 | 31 | today, with 7 orders to spare |
| CL liquidity (`liquidity`, `liquidityInRange`) | 1.0e31 | 32 | no guarantee: `uint128` goes to 3.4e38 |
| pool price ratio (`token0Price`, `token1Price`) | 3.40e68 (138 rows ≥ 1e38) | 69 | **no** |
| `sqrtPriceX96` | 1.46e48 (137 rows ≥ 1e38) | 49 | **no** |
| counters (`numberOfSwaps`) | 11.6 M | 8 | yes |

So the storage tables use `Int256` for every envio `String` integer: it holds every value
below 5.79e76, and envio's Postgres column (`numeric(76,0)`) rejects anything with more than 76
digits, so **no value envio can store overflows it**. The cast is guarded: a longer string (only
possible for a `BigInt` with no precision) becomes 0 rather than wrapping around, which is what
a plain `toInt256` does, and `verify` would flag the row. The views convert to `Float64`, which
never overflows for these magnitudes (max 1.8e308) and keeps about 15–16 significant digits:
a $10 B cumulative volume is exact to a millionth of a dollar, and deltas are taken in
`Int256` before the conversion, so hourly flows do not lose precision to large totals. Use the
`*_raw` columns (or the storage tables) when you need the exact integer.

## Worked queries

Each query below was run with `analytics.py queries` against the layer installed on the
ten-chain test sync (`velo_small_legacy`: every legacy chain except Optimism and Base, from an
older commit without `deployment`, synced to TBD_DATA_DATE, still running), with the elapsed
time ClickHouse reported. That database has no Optimism or Base data, so votes, emissions and
veNFTs are empty, and no Aero pools; the Aero query was also run against an Aero-on-Base test
sync. The server was a 3-thread, 2.4 GiB ClickHouse shared with four running indexers, so the
timings are pessimistic. In production, switch the `last_day` helper to `today()`.

<!-- QUERIES:BEGIN -->
<!-- QUERIES:END -->

## Limits and data-quality caveats

**What the layer cannot answer.**

- **Anything per event.** The indexer stores aggregates, not swaps, mints or transfers, so there
  is no per-swap table: no trade sizes, no unique traders per day (only "wallets whose stats
  changed", from `user_pool_snapshots` or `last_activity`), no per-transaction or per-block
  questions. `pool_hourly` has a row per pool per hour with a change, not per trade.
- **State at an arbitrary block.** The layer keeps the current state and end-of-hour /
  end-of-day pool states. envio's per-block history (`envio_history_Pool`) has every version,
  but if the proposed TTL is adopted it keeps only the last 30 days.
- **Aero gauges, emissions, sAERO and allocations.** Not indexed yet: on `AERO` pools the gauge,
  emission and vote fields stay at their defaults (0, empty, false), and an Aero position
  staked in a gauge shows as owned by the gauge with `is_staked = false`.
- **Votes per epoch.** `venft_votes` is the current allocation; history is only in envio's
  `VeNFTPoolVoteSnapshot` (hourly, when a vote changed).
- **USD of an idle pool at today's prices.** `totalLiquidityUSD` is revalued only when the pool
  has an event, so TVL of idle pools is at their last event's prices; for a current valuation,
  value `reserve0` / `reserve1` with `tokens.price_usd` yourself.

**Where numbers are approximate.**

- **envio's hourly snapshots** (`PoolSnapshot`, `UserStatsPerPoolSnapshot`, …) are taken at the
  *first* event of an hour, and only for hours with activity: a snapshot labelled hour H is the
  state after the first event of H, not the state at the end of H − 1, so deltas between
  snapshots are shifted by one event. The layer's `pool_hourly` / `pool_daily` do not have this
  problem (they take the last version in the period from the per-block history), but
  `user_pool_snapshots` and `token_prices_hourly` come from snapshots and do.
- **Gaps are not zeros.** A pool, user or token with no change in a period has no row. Flows for
  missing periods are 0; levels (TVL, reserves, prices) carry over from the previous row.
  `chain_daily` / `chain_hourly` carry every pool forward, but a day on which no pool of a chain
  changed has no row at all.
- **Hour buckets use block time** (`lastUpdatedTimestamp`). A pool updated by a cross-chain event
  (Optimism root-gauge distribution to a leaf pool) carries the Optimism block's time.
- **A reorg can leave a ghost period.** The restored state replaces the state in its own hour;
  the hour that held only orphaned blocks keeps its row until a later change lands in it. Rare
  on these chains, and never affects `pools` (current state).
- **Position amounts and values** in `positions` are computed in `Float64` from liquidity, the
  tick range and the pool's current `sqrtPriceX96`; they ignore uncollected fees.
- **Float64 views**: about 15–16 significant digits; use `*_raw` or the storage tables for exact
  reconciliation.

**Data-quality caveats a consumer must know.**

- **USD values use pool-derived prices** (ADR 0003): a token is priced once per hour through its
  deepest qualifying pool against a lower-tier token (stablecoins at $1, then WETH, connectors,
  everything else). Below the per-chain depth floor there is no price; the last one is carried
  for 7 days and then the token reads $0 (`tokens.is_unpriced`, `price_source = 'unpriced'`).
  Volume and fees in USD are valued at the price when they happened, so a token that was
  unpriced at the time contributes $0 forever.
- **Untrusted tokens contribute $0.** Only tokens that are legacy-whitelisted, listed on Aero's
  TokenRegistry or price connectors, and not blacklisted, count in USD aggregates
  (`tokens.is_price_trusted`, ADR 0002). Query 19 lists the tokens that fall through.
- **Legacy per-user CL fee collection is credited to the position manager.** On legacy (non-Aero)
  CL pools, `CLPool.Collect` is emitted with the NFPM contract as owner, so
  `user_pools.unstaked_fees_collected_*` for legacy CL positions accrue to the NFPM address,
  not the wallet. Pool-level totals are right. Aero NFPM collections are credited to the owner.
- **Per-user staked USD is as of the user's last activity** (`staked_usd_as_of_last_activity`,
  issue #902): an idle staker is never revalued and often reads $0. Pool-level `staked_usd` is
  live for CL pools; for V2 pools it is set at gauge events and can go stale (#899).
- **Top "users" are often contracts**: routers, aggregators, vaults, gauges and the NFPM.
- **Reward-token amounts** (`emissions`, `gauge_rewards_claimed`, votes) are in each chain's own
  reward token (VELO, AERO, XVELO, …): sum the `*_usd` columns across chains, not the amounts.
- **Emissions before the oracle era read $0 in USD** for 188 legacy pools (#738) though the token
  amounts are right; leaf-chain emissions need Optimism's root gauges in the same sync.
- **Superseed blocks 10,313,359 to 10,521,629** (about 2025-05-08 to 05-13) came from a
  non-canonical fork in HyperSync; mints and liquidity events are missing, and Superseed pool,
  position and user numbers are wrong from then on (`known_data_issues`).
- **Wound-down chains** (Lisk, Superseed, Swell) stop at their `end_block`; their freshness looks
  stale by design.
- **Fee rates**: `current_fee_pct` is the rate the latest swap paid (dynamic fees move it);
  `base_fee_pct` is the configured fee. CL swaps whose fee could not be derived are counted in
  `_pool.swap_fee_fallbacks` (should stay 0).
- **Older schemas**: on an indexer built before `Pool.deployment` existed, the layer derives it
  from the chain (Base → `AERODROME`, else `VELODROME`), which is right for legacy pools only.

## Proposals for envio's own ClickHouse tables

TBD_PROPOSALS
