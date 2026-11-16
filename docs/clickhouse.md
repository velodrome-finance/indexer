# Querying the indexer in ClickHouse

This guide is for analysts who query the indexer's ClickHouse database with SQL. It covers how
to connect, the analytics layer (typed tables and views built on top of what envio writes), the
units and types, worked queries for the questions the protocol team asks most, and what the
data cannot tell you. The GraphQL API and the meaning of every entity are described in
[`querying.md`](querying.md) (including
[Aero gauges, emissions and governance](querying.md#aero-gauges-emissions-and-governance)); the
field reference is [`schema.md`](schema.md). This guide does not repeat them.

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
  newest. On the ten-chain test database (764 pools and 54 M `Pool` versions at the time) a
  `GROUP BY chainId` over it took **35.6 s and read 4.6 GiB**; in production (27.6 M versions of
  a single pool, 248 GiB of `Pool` history) the same query ran out of memory at 32 GiB. The
  layer's `pools` view answers it in under 0.1 s (query 1 below).
- **Numbers are strings.** Every `BigInt` declared with `precision` above 38 (almost all of them
  here) is a `String` column (upstream enviodev/hyperindex#1816). Sums need casts, sorting is
  lexicographic, and every value still needs scaling (USD by 1e18, token amounts by the token's
  decimals).
- **Snapshots and events are sorted by id.** Ids start with the chain and an address or a
  transaction hash, so "one pool's history", "one user's history" or "one gauge's events" read
  the whole table, and a reorg can leave a rolled-back row next to its replacement.

The layer is a set of typed storage tables, kept up to date from envio's history tables, and
analyst views on top of them. It lives in its own database (`analytics_<indexer database>` by
default) and never writes to envio's (one opt-in command, `history-ttl`, is the exception).

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
database; run `USE analytics_velo_<instance>` or qualify the names. A read-only `reader` user
exists for the protocol team (SELECT/SHOW only); its password is in the stack's secret file,
not in this repository.

Everything below lives in the analytics database. Two views read envio's database directly
(`user_pool_snapshots`, `freshness`) and so do the typed event views (`aero_*_events`,
`saero_position_events`, `aero_*_snapshots`): a read-only user needs `SELECT` on both databases.

## Installing and operating the layer

Everything is in [`clickhouse/`](../clickhouse): `analytics.py` (the CLI, Python 3.9+ standard
library only), `layer.py` (the column mapping of the core tables), `schema_map.py` (the field by
field mapping of the Aero tables, read from `schema.graphql`), `sql/views.sql` and
`sql/views_aero.sql` (the analyst views), `queries/` (the worked queries below), `tests/` and
`proposals/` (schema patches for envio, see the last section).

Connection settings come from the environment, the same variables the indexer reads:

| variable | meaning |
|---|---|
| `ENVIO_CLICKHOUSE_HOST` | URL of the ClickHouse HTTP interface, e.g. `https://host:8443` |
| `ENVIO_CLICKHOUSE_USERNAME` / `ENVIO_CLICKHOUSE_PASSWORD` | a user that can read the indexer database and create the analytics one |
| `ENVIO_CLICKHOUSE_DATABASE` | the indexer's database (read only) |
| `ANALYTICS_DATABASE` | optional, default `analytics_<indexer database>` |

```bash
python3 clickhouse/analytics.py install   # create or upgrade; backfill what is not loaded yet; start the refreshes
python3 clickhouse/analytics.py status    # per table: watermark, commit frontier, source rows still to load, refresh state
python3 clickhouse/analytics.py verify    # prove each table equals argMax over envio's history (see below)
python3 clickhouse/analytics.py refresh   # run every refresh now and wait for it
python3 clickhouse/analytics.py rebuild   # drop the layer's tables and install again (full backfill)
python3 clickhouse/analytics.py drop      # drop the analytics database
python3 clickhouse/analytics.py render    # print the SQL install would run, without running it
python3 clickhouse/analytics.py queries   # run clickhouse/queries/*.sql twice each, print rows and timings
python3 clickhouse/analytics.py history-ttl [--days 30] [--apply]   # see "Proposals" below
python3 clickhouse/tests/test_mechanism.py --template <an envio database>   # edge-case test
```

On the dev box, `velo env <instance> --show-secrets` prints the variables for an instance.

**`install` is idempotent.** Run it after deploying a new version of the layer, after an
indexer reset, or whenever in doubt. It:

1. creates the analytics database and a `_meta` table (source database, envio instance id,
   which tables finished their backfill, a digest of each table's definition);
2. **rebuilds from scratch when the indexer was reset** (envio writes a new instance id to
   `envio_info` on every fresh start), and rebuilds a single table whose definition changed
   (new layer version or new indexer schema);
3. creates each storage table and, if its backfill has not completed, loads it from the history
   up to the current commit frontier, in chunks of about 2 M source rows cut at primary-index
   marks (`ANALYTICS_BACKFILL_CHUNK_ROWS`); a backfill cut off half way starts that table again;
4. creates one refreshable materialized view per table (`_refresh_<table>`, every minute,
   `ANALYTICS_REFRESH_EVERY`) that appends what envio committed since the table's watermark;
5. creates or replaces the views (the Aero ones only where the indexer has Aero gauges).

**Backfill from existing history** is what the first `install` does. On the ten-chain test
database (85 M `Pool` versions, 164 M `UserStatsPerPool` versions) it took about 16 minutes on
a 4-thread server shared with four indexers: `_pool` 156 s, `_user_pool` 269 s, `_pool_hour`
258 s, `_pool_day` 207 s, the rest under a minute. It scales with the history size: expect a
few hours for production's 248 GiB of `Pool` history. **Rebuild** = `rebuild` (drop and backfill
again). **After an indexer reset** envio empties its database; the refreshes stop loading
(their source no longer matches the recorded instance id), `status` prints `STALE`, and the next
`install` rebuilds once the new run has written its first batch. Running `install` from cron
(hourly) automates that. During a long resync the refreshes then carry the load, at most
500,000 checkpoints per refresh (`ANALYTICS_MAX_CHECKPOINTS_PER_REFRESH`); if they fall behind
(`status` shows `source_rows_behind` growing), `rebuild` once the indexer reaches the head is
faster than catching up.

Requirements: ClickHouse 24.10 or later (refreshable materialized views, `mergeTreeIndex`,
`keccak256`); a user with `CREATE DATABASE` (or an analytics database created for you) and
`SELECT` on the indexer database. The analytics database must not be the indexer's: a reset
runs `TRUNCATE DATABASE` on it. The CLI runs single-threaded backfill inserts of small blocks
and retries a statement the server killed for lack of memory or a restart (every statement it
sends is safe to repeat); raise `ANALYTICS_MAX_THREADS` / `ANALYTICS_MAX_MEMORY` on a bigger
server.

## How the layer stays exact

**What envio writes.** Each batch is inserted into the history tables (one row per entity per
block it changed in, `envio_change` = `SET` or `DELETE`, `envio_checkpoint_id` increasing,
shared by all chains), then one row per chain into `envio_chains` (a `ReplacingMergeTree`) moves
the *commit frontier*, the highest committed checkpoint. Rows above the frontier belong to a
batch still in flight; if the indexer dies before committing, the next start deletes them
(`ALTER TABLE … DELETE` on resume) and re-runs the batch, reusing the same checkpoint ids. A
reorg deletes nothing in ClickHouse: envio writes the restored state (or a `DELETE` for entities
the reorg created) as new rows at a later checkpoint.

**What the layer does.** Each storage table is a `ReplacingMergeTree(_version, _deleted)` keyed
by the entity's natural key (derived from envio's id, so `DELETE` rows, which carry only the
id, land on the right key). `_version` is `envio_checkpoint_id`, `_deleted` is
`envio_change = 'DELETE'`. Its refresh reads only history rows with
`watermark < envio_checkpoint_id <= frontier`, where the watermark is the newest version the
table already holds (minus one, so a refresh that died half way through a checkpoint is
completed). Consequences:

- a row is never loaded before envio committed it, so **readers never see uncommitted rows**;
  rows a crash left above the frontier are deleted by envio before the frontier can pass them,
  so they are never loaded either;
- a reorg's restored state has a higher checkpoint and replaces what it reverts;
- reading a table with `FINAL` (every view does) gives, per key, the row with the highest
  version, without deleted ones: exactly `argMax(row, envio_checkpoint_id)` over the committed
  history;
- a refresh is idempotent (loading a row twice changes nothing), so retries are safe.

The watermark comes from part metadata (the tables are partitioned by
`intDiv(_version, 10^12)`, one partition in practice, so `max(_version)` is read from the parts'
min/max index, not from the column), and the history's checkpoint skip index limits a refresh
to the granules that changed.

The pool series (`_pool_hour`, `_pool_day`) and the Aero series (`_aero_gauge_day`,
`_aero_leaf_voter_day`) use the same machinery with the key `(entity, period)`: the row kept for
a period is the entity's last version written in that period, its exact end-of-period state from
the per-block history (not from the hourly snapshots). Each row also stores the counters' values
at the end of the entity's previous period (`prev_*`), so a period's flow is a subtraction:
the views need no window function, and filters on chain, pool, gauge and time reach the tables'
sort keys (ClickHouse does not push filters through window functions).

**Freshness.** The layer trails the indexer by at most one refresh period (1 minute) plus the
refresh's own run time; `freshness` and `analytics.py status` show both sides. On the Aero test
sync, which was backfilling at 20,000 to 30,000 checkpoints a minute, the refreshes stayed
within a minute or two of the frontier; over 30 minutes the 26 refreshes took 0.5–4.6 s each
per run (mean), reading up to 460 k rows to write about 1 k (the series also read the previous
period of each pool they touch). At the head of a live chain the windows are far smaller.

**The proof.** `analytics.py verify` stops the refreshes, takes each table's watermark `W`,
and compares the table, read with `FINAL`, against an independent computation over envio's
history: per id (per id and period for the series), `argMax` of every raw envio column by
`envio_checkpoint_id` over rows with checkpoint `<= W`, keeping ids whose latest change is a
`SET`; for the series also the previous period's values (`lagInFrame` over the periods). Both
sides are compared as text, column by column, so a lossy cast would show up too. It reports
keys missing from the layer, extra keys and mismatches per column. Results:

<!-- VERIFY:BEGIN -->
| database | how the layer was loaded | keys compared | result |
|---|---|---|---|
| ten-chain sync (`velo_small_legacy`, older schema, 4b48e15) | backfill, then refreshes while the indexer ran to the head | 843 pools (78 columns), 425 tokens, 2,327,201 user-pool rows, 700,789 positions, 49 ALM wrappers, 1,290,632 token-price hours, 1,843,264 pool-hours and 165,701 pool-days (56 columns incl. `prev_*`) | all equal, 0 missing, 0 extra (verify took 38 min) |
| Aero sync (`velo_aero_all`, a397cc0, seven Aero chains) | backfill at checkpoint 103 k, then refreshes up to 672 k while the indexer was backfilling | 1,096 pools, 148,196 user-pool rows, 31,414 positions, 36,878 pool-hours, every Aero table (477 gauges, 17,324 sAERO positions, 28,527 root allocations, 23,643 leaf allocations, 2,170 gauge-days, …) | all equal |
| three-chain sync (`velo_verify`, 4b48e15) | backfill | 906,204 user-pool rows, 597,097 pool-hours, … | all equal |
| Metal sync with the proposed schema (custom `orderBy`, `Decimal(38,0)` sources) | backfill | 18 pools, 3,733 user-pool rows, 512 positions, 54,363 token prices, 30,960 pool-hours | all equal |
<!-- VERIFY:END -->

`clickhouse/tests/test_mechanism.py` plays the edge cases on a synthetic envio database (rows
above the frontier; a `DELETE`; a crash whose rows envio trims and re-writes under reused
checkpoint ids; a reorg rollback; hourly series and their `prev_` values across refreshes; an
indexer reset) and runs `verify` after each step. All checks pass.

## Object catalogue

Views (the analyst API). Flows in the series are per period; `*_total` columns are cumulative.

| view | grain | what it answers |
|---|---|---|
| `chains` | chain | chain names, which deployment legacy pools there belong to, Aero chains, wound-down chains |
| `tokens` | token | symbol, decimals, current USD price, price trust (`is_price_trusted`), `is_unpriced` |
| `pool_dim` | pool | static pool facts: pair, type (`CL100`, `vAMM`, `sAMM`), tokens and decimals |
| `pools` | pool | current TVL, reserves, staked USD and share, cumulative volume / fees / swaps / rewards, fee rates, price, gauge |
| `pool_hourly` / `pool_daily` | pool × hour / day with a change | end-of-period TVL, reserves, staked; flows in the period: volume, fees, swaps, collected fees, emissions, rewards |
| `chain_hourly` / `chain_daily` | chain × deployment × hour / day | totals of the above; TVL and staked USD carried forward for pools without a change |
| `user_pools` | user × pool | swaps, volume, fees paid, liquidity added / removed, fees collected, rewards, LP balance, ALM |
| `user_pool_snapshots(chain_id, user)` | user × pool × active hour | a wallet's hourly history on one chain (parameterized view over envio's snapshots) |
| `positions` | CL NFT position that exists | owner, pool, range, in range, staked, token amounts and USD value at the current price |
| `venfts` / `venft_votes` | veNFT / veNFT × pool | legacy lock amount and end, owner; current vote weights |
| `alm_wrappers` | ALM LP wrapper | its pool, LP supply and strategy position |
| `token_prices_hourly` | token × hour with a refresh | USD price, how it was obtained (`price_source`), pricing pool and depth |
| `aero_gauges` | Aero gauge | cap per day, weight, allocations, emissions credited / minted / forfeited / unpaid, fees sent to voters, its pool's TVL and staked share |
| `aero_gauge_daily` | Aero gauge × day with a change | emissions credited / minted / forfeited (AERO and USD, also at Base AERO's price), stake activity, the pool's fees and TVL that day |
| `aero_chain_daily` | chain × day | the LeafVoter's ledger: emissions credited / minted / forfeited, surplus, redemptions, xAERO outstanding, allocation budget booked and idle |
| `saero_positions` | sAERO position | amount, lock end, permanent, voting power now |
| `aero_allocation_books` | sAERO position × chain | root Voter booking against the chain's LeafVoter budget and split |
| `aero_gauge_allocations` | position × gauge | booked allocation per gauge |
| `aero_voting_rewards` | rewards manager | fees and incentives collected and claimed (USD) |
| `aero_migration` | migration contract | veNFTs and liquid tokens migrated, settlements |
| `base_aero_price_daily` | day | mean fresh price of AERO on Base, for valuing xAERO |
| `aero_gauge_stake_events`, `aero_emissions_events`, `aero_allocation_events`, `saero_position_events`, `aero_voting_rewards_events`, `aero_redemption_events`, `aero_minter_events`, `aero_migration_events` | event | the typed events, one row each, committed rows only, reorg-deleted ones removed |
| `aero_gauge_snapshots`, `aero_leaf_voter_state_snapshots`, `saero_escrow_state_snapshots`, `aero_minter_snapshots` | entity × active hour | typed hourly snapshots |
| `freshness` | chain | last committed block, last pool change and price refresh, layer watermark |
| `known_data_issues` | chain × range | ranges where the indexed data is known to be wrong or incomplete |

Storage tables (exact integers, for reconciliation; read them with `FINAL`): `_pool`, `_token`,
`_user_pool`, `_position`, `_venft`, `_venft_vote`, `_alm_wrapper`, `_token_price`,
`_pool_hour`, `_pool_day`, and for Aero `_aero_gauge`, `_aero_gauge_factory`,
`_aero_leaf_voter`, `_aero_voting_rewards_manager`, `_aero_incentive_program`,
`_saero_position`, `_saero_escrow`, `_aero_root_allocation`, `_aero_root_gauge_vote`,
`_aero_root_chain`, `_aero_leaf_token`, `_aero_leaf_allocation`, `_aero_minter`,
`_aero_migration_totals`, `_aero_gauge_day`, `_aero_leaf_voter_day`, plus `_meta`. Core column
names follow the schema renamed for analysts (mapping in `clickhouse/layer.py`); Aero column
names are envio's field names in snake_case (`totalEmissionsMinted` → `total_emissions_minted`).

Naming rules: addresses are lowercase hex everywhere in the layer (envio's ids keep checksummed
addresses and appear as `envio_id` or `id`); `chain_id` is the EVM chain id; `deployment` is
`VELODROME`, `AERODROME` (legacy Base) or `AERO`; times are UTC.

## Units, types and overflow

| family | envio column | storage table | views |
|---|---|---|---|
| USD values (`*USD`, 1e18-scaled) | `String` (precision 76) | `Int256`, exact | `Float64` dollars (`*_usd`) |
| raw token amounts (reserves, volumes, collected fees, liquidity added / removed, staked reserves) | `String` | `Int256` | `Float64` whole tokens, divided by the token's decimals |
| 1e18-normalized fee amounts (`totalFeesGenerated0/1`, `totalFeesContributed0/1`) | `String` | `Int256` | `Float64` ÷ 1e18 regardless of decimals |
| legacy reward-token amounts, votes, veNFT locks (18 decimals) | `String` | `Int256` | `Float64` ÷ 1e18; one reward token per chain, not summable across chains |
| Aero amounts (emissions, caps, allocations, sAERO, migration; AERO or xAERO, 18 decimals) | `String` | `Int256` | `Float64` ÷ 1e18 in the Aero views; summable across chains as AERO-equivalent |
| prices (`token0Price`, `pricePerUSDNew`, `sqrtPriceX96`) | `String` | `Int256` | `Float64` |
| CL liquidity (`uint128`) | `String` | `Int256` | `Float64` |
| counters (`numberOf*`) | `String` | `UInt64` | `UInt64` totals, `Int64` per period |
| ticks, tick spacing, base fee, min stake time (precision ≤ 38) | `Decimal(24,0)` | `Int64` | `Int64` |
| fee rates (`baseFee`, `currentFee`, 1e6 scale) | `Decimal` / `String` | `Int64` / `Int256` | `Float64` percent (`*_fee_pct`) |
| timestamps | `DateTime64(3)` | `DateTime64(3)` | `DateTime` |

Why these types, from the ten-chain data (maxima over every stored version of `Pool`, 53 M rows
when measured; current `UserStatsPerPool`, 2.3 M rows; all versions of `Token`,
`TokenPriceSnapshot`, `NonFungiblePosition` and `ALM_LP_Wrapper`):

| family | largest value seen | digits | fits `Decimal(38,0)`? |
|---|---|---|---|
| USD, cumulative (`totalVolumeUSD`; per user `totalLiquidityAddedUSD`) | 1.98e27 ($1.98 B); per user 2.1e28 ($21 B, a vault cycling liquidity) | 28–29 | yes, 9–10 orders of magnitude of headroom |
| USD, level (`totalLiquidityUSD`, `currentLiquidityStakedUSD`) | 9.97e24 ($9.97 M) | 25 | yes |
| token price (`pricePerUSDNew`) | 1.26e23 ($126 k per token) | 24 | yes (prices are capped at $1 M) |
| pricing depth (`pricingDepthUSD`) | 9.40e24 | 25 | yes |
| raw token amounts (`reserve0`, `totalVolume0`, per-user liquidity added) | 7.86e32 | 33 | today, with 5 orders to spare; a token with a 1e30 supply would break it |
| 1e18-normalized fees (`totalFeesGenerated0`) | 1.11e30 | 31 | today, with 7 orders to spare |
| CL liquidity (`liquidity`, `liquidityInRange`) | 1.0e31 | 32 | no guarantee: `uint128` goes to 3.4e38 |
| pool price ratio (`token0Price`, `token1Price`) | 3.40e68 (138 rows ≥ 1e38) | 69 | **no** |
| `sqrtPriceX96` | 1.46e48 (137 rows ≥ 1e38) | 49 | **no** |
| counters (`numberOfSwaps`) | 11.6 M | 8 | yes |

So the storage tables use `Int256` for every envio `String` integer: it holds every value
below 5.79e76, and envio's Postgres column (`numeric(76,0)`) rejects anything with more than 76
digits, so **no value envio can store overflows it**. The cast is guarded: a longer string (only
possible for a `BigInt` with no precision) becomes 0 instead of silently wrapping around (which
is what a plain `toInt256` does), and `verify` reports the row. The views convert to `Float64`,
which never overflows for these magnitudes (max 1.8e308) and keeps 15–16 significant digits: a
$10 B cumulative volume is exact to a millionth of a dollar, and period deltas are taken in
`Int256` before the conversion, so hourly flows do not lose precision to large totals. Use the
`*_raw` columns or the storage tables when you need the exact integer.

## Worked queries

Each query below is a file in `clickhouse/queries/` and was run twice with
`analytics.py queries`; the elapsed time is ClickHouse's own, the better of the two runs (the
first is usually within 2× of it). Queries 1–25 ran against the layer on the ten-chain test sync
(`velo_small_legacy`: every legacy chain except Optimism and Base, from an older commit without
`deployment`, synced to the head of 2026-11-13, ≈ 160 M source rows). Queries 26–31 ran against
the Aero test sync (`velo_aero_all`: the seven Aero chains from 2026-10-21, at a397cc0, still
backfilling when measured), which also ran 1–25. The server was a 4-thread ClickHouse capped at
5.6 GiB and shared with four indexers. Dates in the queries are relative to the last day of data;
in production use `today()`.

<!-- QUERIES:BEGIN -->

### 1. TVL now, by chain and deployment

```sql
SELECT chain_name, deployment, count() AS pools, countIf(tvl_usd > 0) AS pools_with_tvl,
       round(sum(tvl_usd)) AS tvl, round(sum(staked_usd)) AS staked
FROM pools
GROUP BY chain_name, deployment
ORDER BY tvl DESC
```

Ten-chain sync: **10 rows, 0.100 s** (first run 0.655 s; read 4.3 krows, 503.6 kB). Aero sync: **7 rows, 0.055 s** (first run 0.142 s; read 6.8 krows, 743.3 kB). Production: `pools` is one row per pool (≈ 44 k) read with FINAL plus two token joins, so this stays well under a second; it does not depend on the 248 GiB of `Pool` history.

### 2. Daily volume, fees and swaps per chain over the last 30 days of data

```sql
-- (in production replace last_day with today())
WITH (SELECT max(day) FROM chain_daily) AS last_day
SELECT day, chain_name, deployment, round(volume_usd) AS volume, round(fees_usd) AS fees, swaps, active_pools
FROM chain_daily
WHERE day > last_day - 30
ORDER BY day DESC, volume DESC
```

Ten-chain sync: **228 rows, 0.356 s** (first run 0.369 s; read 400.1 krows, 52.9 MB). Aero sync: **41 rows, 0.112 s** (first run 0.124 s; read 19.3 krows, 2.3 MB). Production: `chain_daily` recomputes deltas over every pool-day (`pool_daily`, a few million rows at production scale) before aggregating; expect seconds. If dashboards poll it, materialize `chain_daily` into a table on a schedule.

### 3. Monthly volume and fees by deployment (legacy Velodrome / Aerodrome, Aero), all chains

```sql
SELECT toStartOfMonth(day) AS month, deployment,
       round(sum(volume_usd)) AS volume, round(sum(fees_usd)) AS fees, sum(swaps) AS swap_count
FROM chain_daily
GROUP BY month, deployment
ORDER BY month, deployment
```

Ten-chain sync: **31 rows, 0.164 s** (first run 0.164 s; read 200.0 krows, 40.7 MB). Aero sync: **2 rows, 0.049 s** (first run 0.049 s; read 9.7 krows, 1.5 MB). Production: same cost as query 2 (it reads all of `pool_daily`).

### 4. TVL per chain at the end of each week (carry-forward of every pool's last state)

```sql
SELECT week, chain_name, round(sum(tvl)) AS tvl_end_of_week
FROM (SELECT chain_name, deployment, toStartOfWeek(day) AS week, argMax(tvl_usd, day) AS tvl
      FROM chain_daily GROUP BY chain_name, deployment, week)
GROUP BY week, chain_name
ORDER BY week, chain_name
```

Ten-chain sync: **970 rows, 0.198 s** (first run 0.309 s; read 200.0 krows, 24.9 MB). Aero sync: **15 rows, 0.076 s** (first run 0.076 s; read 9.7 krows, 1.1 MB). TVL is the carried-forward sum of the pools' last known `totalLiquidityUSD`, which the indexer revalues only when a pool has an event. Production: as query 2.

### 5. Top 20 pools by TVL now

```sql
SELECT chain_name, deployment, pair, pool_type, pool_address, round(tvl_usd) AS tvl,
       round(staked_share, 3) AS staked_frac, round(volume_usd_total) AS lifetime_volume, current_fee_pct
FROM pools
ORDER BY tvl_usd DESC
LIMIT 20
```

Ten-chain sync: **20 rows, 0.070 s** (first run 0.104 s; read 4.3 krows, 634.6 kB). Aero sync: **20 rows, 0.110 s** (first run 0.148 s; read 6.8 krows, 925.8 kB). Production: as query 1.

### 6. Top 20 pools by volume in the last 7 days of data, with fees and fee APR on average TVL

```sql
WITH (SELECT max(day) FROM chain_daily) AS last_day
SELECT chain_name, pair, pool_type, pool_address,
       round(sum(volume_usd)) AS volume_7d, round(sum(fees_usd)) AS fees_7d, round(avg(tvl_usd)) AS avg_tvl,
       round(if(avg(tvl_usd) > 0, sum(fees_usd) / avg(tvl_usd) * 365 / 7, NULL), 4) AS fee_apr
FROM pool_daily
WHERE day > last_day - 7
GROUP BY chain_name, pair, pool_type, pool_address
ORDER BY volume_7d DESC
LIMIT 20
```

Ten-chain sync: **20 rows, 0.248 s** (first run 0.248 s; read 400.1 krows, 55.9 MB). Aero sync: **20 rows, 0.087 s** (first run 0.342 s; read 19.3 krows, 2.4 MB). Production: the window over `pool_daily` covers all pools and days before the date filter applies (the filter cannot be pushed below the delta computation); add `chain_id` to the WHERE clause to cut it to one chain.

### 7. One pool's last 168 hourly rows (WETH/weETH, the deepest pool on Ink here)

```sql
-- Give the pool as a literal or a scalar subquery `pool_address = (SELECT ...)`: a WITH alias
-- is not pushed down to the table's sort key and makes the query read every pool.
SELECT hour, tvl_usd, volume_usd, fees_usd, swaps, price0_in_token1, staked_share
FROM pool_hourly
WHERE chain_id = 57073 AND pool_address = '0xf9349c5af43d2abc2758e90cfb341722116fac38'
ORDER BY hour DESC
LIMIT 168
```

Ten-chain sync: **168 rows, 0.140 s** (first run 0.142 s; read 21.9 krows, 6.2 MB). Aero sync: **0 rows, 0.047 s** (first run 0.047 s; read 6.4 krows, 1.3 MB). Filters on chain_id and pool_address reach `_pool_hour`'s sort key (no window function in the view), so this reads one pool's rows plus the small pool and token dimensions. Give the pool as a literal or a scalar subquery: a value bound with `WITH ... AS pool` is not used for index analysis and the query then reads every pool. Production: a busy Base pool has up to 24 rows a day; milliseconds.

### 8. One pool's full daily history with cumulative totals (USDC/WETH, the busiest pool on Unichain here)

```sql
SELECT day, tvl_usd, reserve0, reserve1, volume_usd, volume_usd_total, fees_usd, swaps
FROM pool_daily
WHERE chain_id = 130 AND pool_address = '0x5438e884c621d5db08fa605b53ca04c5b33a623a'
ORDER BY day
```

Ten-chain sync: **625 rows, 0.109 s** (first run 0.130 s; read 15.3 krows, 4.1 MB). Aero sync: **0 rows, 0.073 s** (first run 0.073 s; read 9.7 krows, 2.0 MB). Production: one pool's daily rows; milliseconds.

### 9. Fees generated versus emissions (USD) per chain and month: are emissions buying volume?

```sql
SELECT toStartOfMonth(day) AS month, chain_name,
       round(sum(fees_usd)) AS fees, round(sum(emissions_usd)) AS emissions,
       round(sum(gauge_rewards_claimed_usd)) AS gauge_rewards_claimed,
       round(sum(bribes_claimed_usd) + sum(fee_rewards_claimed_usd)) AS voter_rewards_claimed,
       round(if(emissions > 0, fees / emissions, NULL), 3) AS fees_per_emission_dollar
FROM chain_daily
GROUP BY month, chain_name
ORDER BY month, chain_name
```

Ten-chain sync: **233 rows, 0.186 s** (first run 0.186 s; read 200.0 krows, 62.8 MB). Aero sync: **7 rows, 0.063 s** (first run 0.253 s; read 9.7 krows, 1.1 MB). The ten-chain data has no Optimism, where the leaf chains' gauges get their emissions from (root gauges), so emissions read 0 here. Production: as query 2. Emissions are legacy-gauge only; Aero gauges are not indexed yet.

### 10. Pools ranked by lifetime emissions (USD) against the fees they generated

```sql
SELECT chain_name, pair, pool_address, round(emissions_usd_total) AS emissions, round(fees_usd_total) AS fees,
       round(gauge_rewards_claimed_usd_total) AS gauge_rewards_claimed,
       round(if(emissions_usd_total > 0, fees_usd_total / emissions_usd_total, NULL), 3) AS fees_per_emission_dollar
FROM pools
WHERE emissions_usd_total > 0 OR gauge_rewards_claimed_usd_total > 0
ORDER BY emissions_usd_total DESC, gauge_rewards_claimed_usd_total DESC
LIMIT 20
```

Ten-chain sync: **20 rows, 0.078 s** (first run 0.114 s; read 4.3 krows, 507.9 kB). Aero sync: **0 rows, 0.064 s** (first run 0.064 s; read 6.8 krows, 681.0 kB). Empty on the ten-chain data for the reason given in query 9. Production: as query 1.

### 11. A wallet's open CL positions on Ink with current amounts and value (addresses are lowercase)

```sql
SELECT chain_name, pair, pool_type, nfpm_address, token_id, tick_lower, tick_upper, in_range, is_staked,
       amount0, amount1, value_usd, last_updated
FROM positions
WHERE chain_id = 57073 AND owner = '0x19df5d96f5024f53459a282260cead38e8feb3b5' AND liquidity > 0
ORDER BY value_usd DESC
LIMIT 50
```

Ten-chain sync: **50 rows, 0.254 s** (first run 0.386 s; read 231.2 krows, 29.6 MB). Aero sync: **0 rows, 0.127 s** (first run 0.330 s; read 0 rows, 0 B). Production: `_position` is sorted by (chain, NFPM, token id) with a bloom index on owner; one owner's positions read only the granules that hold them, but the view also joins every pool's current price and the tokens (tens of thousands of rows): well under a second.

### 12. A wallet's activity in every pool on a chain: swaps, volume, fees paid, liquidity, rewards

```sql
SELECT chain_name, pair, pool_type, swaps_total, swap_volume_usd_total, fees_paid_usd_total,
       liquidity_added_usd_total, liquidity_removed_usd_total, gauge_rewards_claimed_usd_total,
       first_activity, last_activity
FROM user_pools
WHERE chain_id = 57073 AND user_address = '0xe244b3bdd6f452e03958f76d2b9c66ccd9c53288'
ORDER BY swap_volume_usd_total DESC
LIMIT 50
```

Ten-chain sync: **26 rows, 0.081 s** (first run 0.152 s; read 29.4 krows, 6.8 MB). Aero sync: **0 rows, 0.180 s** (first run 0.180 s; read 11.4 krows, 2.5 MB). `_user_pool` is sorted by (chain_id, user_address, pool_address): with both filters it reads one slice. Without chain_id it scans the user_address column (tens of millions of rows in production): add the chain when you can. Note that per-user swap stats are keyed by the address the pool sees, often a router.

### 13. A wallet's hourly snapshots on one chain (parameterized view; any address case works)

```sql
SELECT hour, pool_address, swaps_total, swap_volume_usd_total, liquidity_added_usd_total, lp_balance
FROM user_pool_snapshots(chain_id = 57073, user = '0xE244B3BDD6F452E03958F76D2B9C66CCD9C53288')
ORDER BY hour DESC
LIMIT 100
```

Ten-chain sync: **100 rows, 0.058 s** (first run 0.285 s; read 24.6 krows, 3.9 MB). Aero sync: **0 rows, 0.124 s** (first run 0.453 s; read 19 rows, 380 B). Reads only ids starting with the checksummed `{chainId}-{user}` prefix of envio's `UserStatsPerPoolSnapshot`. Production (244 M rows): milliseconds, independent of table size.

### 14. Top 10 wallets by swap volume on each chain (routers and aggregators show up here)

```sql
SELECT chain_name, user_address, round(volume) AS volume_usd_all_pools, swap_count, pool_count
FROM (
  SELECT chain_name, user_address, sum(swap_volume_usd_total) AS volume, sum(swaps_total) AS swap_count, count() AS pool_count
  FROM user_pools
  GROUP BY chain_name, user_address
)
ORDER BY chain_name, volume DESC
LIMIT 10 BY chain_name
```

Ten-chain sync: **100 rows, 1.203 s** (first run 1.508 s; read 2.6 Mrows, 365.5 MB). Aero sync: **70 rows, 0.130 s** (first run 0.293 s; read 235.6 krows, 33.3 MB). Production: a full aggregation of `_user_pool` (one row per user and pool, tens of millions): seconds and a few hundred MB; restrict to one chain for interactive use.

### 15. One token's hourly USD price, with where each price came from (WETH on Unichain here)

```sql
SELECT hour, price_usd, price_source, pricing_pool_id, pricing_depth_usd
FROM token_prices_hourly
WHERE chain_id = 130 AND token_address = '0x4200000000000000000000000000000000000006'
ORDER BY hour DESC
LIMIT 168
```

Ten-chain sync: **168 rows, 0.039 s** (first run 0.081 s; read 41.4 krows, 7.1 MB). Aero sync: **0 rows, 0.029 s** (first run 0.039 s; read 12.0 krows, 1.9 MB). `_token_price` is sorted by (chain_id, token_address, key): one token's rows only. Production (26 M snapshots): milliseconds.

### 16. Daily open / high / low / close of a token's hourly prices (fresh prices only)

```sql
SELECT toDate(hour) AS day, any(symbol) AS token,
       argMin(price_usd, hour) AS open, max(price_usd) AS high, min(price_usd) AS low, argMax(price_usd, hour) AS close,
       count() AS fresh_hours
FROM token_prices_hourly
WHERE chain_id = 130 AND token_address = '0x4200000000000000000000000000000000000006' AND is_fresh
GROUP BY day
ORDER BY day DESC
LIMIT 60
```

Ten-chain sync: **60 rows, 0.035 s** (first run 0.084 s; read 41.4 krows, 4.4 MB). Aero sync: **0 rows, 0.026 s** (first run 0.032 s; read 12.0 krows, 1.2 MB). Only hours in which the price was freshly obtained count (`is_fresh`). Production: as query 15.

### 17. Legacy versus Aero share of volume, fees and TVL per day since the Aero launch (2026-10-21)

```sql
SELECT day,
       round(sumIf(volume_usd, deployment = 'AERO') / sum(volume_usd), 4) AS aero_volume_share,
       round(sumIf(fees_usd, deployment = 'AERO') / sum(fees_usd), 4) AS aero_fee_share,
       round(sumIf(tvl_usd, deployment = 'AERO') / sum(tvl_usd), 4) AS aero_tvl_share,
       round(sum(volume_usd)) AS total_volume
FROM chain_daily
WHERE day >= '2026-10-21'
GROUP BY day
ORDER BY day
```

Ten-chain sync: **24 rows, 0.172 s** (first run 0.263 s; read 200.0 krows, 50.2 MB). Aero sync: **7 rows, 0.059 s** (first run 0.059 s; read 9.7 krows, 1.8 MB). On the ten-chain sync every pool is legacy (its schema predates `deployment`; Aero pools on Ink are not in that config), so the Aero shares are 0 there; on the Aero sync every pool is AERO. In production both kinds are on the same chains and the shares are meaningful. Production: as query 2, restricted to days since the launch.

### 18. Share of TVL staked in gauges per chain, now and at the end of each of the last 6 months of data

```sql
SELECT chain_name, 'now' AS at, round(sum(staked_usd) / sum(tvl_usd), 4) AS staked_frac
FROM pools GROUP BY chain_name
UNION ALL
SELECT chain_name, toString(month) AS at, round(sum(staked) / sum(tvl), 4) AS staked_frac
FROM (SELECT chain_name, deployment, toStartOfMonth(day) AS month, argMax(staked_usd, day) AS staked, argMax(tvl_usd, day) AS tvl
      FROM chain_daily GROUP BY chain_name, deployment, month)
WHERE month > (SELECT max(day) FROM chain_daily) - INTERVAL 6 MONTH
GROUP BY chain_name, month
ORDER BY chain_name, at
```

Ten-chain sync: **65 rows, 0.311 s** (first run 0.373 s; read 404.3 krows, 50.3 MB). Aero sync: **14 rows, 0.115 s** (first run 0.159 s; read 26.1 krows, 3.0 MB). `staked_usd` is the pool-level `currentLiquidityStakedUSD` (live for CL pools, stale between gauge events for V2 pools, #899). Production: as query 1 plus a small `chain_daily` lookup per chain.

### 19. Tokens that are unpriced (price 0) or untrusted but sit in pools with swaps: USD figures miss them

```sql
SELECT t.chain_name, t.symbol, t.token_address, t.is_unpriced, t.is_price_trusted, t.price_trust_reason,
       t.price_updated_at, count() AS pool_count, sum(p.swaps_total) AS swap_count
FROM tokens AS t
INNER JOIN pools AS p ON p.chain_id = t.chain_id AND (p.token0_address = t.token_address OR p.token1_address = t.token_address)
WHERE t.is_unpriced OR NOT t.is_price_trusted
GROUP BY t.chain_name, t.symbol, t.token_address, t.is_unpriced, t.is_price_trusted, t.price_trust_reason, t.price_updated_at
ORDER BY swap_count DESC
LIMIT 25
```

Ten-chain sync: **25 rows, 0.104 s** (first run 0.202 s; read 4.7 krows, 454.0 kB). Aero sync: **25 rows, 0.078 s** (first run 0.078 s; read 7.9 krows, 728.9 kB). These tokens contribute $0 to every USD figure. Production: a join of `tokens` (≈ 100 k) with `pools` (≈ 44 k) on an OR condition; seconds at most.

### 20. Data freshness per chain: last committed block, last pool change and price refresh (block time)

```sql
SELECT chain_name, wound_down, indexed_block, last_pool_change, last_price_refresh, minutes_behind_now,
       layer_checkpoint, indexed_checkpoint, layer_loaded_at
FROM freshness
ORDER BY chain_name
```

Ten-chain sync: **10 rows, 0.078 s** (first run 0.309 s; read 518.4 krows, 6.5 MB). Aero sync: **7 rows, 0.050 s** (first run 0.112 s; read 101.1 krows, 1.6 MB). Compare `indexed_block` with the chain head (e.g. `velo report`); `minutes_behind_now` is block time of the last change against now, so a quiet chain also looks behind. Production: milliseconds.

### 21. New pools per month and chain (first day with a pool change = creation day)

```sql
SELECT toStartOfMonth(first_day) AS month, chain_name, family, count() AS new_pools
FROM (
  SELECT chain_name, pool_address, if(pool_type LIKE 'CL%', 'CL', 'V2') AS family, min(day) AS first_day
  FROM pool_daily GROUP BY chain_name, pool_address, family
)
GROUP BY month, chain_name, family
ORDER BY month, chain_name, family
```

Ten-chain sync: **186 rows, 0.138 s** (first run 0.163 s; read 200.0 krows, 12.1 MB). Aero sync: **13 rows, 0.055 s** (first run 0.055 s; read 9.7 krows, 797.3 kB). Production: one pass over `pool_daily`; seconds.

### 22. CL versus V2 share of volume per month

```sql
SELECT toStartOfMonth(day) AS month,
       round(sumIf(volume_usd, pool_type LIKE 'CL%') / sum(volume_usd), 4) AS cl_share,
       round(sum(volume_usd)) AS total_volume
FROM pool_daily
GROUP BY month
ORDER BY month
```

Ten-chain sync: **31 rows, 0.106 s** (first run 0.106 s; read 200.0 krows, 24.7 MB). Aero sync: **2 rows, 0.050 s** (first run 0.067 s; read 9.7 krows, 1.1 MB). Production: as query 2.

### 23. How token prices were obtained per chain in the last 30 days of data: fresh vs carried vs unpriced

```sql
WITH (SELECT max(hour) FROM token_prices_hourly) AS last_hour
SELECT c.chain_name, ifNull(p.price_source, '(none)') AS source, count() AS token_hours,
       round(count() / sum(count()) OVER (PARTITION BY c.chain_name), 4) AS share
FROM token_prices_hourly AS p
INNER JOIN chains AS c ON c.chain_id = p.chain_id
WHERE p.hour > last_hour - INTERVAL 30 DAY
GROUP BY c.chain_name, source
ORDER BY c.chain_name, token_hours DESC
```

Ten-chain sync: **27 rows, 0.470 s** (first run 0.470 s; read 2.9 Mrows, 210.0 MB). Aero sync: **33 rows, 0.067 s** (first run 0.074 s; read 66.0 krows, 4.8 MB). Production: 30 days of `token_prices_hourly` (≈ 1 M rows); under a second.

### 24. Pools whose numbers need care: swap-fee fallbacks, swaps but no USD, staked > TVL

```sql
SELECT p.chain_name, p.pair, p.pool_address, p.swaps_total, p.volume_usd_total, p.tvl_usd, p.staked_share, s.swap_fee_fallbacks
FROM pools AS p
INNER JOIN (SELECT chain_id, pool_address, swap_fee_fallbacks FROM _pool FINAL) AS s
  ON s.chain_id = p.chain_id AND s.pool_address = p.pool_address
WHERE s.swap_fee_fallbacks > 0 OR (p.swaps_total > 100 AND p.volume_usd_total = 0) OR p.staked_share > 1.01
ORDER BY p.swaps_total DESC
LIMIT 25
```

Ten-chain sync: **25 rows, 0.102 s** (first run 0.113 s; read 5.9 krows, 685.1 kB). Aero sync: **11 rows, 0.059 s** (first run 0.080 s; read 9.1 krows, 978.4 kB). Production: as query 1.

### 25. Hourly volume and active pools per chain over the last 7 days of data

```sql
WITH (SELECT max(hour) FROM chain_hourly) AS last_hour
SELECT hour, chain_name, volume_usd, swaps, active_pools, tvl_usd
FROM chain_hourly
WHERE hour > last_hour - INTERVAL 7 DAY
ORDER BY hour DESC, volume_usd DESC
```

Ten-chain sync: **933 rows, 1.676 s** (first run 2.273 s; read 3.8 Mrows, 515.4 MB). Aero sync: **763 rows, 0.143 s** (first run 0.155 s; read 112.8 krows, 14.8 MB). Production: `chain_hourly` computes deltas over every pool-hour (`pool_hourly`, ≈ 20 M rows at production scale) before the date filter: tens of seconds. For dashboards, query `pool_hourly` with a chain filter, or materialize `chain_hourly` on a schedule.

### 26. Aero emissions per chain and day: credited by the LeafVoter, minted on claim, forfeited; USD as indexed

```sql
-- and at Base AERO's price (xAERO on the leaf chains often has no price of its own)
SELECT day, chain_name, round(emissions_credited) AS credited, round(emissions_minted) AS minted,
       round(emissions_forfeited) AS forfeited, round(emissions_minted_usd) AS minted_usd_indexed,
       round(emissions_minted_usd_at_base_aero) AS minted_usd_at_base_aero, round(xaero_outstanding) AS xaero_outstanding
FROM aero_chain_daily
ORDER BY day DESC, minted DESC
```

Aero sync: **38 rows, 0.031 s** (first run 0.054 s; read 10.9 krows, 1.2 MB). `emissions_minted_usd` is the indexed USD (the reward token's price on that chain); on the leaf chains xAERO had no price on the Aero sync, so only Base (and part of Robinhood) has a value, while `minted_usd_at_base_aero` values every chain at that day's Base AERO price (on Base the two agree within 0.3 %). Production: one row per chain and day; milliseconds.

### 27. Aero gauges: pool fees against emissions minted, last 7 days of data (top 20 by emissions)

```sql
WITH (SELECT max(day) FROM aero_gauge_daily) AS last_day
SELECT chain_name, pair, gauge_address, round(sum(emissions_minted)) AS aero_minted,
       round(sum(emissions_minted_usd_at_base_aero)) AS minted_usd, round(sum(pool_fees_usd)) AS pool_fees_7d,
       round(sum(pool_fees_usd) / nullIf(sum(emissions_minted_usd_at_base_aero), 0), 3) AS fees_per_emission_dollar
FROM aero_gauge_daily
WHERE day > last_day - 7
GROUP BY chain_name, pair, gauge_address
ORDER BY aero_minted DESC
LIMIT 20
```

Aero sync: **20 rows, 0.205 s** (first run 0.835 s; read 55.9 krows, 5.6 MB). Pool fees come from `pool_daily` joined on (chain, pool, day). Production: `_aero_gauge_day` (one row per gauge-day) plus `pool_daily` for the Aero pools; well under a second.

### 28. sAERO: total staked, permanent share and voting power now, and the 10 largest positions

```sql
SELECT * FROM (
  SELECT 'total' AS row_kind, CAST(NULL AS Nullable(UInt64)) AS position, CAST(NULL AS Nullable(String)) AS holder,
         round(sum(amount)) AS aero, round(sumIf(amount, is_permanent) / sum(amount), 4) AS permanent_share,
         round(sum(voting_power_now)) AS voting_power
  FROM saero_positions
  UNION ALL
  SELECT 'position', toNullable(toUInt64(token_id)), toNullable(owner), round(amount), toFloat64(is_permanent), round(voting_power_now)
  FROM (SELECT * FROM saero_positions ORDER BY amount DESC LIMIT 10)
)
ORDER BY row_kind DESC, aero DESC
```

Aero sync: **11 rows, 0.037 s** (first run 0.037 s; read 37.8 krows, 4.7 MB). Voting power is computed at query time from `stake_end` (as the contracts do), so it decays between runs. Production: tens of thousands of positions; milliseconds.

### 29. Allocation books per chain: what the root Voter on Base booked against what each LeafVoter holds

```sql
SELECT chain_id, chain_name, count() AS positions, round(sum(root_booked)) AS root_booked, round(sum(leaf_budget)) AS leaf_budget,
       round(sum(leaf_booked_on_gauges)) AS leaf_on_gauges, round(sum(leaf_idle)) AS leaf_idle,
       countIf(abs(root_minus_leaf) > 1e-9) AS positions_out_of_step
FROM aero_allocation_books
GROUP BY chain_id, chain_name
ORDER BY chain_id
```

Aero sync: **8 rows, 0.214 s** (first run 0.277 s; read 43.3 krows, 4.7 MB). Chain 0 is CHAIN0, the idle pool on the root side. On the Aero sync, which backfills the chains at different speeds, many positions are out of step because the root and leaf events of one allocation were indexed at different times; at the head they should agree except for dispatches in flight, expired or rejected. Production: a full outer join of two tables of positions × chains; under a second.

### 30. Aero gauge staking per chain and day: deposits, withdrawals and distinct stakers (from the stake events)

```sql
SELECT toDate(timestamp) AS day, chain_id, countIf(kind = 'DEPOSIT') AS deposits,
       countIf(kind != 'DEPOSIT') AS withdrawals, uniqExact(account) AS stakers
FROM aero_gauge_stake_events
GROUP BY day, chain_id
ORDER BY day DESC, deposits DESC
```

Aero sync: **39 rows, 0.485 s** (first run 1.310 s; read 1.4 Mrows, 208.0 MB). Reads envio's `AeroGaugeStakeEvent` through the typed view, so it scans the whole event table (3.1 M rows per 9 days on Base in production; seconds per month of data). The table-layout proposal does not help a per-day count; for dashboards build a daily rollup on top (or use `aero_gauge_daily.deposits / withdrawals`, which comes from the gauge counters).

### 31. Legacy-to-Aero migration so far: veNFTs and liquid tokens migrated, per contract

```sql
SELECT chain_id, legacy_token, migration_contract, venfts_migrated, round(venft_amount_in) AS venft_in, round(venft_amount_out) AS venft_out,
       liquid_migrations, round(liquid_amount_in) AS liquid_in, round(liquid_amount_out) AS liquid_out, settlements, round(settled_amount) AS settled
FROM aero_migration
ORDER BY chain_id, legacy_token
```

Aero sync: **3 rows, 0.013 s** (first run 0.021 s; read 6 rows, 1.8 kB). Production: a handful of rows.

<!-- QUERIES:END -->

## Limits and data-quality caveats

**What the layer cannot answer.**

- **Anything per swap.** The indexer stores aggregates, not swaps, mints or transfers, so there
  is no per-swap table: no trade sizes, no unique traders per day (only "wallets whose stats
  changed", from `user_pool_snapshots` or `last_activity`), no per-transaction questions. The
  Aero stake, emission, allocation and sAERO events are the exception: those are per event.
- **State at an arbitrary block.** The layer keeps current state and end-of-hour / end-of-day
  states. envio's per-block history has every version, unless the TTL below is applied.
- **Votes per epoch.** `venft_votes` and the Aero allocation views are current; history is in
  envio's snapshots and `aero_allocation_events`.
- **USD of an idle pool at today's prices.** `totalLiquidityUSD` is revalued only when the pool
  has an event, so TVL of idle pools is at their last event's prices; for a current valuation,
  value `reserve0` / `reserve1` with `tokens.price_usd` yourself.

**Where numbers are approximate.**

- **envio's hourly snapshots** (`PoolSnapshot`, `UserStatsPerPoolSnapshot`, `AeroGaugeSnapshot`,
  …) are taken at the *first* change of an hour, and only for hours with activity: a snapshot
  labelled hour H is the state after the first event of H, not the state at the end of H − 1, so
  deltas between snapshots are shifted by one event. The layer's `pool_*` and `aero_*_daily`
  series do not have this problem (they take the last version in the period from the per-block
  history), but `user_pool_snapshots`, `token_prices_hourly` and the `*_snapshots` views do.
- **Gaps are not zeros.** A pool, gauge, user or token with no change in a period has no row.
  Flows for missing periods are 0; levels (TVL, reserves, prices, caps) carry over from the
  previous row. `chain_daily` / `chain_hourly` carry every pool forward, but a day on which no
  pool of a chain changed has no row at all.
- **Period buckets use block time** (`lastUpdatedTimestamp`). A legacy leaf pool updated by an
  Optimism root-gauge distribution carries the Optimism block's time.
- **A reorg that restores an older hour.** If a reorg's restored state lands in an earlier
  period than a period the layer already holds for that entity, the later period keeps its
  `prev_*` values (and its state from orphaned blocks) until a later change lands in it.
  `verify` reports it; `rebuild` repairs it. Not seen in the test data.
- **Position amounts and values** in `positions` are computed in `Float64` from liquidity, the
  tick range and the pool's current `sqrtPriceX96`; they ignore uncollected fees.
- **Float64 views**: 15–16 significant digits; use `*_raw` or the storage tables for exact
  reconciliation.

**Data-quality caveats a consumer must know.**

- **USD values use pool-derived prices** (ADR 0003): a token is priced once per hour through its
  deepest qualifying pool against a lower-tier token (stablecoins at $1, then WETH, connectors,
  everything else). Below the per-chain depth floor there is no price; the last one is carried
  for 7 days and then the token reads $0 (`tokens.is_unpriced`, `price_source = 'unpriced'`).
  Volume and fees in USD are valued at the price when they happened, so a token that was
  unpriced at the time contributes $0 for good.
- **Untrusted tokens contribute $0.** Only tokens that are legacy-whitelisted, listed on Aero's
  TokenRegistry or price connectors, and not blacklisted, count in USD aggregates
  (`tokens.is_price_trusted`, ADR 0002). Query 19 lists the ones that fall through.
- **Aero emissions on the leaf chains are in xAERO, which often has no price there.** xAERO is
  redeemable 1:1 for AERO on Base but is priced only through its own pools or the canonical
  Base AERO candidate (ADR 0004); on Arc, and on the Aero test sync on every leaf chain, its
  price was 0, so `emissions_minted_usd` (as indexed) reads $0 outside Base. Use the
  `*_usd_at_base_aero` columns (AERO amount × that day's Base AERO price) to compare chains.
- **Aero allocation books are separate.** The root Voter on Base books what a position sent to
  each chain; each chain's LeafVoter books what it received and the gauge split it applied. A
  dispatch can be in flight, expire or be rejected, so the two differ at times; they are joined
  only in queries (`aero_allocation_books`, query 29).
- **Legacy per-user CL fee collection is credited to the position manager.** On legacy CL
  pools `CLPool.Collect` is emitted with the NFPM contract as owner, so
  `user_pools.unstaked_fees_collected_*` for legacy CL positions accrue to the NFPM address,
  not the wallet. Pool-level totals are right. Aero NFPM collections are credited to the owner.
- **Per-user staked USD is as of the user's last activity** (`staked_usd_as_of_last_activity`,
  issue #902): an idle staker is never revalued and often reads $0. Pool-level `staked_usd` is
  live for CL pools; for V2 pools it is set at gauge events and can go stale (#899).
- **Top "users" are often contracts**: routers, aggregators, vaults, gauges and the NFPM.
- **`votes` is the pool's legacy vote weight** (envio `veNFTamountStaked`, veToken units ÷ 1e18,
  as the Voter holds it). `gauge_reward_balance` (envio `totalVotesDeposited`, despite its name)
  is the gauge's undistributed reward-token balance at its last `DistributeReward`, derived from
  events: emissions + redistributed − forfeited − claimed − early-withdraw penalties.
- **Legacy reward-token amounts** (`emissions`, `gauge_rewards_claimed`, `gauge_reward_balance`) are in each
  chain's own legacy reward token (VELO, AERO v1, XVELO, …): sum the `*_usd` columns across
  chains. Legacy emission fields stay 0 on Aero pools (Aero emissions are in the Aero views).
- **Legacy emissions before the oracle era read $0 in USD** for 188 pools (#738) though the
  token amounts are right, and leaf-chain legacy emissions need Optimism's root gauges in the
  same sync (the ten-chain test sync has none, so they read 0 there).
- **Superseed blocks 10,313,359 to 10,521,629** (about 2025-05-08 to 05-13) came from a
  non-canonical fork in HyperSync; mints and liquidity events are missing, and Superseed pool,
  position and user numbers are wrong from then on (`known_data_issues`).
- **Wound-down chains** (Lisk, Superseed, Swell) stop at their `end_block`; their freshness looks
  stale by design.
- **Fee rates**: `current_fee_pct` is the rate the latest swap paid (dynamic fees move it);
  `base_fee_pct` is the configured fee. CL swaps whose fee could not be derived are counted in
  `_pool.swap_fee_fallbacks` (should stay 0).
- **Older indexer schemas**: on an indexer built before `Pool.deployment` existed, the layer
  derives it from the chain (Base → `AERODROME`, else `VELODROME`), which is right for legacy
  pools only; Aero tables and views are skipped when the indexer has no Aero gauges.

## Proposals for envio's own ClickHouse tables

The patches are in [`clickhouse/proposals/`](../clickhouse/proposals) (against `schema.graphql`
at a397cc0; not applied). Each needs a full resync: envio fixes table layouts and column types
when it creates the database.

<!-- PROPOSALS:BEGIN -->
Both patches together were applied to a Metal-only sync at a397cc0 (to block 41,500,000): envio
3.16 accepted the schema, created every table with the new layout and types (Aero tables
included, empty on Metal), and the Postgres state at the end (`Pool`, `UserStatsPerPool`,
`Token`, `NonFungiblePosition`) was byte-identical (md5 of every row) to an unpatched run. The
layer installs and verifies on top of it.

**1. Table layouts for the ClickHouse-only entities** (`01-clickhouse-table-layouts.patch`).
`@storage(clickhouse: {partitionBy, orderBy, skippingIndexes})` for the seven legacy snapshots
and the twelve Aero event and snapshot tables, for example
`orderBy: ["chainId", "poolAddress", "timestamp"]` on `PoolSnapshot`,
`["chainId", "userAddress", "poolAddress", "timestamp"]` on `UserStatsPerPoolSnapshot`,
`["chainId", "gaugeAddress", "timestamp"]` with a bloom index on `account` on
`AeroGaugeStakeEvent` / `AeroEmissionsEvent`, `["chainId", "tokenId", "timestamp"]` on
`SAeroPositionEvent` / `AeroAllocationEvent`. It also drops the `@index` tags on these entities
(they create nothing: no Postgres table, and ClickHouse ignores `@index`). envio refuses to sort
by a `BigInt` kept as a `String`, so the `tokenId` of `VeNFTStateSnapshot`, `SAeroPositionEvent`
and `AeroAllocationEvent` moves to `precision: 38` (ids are small). Measured on copies of the
ten-chain and Aero test tables, rows read by typical queries (query condition cache off):

| table (rows) | query | envio layout (id-led) | proposed |
|---|---|---|---|
| `UserStatsPerPoolSnapshot` (22.2 M) | one user's history | 22.2 M rows, 76 ms | 208 k rows, 29 ms |
| | one pool's users at an hour | 22.2 M rows, 331 ms | 8 k rows, 21 ms |
| `PoolSnapshot` (1.84 M) | one pool's history | 1.84 M rows | 231 k rows |
| | all pools at one hour | 1.84 M rows | 12.8 k rows |
| `TokenPriceSnapshot` (1.29 M) | one token's prices | 1.29 M rows | 255 k rows |
| `AeroGaugeStakeEvent` (0.5 M) | one gauge's events | 506 k rows | 49 k rows |
| `AeroEmissionsEvent` (0.24 M) | one gauge's events | 239 k rows | 33 k rows |

Storage is unchanged within ±3 % (2.29 vs 2.36 GiB, 498 vs 496 MB, 43.9 vs 40.5 MB, 86 vs 82
MB). The gain grows with the table: production's 244 M user snapshots would be read in full for
each per-user question today. Per-day questions over the event tables gain little from this
order (partitions are monthly); the layer's daily tables answer those. Risk: none to indexing
(verified above); a custom `orderBy` makes envio's own entity view re-sort, which matters only
to readers of those views, and handler loads never read ClickHouse-only entities here.

**2. Narrower `BigInt`s** (`02-precision-38.patch`). `precision: 38` on the USD fields and
counters of `Pool`, `PoolSnapshot`, `UserStatsPerPool`, `UserStatsPerPoolSnapshot`, `Token` and
`TokenPriceSnapshot`, so envio writes `Decimal(38,0)` instead of `String`. On the ten-chain
`Pool` history (68.7 M rows), for `totalVolumeUSD`: 0.65 GiB instead of 1.02 GiB on disk
(−36 %; −44 % for `totalLiquidityUSD`), `sum()` 1.1 s instead of 6.1 s, `ORDER BY … LIMIT 5`
1.9 s instead of 6.7 s. Headroom: 1e38 / 1e18 = $1e20; the largest values seen are $2.1e10
(per-user cumulative) and $2e9 (pool volume), 9–10 orders of magnitude below. **Risk:** Postgres
would reject a value of 1e38 or more (`numeric field overflow`) and the indexer would stop; a
mispriced but trusted token could inflate a cumulative USD total, so the aggregators must clamp
before this ships (not part of the patch). Raw token amounts (7.9e32 seen, 5 orders of headroom
only), CL liquidity (`uint128`), `sqrtPriceX96` and the pool price ratios (up to 3.4e68) must stay
at 76. The analytics layer reads `Decimal` sources as well as `String` ones (tested), and gains
nothing from the change (it already stores `Int256`): the benefit is to readers of envio's own
tables and to their size.

**3. A short ClickHouse history for the dual-stored aggregates** (`analytics.py history-ttl`, not
a schema patch). `Pool`, `UserStatsPerPool`, `Token`, `NonFungiblePosition`, `AeroGauge` and the
other aggregates handlers update are kept in Postgres for the handlers, so their ClickHouse
history (one row per block in which they changed) is only analytics. Once the layer is caught up,
the layer holds their current state and the hourly / daily series, and most of that history can
expire. Measured:

- **Saving.** On the ten-chain data, the last 30 days are 0.7–6.2 % of each chain's `Pool`
  versions (Ink 6.2 %, Celo 5.2 %, Soneium 3.3 %, Unichain 2.4 %, Mode 1.3 %), so a 30-day TTL
  removes 94–99 % of the largest tables (production: most of the 248 GiB of `Pool` history and
  of the 1.6 B `UserStatsPerPool` versions). On the Metal test sync, `Pool` history went from
  176,000 rows / 29.4 MB to 303 rows / 32 KB, `UserStatsPerPool` from 13.1 MB to 27 KB, `Token`
  from 1.2 MB to 4 KB; the whole database from 68 MB to 24 MB.
- **Indexing is unaffected.** With `ttl` on `Pool`, `UserStatsPerPool`, `Token` and
  `NonFungiblePosition` (dual-stored, `@storage(postgres: true, clickhouse: {ttl})`) envio 3.16
  synced Metal to the same Postgres state as without (md5 equal), including through 16 restarts
  forced by a full Postgres connection pool. A TTL added later with `ALTER TABLE … MODIFY TTL`
  does not stop envio from resuming either.
- **The layer keeps the state.** On the Metal sync with the layer installed, a 30-day TTL took
  the `Pool` history from 176,000 rows to 303: envio's own `Pool` view dropped from 18 pools to 10
  (`UserStatsPerPool` from 3,733 rows to 95, `NonFungiblePosition` from 512 to 0), while the
  layer kept all 18 pools, the 3,733 user rows and all 30,960 pool-hours.
- **But not as a schema `ttl`.** The TTL is on block time, so during a resync it fires on old
  rows within seconds of their insert, during merges. With the layer installed before the sync
  and refreshing every 5 seconds, it still caught only 11 of 18 pools, 238 of 3,733 user rows,
  0 of 512 positions and 489 of 30,960 pool-hours. So: no `ttl` in `schema.graphql`; apply it to
  a synced indexer with `analytics.py history-ttl --days 30 --apply`, which refuses unless every
  layer table is caught up, uses `materialize_ttl_after_modify = 0` (no immediate rewrite of
  248 GiB; run `ALTER TABLE … MATERIALIZE TTL` off-peak to reclaim space at once), and is undone
  by `--remove` or by any indexer reset (envio recreates the tables). Risk: envio's entity views
  for those aggregates become incomplete (read the layer instead), and `verify` can only be run
  against the retained window; a layer rebuild after the TTL needs an indexer resync.

**4. `column_name_format: snake_case`: not worth a resync on its own.** envio's conversion
(`totalVolumeUSD` → `total_volume_usd`, `isCL` → `is_cl`) is pleasant, but some names come out
odd (`veNFTamountStaked` → `ve_nf_tamount_staked`, `numberOfVeNFTs` → `number_of_ve_nf_ts`), the
layer already exposes snake_case names chosen for analysts, and the change would break every
query written against envio's tables. Adopt it only bundled with a resync done for other reasons
(the layer would then need its source column names mapped through the same conversion, a small
change to the resolver in `analytics.py`; not done).
<!-- PROPOSALS:END -->
