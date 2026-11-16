# ADR 0009: Per-chain entities

- **Status:** Proposed (2026-11-16). Phase 1 (this note and a proof on Metal and
  Mode) done; the migration follows after review. Supersedes the cross-chain
  parts of ADR 0004 (canonical candidates) and extends ADR 0008 (seed).

## Context

Envio 3.16 can make every entity per-chain (`disable_default_cross_chain: true`
in `config.yaml`). Only a schema with **no** shared entity gets the payoffs:

- one checkpoint sequence per chain (`Config.isPerChain`), so a reorg on one
  chain no longer rolls back the others and one chain at the head no longer
  makes every chain write history;
- the run is split across up to 4 worker processes on its own
  (`Supervisor.planForRun`);
- a chain can be added to an existing database without a resync
  (`ResumePlan.AddChain`).

Per chain, a handler's `get`, `getWhere` and `set` see only its own chain's
rows; there is no API to read another chain's. Seven flows in this codebase
read or write another chain's rows today (A–G below). They are also the
order-dependent part of the indexer: chains are unordered, so what they produce
depends on how far each chain has synced.

## What envio does in per-chain mode (verified 2026-11-16, envio 3.16.0)

Run on a minimal project (WETH transfers on 3–5 small chains, Postgres and
ClickHouse, `ENVIO_PG_MAX_CONNECTIONS=10`) and on this indexer (Metal + Mode).

