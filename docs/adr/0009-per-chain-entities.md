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

| field | replacement in the analytics layer |
|---|---|
| `Pool.veNFTamountStaked`, `PoolSnapshot.veNFTamountStaked` | `RootPool.veNFTamountStaked` via `root_leaf_pool` |
| `Pool.totalVotesDeposited`, `totalVotesDepositedUSD` (and snapshot) | `RootPool.totalVotesDeposited(USD)` |
| `Pool.totalEmissions`, `totalEmissionsUSD` (and snapshot) | `RootPool.totalEmissions(USD)`; `pools.emissions_*`, `pool_hourly` / `pool_daily.emissions*`, `chain_*`, queries 09 and 10 take the root value for a mapped leaf pool |
| `UserStatsPerPool.veNFTamountStaked` (leaf users) and its snapshot | `VeNFTPoolVote` (root pool) × `VeNFTState.owner` |
| `VeNFTPoolVote` rows with a leaf id | the same rows on Optimism keyed by the root pool |
| `SuperSwap` entity | `super_swaps` view over `SuperSwapSource` ⋈ `SuperSwapDestination` |

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
2. Shared mode, behind today's API: write `RootPool`, root-side
   `VeNFTPoolVote` and `SuperSwapSource` / `SuperSwapDestination` alongside
   the existing flows; add `root_leaf_pool`, `_root_pool`, `super_swaps`; on a
   sync with Optimism and the leaves, check the views equal today's leaf
   fields and `SuperSwap` rows.
3. Pricing: the effect, the successor of ADR 0004; compare head prices with
   and without it.
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