- **Rows.** The primary key becomes `(id, chainId)`. Postgres tables are
  `LIST`-partitioned by `chainId` (`Pool$34443`, …). Handler entity types have
  no `chainId`; envio fills its own `chainId` column from the handler's chain.
  A stray `chainId` property on an object passed to `set` is ignored (the row
  lands on the handler's chain). The same id may exist on several chains, so
  `{chainId}-{address}` ids stay valid and unique.
- **Reads.** `get` of an id that exists only on another chain returns
  `undefined`; `getWhere` returns only the handler's chain. The first
  `getWhere` on a field builds a Postgres index on that chain's partition and
  pauses writes to it while it builds.
- **Checkpoints** are per chain and overlap (each chain starts at 1). ClickHouse
  history tables keep `ORDER BY (id, envio_checkpoint_id)` with a `chainId`
  column; envio's views pick rows with `envio_checkpoint_id <=
  envio_frontier[chainId]` and `LIMIT 1 BY id, chainId`. ClickHouse-only
  entities behave the same.
- **Workers.** `min(chains, ENVIO_PG_MAX_CONNECTIONS / 2, 4)` processes; fewer
  than 2 means one process. The default connection budget (2) never splits.
  One metrics endpoint (the supervisor's port) merges every worker's numbers
  with per-chain labels. Workers are held at the head until all arrive.
- **Effects.** An effect with `crossChain: true` is allowed in a split run
  (`isolate` checks entities only) and its Postgres cache table is shared:
  a worker started later reads what another wrote. Two workers running at the
  same time can both compute the same key once. A cross-chain effect cannot
  use `context.chain`. Effect cache rows are not rolled back on a reorg.
- **Adding a chain.** A plain `envio start` with a new chain in the config is
  refused (`chains.<id>` incompatible). `envio start --chain <id>` adds it
  (`Adding the chain to the existing indexer storage...`), backfills it alone,
  and leaves the other chains' rows untouched; afterwards a plain start
  resumes all chains. Everything else must be identical: the config without
  its `chains` (contracts, events, ABIs, schema, storage, flags), the contract
  name list, and each existing chain's `start_block`, `end_block`,
  `max_reorg_depth` and configured addresses. A contract used only by the new
  chain must therefore already be declared.
- **Tests.** `createTestIndexer` works. `indexer.X.set()` needs `chainId` on
  the object for a per-chain entity; rows read back carry `chainId`;
  `indexer.X.get(id)` throws (synchronously) when the id exists on more than one
  chain, and `getWhere({chainId: {_eq}})` picks one.

## Proof on this indexer (phase 1, branch `perchain/phase1-proof`)

Flag on, zero `@crossChain` entities, the 51 `chainId` fields dropped, flows
A–G stubbed (`src/PerChainStubs.ts`). Metal + Mode to the same end blocks
(41,630,723 / 47,328,689) in per-chain mode and, at b598f24, in shared mode:

- 9,497,588 events each; wall time 11m36s (2 workers) vs 11m27s (1 process),
  about 14k events/s both: Mode alone is the critical path.
- Every Postgres entity table and the ClickHouse `PoolSnapshot`,
  `TokenPriceSnapshot`, `UserStatsPerPoolSnapshot`,
  `NonFungiblePositionSnapshot` are identical per chain (row count and a hash
  of every column but `chainId`), except flow G: 25 Mode→Metal SuperSwaps the
  shared run stitched, and their 25 `DispatchId_event` / `ProcessId_event`
  staging rows that it deleted and the per-chain run keeps.
- Lisk added with `envio start --chain 1135` (10.9 M events), then a plain
  start resumed all three in 3 workers; Metal and Mode still identical.

## Decision

Make every entity per-chain. Root-chain facts stay on the root chain, each
chain writes only its own rows, and the cross-chain joins move to the
ClickHouse analytics layer (`clickhouse/**`, `docs/clickhouse.md`). The indexer
is used for analytics, so a join at query time is acceptable.

### The seven flows

| | today | after |
|---|---|---|
| **A** `Voter.Voted` / `Abstained` on Optimism for a superchain root pool | writes the leaf `Pool.veNFTamountStaked`, the leaf `UserStatsPerPool.veNFTamountStaked` and `VeNFTPoolVote` (leaf ids), or a `PendingVote` | Optimism writes `RootPool.veNFTamountStaked` (= `totalWeight`) and `VeNFTPoolVote` `10-{tokenId}-{rootPool}`, as for a local pool. No `UserStatsPerPool` row. |
| **B** `Voter.DistributeReward` for a root gauge | adds to the leaf `Pool.totalEmissions(USD)`, sets `totalVotesDeposited(USD)`, or a `PendingDistribution` | Optimism adds to `RootPool.totalEmissions(USD)` and sets `totalVotesDeposited(USD)`, priced with Optimism's VELO at the event (as today when the mapping exists). Root gauge → root pool stays `RootGauge_RootPool` (Optimism-only). |
| **C** `RootCLPoolFactory.RootPoolCreated` | reads leaf `Pool`s by `rootPoolMatchingHash`; writes `RootPool_LeafPool` or `PendingRootPoolMapping` | creates the `RootPool` with `leafChainId`, tokens, tick spacing, root factory and `rootPoolMatchingHash`. No read. |
| **D** leaf V2 `PoolFactory.PoolCreated` | RPC `getRootPoolAddress`, writes `RootPool_LeafPool`, flushes Optimism's pending rows (and refreshes Optimism's VELO price from a leaf handler) | keeps the RPC effect (a contract call on the leaf chain's LpHelper, not an entity read; cached, one call per V2 leaf pool) and writes `RootPool_LeafPool` on the leaf chain. No flush. |
| **E** leaf `CLFactory.PoolCreated` | reads Optimism's `PendingRootPoolMapping`, writes the mapping, flushes | nothing: the leaf `Pool` already stores `rootPoolMatchingHash` and `factoryAddress`. |
| **F** canonical price candidate at the head | reads the source chain's `Token` (Optimism WETH / VELO, Base AERO) inside ±2 h | a cross-chain effect returns the source's hourly price from this deployment's ClickHouse (below). Seed (ADR 0008) unchanged. |
| **G** SuperSwap stitching | each side reads and deletes the other chain's staging rows | each side writes its own row keyed by `messageId` (`SuperSwapSource` at the origin's `CrossChainSwap`, `SuperSwapDestination` at the destination's `ProcessId`); `SuperSwap` becomes a ClickHouse view joining them. The staging rows stay chain-local. |

Deleted: `PendingVote`, `PendingDistribution`, `PendingRootPoolMapping`,
`src/EventHandlers/Voter/CrossChainPendingResolution.ts` and its tests,
`loadPoolDataOrRootCLPool`'s cross-chain branch, `resolveLeafPoolForRootGauge`.

**New entity `RootPool`** (Optimism only, both stores, id `10-{rootPool}`):
`rootPoolAddress`, `leafChainId` (CL; null for V2, learned from the leaf's
`RootPool_LeafPool`), `token0`, `token1`, `tickSpacing`, `rootFactoryAddress`,
`rootPoolMatchingHash` (CL), `gaugeAddress`, `gaugeIsAlive`,
`veNFTamountStaked`, `totalVotesDeposited(USD)`, `totalEmissions(USD)`,
`lastUpdatedTimestamp`. Its per-block ClickHouse history gives the hourly
series, like `Pool`'s. The `Pending*` rows were close but are Postgres-only,
deleted on flush and lack `totalWeight` and USD, so they cannot be the
ClickHouse source.

### Stored fields that stop being filled

On superchain leaf pools (`Pool.deployment = VELODROME`, chain not 10) these
stay at their creation defaults:

| field | replacement in the analytics layer (built in step 2) |
|---|---|
| `Pool.veNFTamountStaked` | `leaf_pool_root_totals.votes` (= `RootPool.veNFTamountStaked`, `Voter.weights(rootPool)`) |
| `PoolSnapshot.veNFTamountStaked`, `totalEmissions(USD)` (hourly) | `RootPool`'s per-block ClickHouse history through `root_leaf_pools`; an hourly root-pool series in the layer is still to build |
| `Pool.totalVotesDeposited`, `totalVotesDepositedUSD` | none needed: since the gauge balance is derived from events (b044799) it is 0 on leaf pools already |
| `Pool.totalEmissions`, `totalEmissionsUSD` | `leaf_pool_root_totals.emissions_*`; at the flip `pools.emissions_*`, `pool_hourly` / `pool_daily.emissions*`, `chain_*` and queries 09 / 10 take the root value for a mapped leaf pool |
| `UserStatsPerPool.veNFTamountStaked` (leaf users) and its snapshot | `root_pool_votes` × `venfts.owner` |
| `VeNFTPoolVote` rows with a leaf id | `RootPoolVote` (`root_pool_votes`), keyed by the root pool on Optimism |
| `SuperSwap` entity | `super_swap_legs` (`SuperSwapOriginLeg` ⋈ `SuperSwapDestinationLeg` on message id) |

GraphQL consumers of these fields on leaf pools lose them (a breaking change
for superchain pools only); the same numbers are on `RootPool`.

**`root_leaf_pool` view** (root chain, root pool, leaf chain, leaf pool):
CL = Optimism `RootPool` ⋈ leaf `Pool` on `rootPoolMatchingHash` and
`Pool.factoryAddress = RootPool.rootFactoryAddress` (the leaf CL factory is
deployed at the root factory's address); V2 = the leaf chains'
`RootPool_LeafPool`.

### Pricing at the head (flow F)

The seed (ADR 0008) already covers every backfilled hour without a cross-chain
read; only the head needs a live source. Options, in the order asked:

1. **Cross-chain effect reading this deployment's own ClickHouse.
   Recommended.** `getCanonicalSourcePrice({sourceTokenId, hourMs})`,
   `crossChain: true`, `cache: true`. It reads one row by primary key,
   `envio_history_TokenPriceSnapshot` id `{sourceTokenId}-{hourMs}`, at or
   below the source chain's commit frontier, `priceSource` in (`pool`,
   `pinned`), and answers only when the source chain's progress time is past
   `hourMs + 1 h + margin` (margin ≥ the source's reorg window). Otherwise it
   sets `context.cache = false` and returns nothing, and the token falls back
   as today. The leaf asks for the last complete hour (the seed's "up to two
   hours back"), tagged like the seed (`canonical-seed`, `pricingSeedHour`) or
   with a new `canonical-live` tag.
   - Allowed alongside isolated processes: `isolate` rejects shared entities,
     not effects; verified in a 3-worker run (the effect read another worker's
     ClickHouse rows; its cache table served a worker added later).
   - Determinism: a cached answer is a complete hour, so a leaf rollback
     replays the same value. Whether an answer exists at a given leaf block
     still depends on the source's progress, but the seed is built from the
     same `TokenPriceSnapshot` rows, so where the seed covers an hour both give
     the same price; only uncovered hours with a lagging source fall to carry.
   - Reorgs: effect caches are not rolled back, hence the margin.
   - Needs `ENVIO_CLICKHOUSE_*` in the indexer process (they are) and the
     source chain in the same deployment.
2. **Refreshing the seed on a schedule.** The seed is read at module load, so
   a refresh needs a restart, and the head always runs past the seed's end;
   it helps backfills only. Not a head solution.
3. **Local pools and the 7-day carry only.** In the ten-chain test sync
   (`scratch/final2`, last 7 days) the seed priced one anchor token per chain
   for most hours: Unichain 154, Celo 160, Mode 85, Ink 68, Arc 102 token-hours,
   that is the chain's WETH-like anchor with no qualifying local pool. At the
   head those would carry for 7 days and then go to 0, taking every token
   priced through them along. Rejected.

### `chainId` fields (51 entities)

51 entities declare `chainId: Int!`, which envio rejects in per-chain mode.
Plan: delete the declarations (envio's own `chainId` column keeps the name,
type and Postgres/ClickHouse column, so analysts see no change); keep every id
format (`{chainId}-…`), which also keeps the analytics layer's id-derived keys;
drop `chainId` from every entity literal (tsc finds them, 58 sites; spreads of
untyped objects it does not find, one in `AeroLeafAllocationLogic`); replace
the 67 reads of `entity.chainId` by the handler's `event.chainId` passed down
(on the proof branch a `chainIdOf(entity)` shim parses the id prefix). Tests:
mocks keep a `chainId` property for `indexer.X.set`, type helpers return
`Entity & {chainId}`, and `get` of an id present on two chains becomes
`getWhere({chainId: …})`.

### The analytics layer

Must change **before** the flag is flipped: it assumes one checkpoint sequence
(`frontier = max(checkpoint_id)` over all chains, `watermark = max(_version)`
per table). With per-chain sequences that loads a lagging chain's rows above
its own frontier and skips rows of a chain behind the watermark. Frontier and
watermark become per chain (`envio_frontier[chainId]`, watermark per
`(table, chain)`); keys already include the chain through the id. Then add
`_root_pool` (+ hourly / daily series), `root_leaf_pool`, the emissions and
votes coalescing in `pools` / `pool_*` / `chain_*`, and `super_swaps`.

## Migration order

1. Analytics layer: per-chain frontier and watermark (works in both modes).
   **Done (2026-11-16, branch `perchain/analytics-frontier`):** the mode is
   read off envio's views, every frontier and watermark is keyed by the
   row's sequence (the chain, or 0 when shared), shared-mode tables keep
   their definitions; tested on synthetic cases and on Metal (shared) and
   Metal + Mode + Lisk added with `--chain` (per-chain), see
   `docs/clickhouse.md`.
2. Shared mode, behind today's API: write `RootPool`, root-side
   `VeNFTPoolVote` and `SuperSwapSource` / `SuperSwapDestination` alongside
   the existing flows; add `root_leaf_pool`, `_root_pool`, `super_swaps`; on a
   sync with Optimism and the leaves, check the views equal today's leaf
   fields and `SuperSwap` rows.
   **Built (2026-11-16, branch `perchain/root-side`)**, with these changes to
   the plan above:
   - The root-side vote rows are a separate entity, `RootPoolVote`, not
     `VeNFTPoolVote`: the veNFT Transfer handler moves every VeNFTPoolVote's
     weight between the owners' `UserStatsPerPool` rows and would create user
     rows for root pools.
   - The SuperSwap legs are `SuperSwapOriginLeg` (written at
     `CrossChainSwap`, one per dispatched message, with its dispatch index)
     and `SuperSwapDestinationLeg` (written at the first oUSDT swap of a
     transaction that processed messages: Hyperlane emits `ProcessId` before
     it calls the recipient, so the swap comes later in the transaction; a
     Postgres-only `TxProcessIdRegistry` carries the message ids to it).
   - V2 root pools come from the V2 RootPoolFactory's `RootPoolCreated` (new
     config contract on Optimism). The event has no chain id; the leaf chain
     is recovered from the pool's address: CREATE2 from the factory with salt
     `keccak256(chainid, token0, token1, stable)` and an EIP-1167 clone of the
     factory's implementation. This matched all 58 V2 root pools on Optimism
     and 170 of 170 leaf `getRootPoolAddress` answers, so the leaf-side RPC
     effect could be replaced by the same computation later.
   - Base has no root pools: no `RootPoolCreated` on Base up to block
     38,500,000, and the one Base gauge whose pool is not a Base pool is a
     known sink (`KNOWN_SINK_ROOT_POOLS`).
   - Views: `root_pools`, `root_leaf_pools`, `leaf_pool_root_totals`,
     `root_pool_votes`, `super_swap_legs` (`clickhouse/sql/views_superchain.sql`).
   - Validated (shared mode, Optimism restricted to Voter, VeNFT and the
     two root factories, plus Metal, Mode and Lisk in full; test-only
     branch `keep/root-only-config`): all 225 root pools (167 CL, 58 V2,
     every leaf chain derived) have `veNFTamountStaked` equal to
     `Voter.weights(pool)` at the stop block (159,620,470); emissions equal
     the DistributeReward amounts from HyperSync for all 215 root gauges
     (12,192 distributions). All 64 leaf pools of the three chains (36 CL,
     28 V2) get the same votes and emissions through the views as the
     cross-chain handlers stored. `super_swap_legs` reproduces every
     `SuperSwap` row field for field except the timestamp (the entity takes
     whichever side was processed last), and finds 65 more: the stitching
     loses a SuperSwap whenever Envio processes the origin chain before the
     destination, since the destination swap follows `ProcessId` in its
     transaction. Two runs on the same data gave 83 and 87 `SuperSwap` rows;
     the view gave 152 both times.
   - ClickHouse `orderBy: ["chainId", …]` on a ClickHouse-only entity resolves
     to envio's own `chainId` column in per-chain mode as well (checked on the
     probe project: sort key `chainId, blockNumber, envio_checkpoint_id`), so
     the layouts need no change at the flip.
3. Pricing: the effect, the successor of ADR 0004; compare head prices with
   and without it.
   **Built (2026-11-16, branch `perchain/price-effect`)**, additive:
   `getCanonicalSourcePrice` (`src/Effects/CanonicalSourcePrice.ts`,
   `crossChain: true`, `cache: true`), called by `refreshTokenPrice` after the
   seed and before two-hop. Decisions:
   - **Input** `{sourceTokenId, hourMs, requesterTokenId}`; the leaf asks for
     the last complete clock hour before its block. The asking token is in the
     input because envio keeps an uncached output in the process's in-memory
     effect table until memory pressure evicts it (`setEffectOutput`,
     `dropCommittedEffects` only from `awaitCapacityLoop`): keyed by source
     and hour alone, a "not yet" computed for one leaf chain would be served
     to another leaf chain asking the same hour later. A leaf token asks each
     hour once, so the in-memory copy only joins the preload pass and the run
     proper of one refresh (one execution).
   - **Output** `{priceUSD, sourceHourMs}`, `priceUSD = 0` for no answer;
     tagged `canonical-snapshot`, the source hour in `pricingSeedHour`, no
     depth (like the seed: a fallback, not a candidate).
   - **Read**: one HTTP query, a primary-key range of
     `envio_history_TokenPriceSnapshot` from the hour minus the lookback to 24 h
     after it, the latest version at or below the source chain's commit
     frontier, each row's block from `envio_checkpoints`, and the source's
     highest committed block. Frontier: `max(envio_chains.checkpoint_id)`
     shared, the source chain's own row per chain; the mode is read once per
     process off envio's `TokenPriceSnapshot` view, as `clickhouse/analytics.py`
     does. No settings in the request, so a `readonly=1` user works (prod's
     `reader` was used). About 85 ms against `prod/optimism`.
   - **Finality instead of a time margin**: a source token's snapshot for an
     hour is written once, at its first refresh in that hour, so the row is
     final once its block is 200 blocks (envio's default reorg window, 199)
     below the source's committed frontier. The effect answers as soon as that
     holds, without waiting for the hour to end; only an *empty* hour needs
     the source to have left it, proven by a later source row that is itself
     final. At the head the asked hour's row is about an hour deep, so the
     effect answers on the first refresh of the next hour; a time margin on
     the hour's end would have missed every leaf refresh in the first minutes
     of an hour.
   - **Accepted rows**: `pool` and `pinned` with a positive price. `carried`,
     `unpriced`, `override` and the canonical tags are skipped like an empty
     hour (a route is only as fresh as its base; the seed builder also keeps
     `pool` rows only, so seed and effect agree on an hour).
   - **Lookback**: two hours back, never forward (the seed's rule).
   - **Caching**: a price, and a settled "no price" (all three hours final,
     none usable), are cached; "not yet" is not (`context.cache = false`).
   - **Failures**: 5 s timeout; an error is logged, answered as "not yet" (not
     cached) and pauses requests for 60 s, so an outage costs one timeout a
     minute; the caller also treats a thrown effect as no answer. The indexer
     never stops on it.
   - **Switches**: `PRICING_CANONICAL_SNAPSHOT_EFFECT` (default on; also off
     when no ClickHouse is configured, as in tests) and
     `PRICING_CANONICAL_LIVE_READ` (default on: shared mode keeps today's head
     behaviour, where the live source competes on depth with local pools; set
     it to `false` to run as per-chain mode will). Overrides
     `PRICING_CANONICAL_CLICKHOUSE_URL` / `_DATABASE` read the source from
     another server or database.
   - **Measured** (Mode alone to block 47,336,000 = 2026-11-16 ~14:50 UTC,
     shared mode, live read off, effect reading `prod/optimism`, whose
     Optimism history ends at 2026-11-16 05:00; against the same sync at
     60044cd): the seed hours are unchanged (WETH 2,607, XVELO 7,987
     `canonical-seed` rows, identical), as are the `pool` hours; 94
     token-hours that carried (59) or were unpriced (35) became
     `canonical-snapshot` (WETH 28 between the seed's end and 06:00 on
     11-16, plus 3 in May 2024, before the seed's start; XVELO 63 after the
     VELO seed's end on 11-03), each equal to Optimism's `pool` snapshot of
     the hour asked (94 of 94); after the source's last hour the 3 leaf
     refreshes got "not yet" and carried, and none of those was cached.
     97 effect executions for 97 token-hours that reached it (one each; the
     preload pass did not add any), 94 cache rows. Every other table is
     identical (51 of 57 ClickHouse history tables, every version; 57 of 60
     Postgres tables); `Pool`, `PoolSnapshot`, `Token`, `UserStatsPerPool`
     and their snapshots differ only in USD / price columns, in hours from the
     first effect answer on (three tokens priced through Mode WETH become
     `pool` where they carried before).
4. Flip: the flag, the `chainId` codemod, delete the pending machinery, the
   leaf-field writes and the `SuperSwap` entity, migrate the tests, update
   `docs/`. Full resync (ClickHouse `ORDER BY` and Postgres layout change).
5. Operations: `velo` adds a chain with `envio start --chain <id>` once, then
   restarts normally; it reads the same single metrics port.

## Consequences

- Reorgs, history writes and resumes are per chain; chains run in up to 4
  processes; a new leaf chain needs no resync.
- Results stop depending on relative sync progress, except the head price
  (option 1), as described.
- Superchain leaf pools lose their vote and emission fields in Postgres and
  GraphQL; ClickHouse views provide them.
