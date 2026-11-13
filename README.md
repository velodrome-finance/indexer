# Velodrome V2 & Aerodrome multi-chain indexer

A multi-chain blockchain indexer for [Velodrome V2](https://velodrome.finance/)
(Optimism) and [Aerodrome](https://aerodrome.finance/) (Base) and their
superchain deployments. It ingests on-chain events for pools, gauges, voting,
veNFTs, concentrated-liquidity positions, automated liquidity management, pool
launchers, and cross-chain swaps, and serves the derived state from a Postgres
database.

Built in TypeScript on the [Envio HyperIndex](https://docs.envio.dev/) platform
(v3.16).

> **Note:** This is an Envio HyperIndex project — **not** a TheGraph subgraph.

## Table of contents

- [Supported chains](#supported-chains)
- [Getting started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Install](#install)
  - [Configure](#configure)
  - [Run](#run)
- [Testing and QA](#testing-and-qa)
- [Architecture](#architecture)
  - [Data flow](#data-flow)
  - [Repository layout](#repository-layout)
  - [`src/` layout](#src-layout)
  - [Indexed contract domains](#indexed-contract-domains)
- [Data model](#data-model)
- [Conventions](#conventions)
- [Documentation](#documentation)

## Supported chains

Networks are defined in `config.yaml`:

| Chain    | Chain ID | Chain     | Chain ID |
| -------- | -------- | --------- | -------- |
| Optimism | 10       | Lisk      | 1135     |
| Base     | 8453     | Unichain  | 130      |
| Celo     | 42220    | Fraxtal   | 252      |
| Soneium  | 1868     | Metal     | 1750     |
| Ink      | 57073    | Superseed | 5330     |
| Mode     | 34443    | Swell     | 1923     |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) **22+** (see `engines` in `package.json`)
- [pnpm](https://pnpm.io/) **9+**
- [Docker](https://www.docker.com/) — `pnpm dev` runs Postgres and the Envio
  runtime in containers

### Install

```bash
pnpm install
```

### Configure

Copy the example environment file and fill in the values:

```bash
cp .env.example .env
```

`.env` holds:

- `ENVIO_API_TOKEN` — Envio API token
- `ENVIO_PG_MAX_CONNECTIONS` — Postgres connection cap (recommended for v3)
- `ENVIO_CLICKHOUSE_*` — ClickHouse storage (see `.env.example`)
- RPC endpoints, see below.

#### RPC configuration

On-chain reads that fall outside HyperSync (token metadata, gauge balances,
swap fees, root-pool lookups, oracle prices) go through `src/Effects/`. Each
chain's endpoints are resolved in one place, `src/Effects/RpcConfig.ts`:

| Variable | Meaning |
| --- | --- |
| `ENVIO_DRPC_API_KEY` | dRPC key. When set, every chain's primary is `https://lb.drpc.live/<network>/<key>` (networks: optimism, base, celo, soneium, ink, mode, lisk, unichain, fraxtal, metall2, superseed, swell). |
| `ENVIO_<CHAIN>_RPC_URL` | Explicit primary for one chain; overrides the dRPC URL. `<CHAIN>` is one of `OPTIMISM BASE CELO SONEIUM INK MODE LISK UNICHAIN FRAXTAL METAL SUPERSEED SWELL`. |
| `ENVIO_<CHAIN>_FALLBACK_RPC_URL` | Second endpoint used when the primary fails for any reason other than a contract revert. Defaults to a public endpoint from another provider (Superseed has none); `none` disables it. |
| `ENVIO_<CHAIN>_RPC_RPS` | Requests per second for that chain's primary (defaults: Base 40, Optimism 25, others 10). |
| `ENVIO_DRPC_MAX_RPS` | Budget shared by all dRPC-key endpoints (default 80; dRPC pay-as-you-go accounts created after 2026-10-19 are limited to 100 RPS per account). |
| `ENVIO_FALLBACK_RPC_RPS` | Requests per second for each fallback endpoint (default 5). |

There is no silent public default for the primary: if neither
`ENVIO_<CHAIN>_RPC_URL` nor `ENVIO_DRPC_API_KEY` is set, the indexer refuses to
start and lists every missing variable. Check endpoints (chain id, archive
`eth_call`s at several historical blocks, latency) with:

```bash
npx -y tsx@4.19.2 scripts/check-rpc.ts            # all chains, primary + fallback
npx -y tsx@4.19.2 scripts/check-rpc.ts --chain 8453 --calls 20 --primary-only
```

Failures are retried with backoff and then sent to the fallback; when both
fail, the effect returns a default that is never written to the effect cache,
and the indexer logs `rpc.default_used` (error class, chain, operation) plus a
per-chain `rpc.stats` line every minute. Alert on `default_transient`.

#### Token metadata seed cache

`.envio/cache/<chainId>/getTokenMetadata.tsv` is committed. Envio loads it into
the `getTokenMetadata` effect cache when it initialises a fresh database
(first `envio dev`/`envio start`, or a run with `-r`), so a resync does not
re-read ~35k tokens over RPC. It is compatible with the `getTokenMetadata`
cache of Envio's Uniswap v4 indexer. Rebuild it with
`scripts/build-token-metadata-cache.ts`.

### Run

```bash
# 1. Generate types from schema.graphql + config.yaml
#    (MUST be re-run after changing either file)
pnpm envio codegen

# 2a. Spin up Docker containers and start indexing
pnpm dev

# 2b. ...or start the indexer inside an already-running container
pnpm envio start
```

Stop the indexer:

```bash
pnpm envio stop
```

For headless / CI runs (no terminal UI):

```bash
TUI_OFF=true pnpm dev
```

## Testing and QA

```bash
tsc --noEmit                          # Type-check (run after any TypeScript change)
pnpm test                             # Full test suite with coverage (Vitest)
pnpm test:file test/path/to/file.ts   # Run a single test file
pnpm test:grep "pattern"              # Run tests matching a name pattern
pnpm qa                               # Lint + format check (Biome); `pnpm qa --write` to apply fixes
```

Tests live under `test/`, mirroring the `src/` layout
(`Aggregators/`, `Effects/`, `EventHandlers/`, `Snapshots/`).

## Architecture

### Data flow

`config.yaml` declares the contracts and events to index per chain → Envio
generates types from `schema.graphql` → handlers in `src/EventHandlers/`
process events → aggregators in `src/Aggregators/` compute derived state →
`src/Snapshots/` captures hourly snapshots. External reads (RPC/API) are wrapped
in Envio's Effect API (`src/Effects/`) so they stay correct across preload runs.

### Repository layout

```
config.yaml        Contracts, events, and networks indexed per chain
schema.graphql     Entity (database) definitions
abis/              Contract ABIs referenced by config.yaml
src/               Indexer source (see below)
test/              Vitest suites mirroring src/
scripts/           One-off analysis, benchmarking, and doc-generation tooling
docs/              Schema reference (docs/schema.md) and agent workflow docs
generated/         Auto-generated by `pnpm envio codegen` (git-ignored)
```

### `src/` layout

Top-level modules:

- `Constants.ts` — chain-specific constants, factory addresses, price
  connectors, RPC client setup, `toChecksumAddress()`, `CHAIN_CONSTANTS`
- `Helpers.ts` — shared utilities (error handling, USD conversions,
  concentrated-liquidity position math via the Uniswap v3 SDK)
- `Maths.ts` — fixed-point / BigInt math helpers
- `PriceOracle.ts` — hourly token price refresh from indexed pool state (no
  RPC; see `docs/adr/0003-pool-derived-token-prices.md`), token creation and
  metadata heal
- `PriceOverrides.ts` — token blacklist and cross-chain canonical sources (ADR 0004)
- `PriceTrust.ts` — price-trust gating used by USD valuation
- `PoolPriceRatio.ts` — spot prices from pool state (CL `sqrtPriceX96`, V2
  volatile reserve ratio, V2 stable sAMM curve)
- `CustomTypes.ts` / `EntityTypes.ts` — shared TypeScript types

Subdirectories:

- `EventHandlers/` — handler registrations and business logic. Top-level files
  (e.g. `Pool.ts`, `CLPool.ts`) register handlers; domain subdirectories hold
  the logic (`Pool/`, `CLPool/`, `Gauges/`, `Voter/`, `VotingReward/`,
  `VeNFT/`, `NFPM/`, `ALM/`, `PoolLauncher/`, `SwapFeeModule/`,
  `SuperswapsHyperlane/`, `Redistributor/`, `CLFactory/`, `CLGaugeFactory/`)
- `Aggregators/` — derived-entity computation. `Pool.ts` is the central
  aggregator (TVL, volume, fees, votes, emissions); others cover
  `UserStatsPerPool`, `NonFungiblePosition`, `VeNFTState`, `VeNFTPoolVote`,
  `ALMLPWrapper`, `CLStakedLiquidity`, `OUSDTSwaps`
- `Pricing/` — pool-derived pricing: tiers and thresholds
  (`PricingConfig.ts`), candidate pools and deepest-pool selection
  (`PoolRoute.ts`), throttle / carry / 7-day expiry (`PriceResolution.ts`)
- `Snapshots/` — hourly snapshot creation for aggregated entities, with
  epoch-alignment logic in `Shared.ts`
- `Effects/` — external calls (RPC/API) behind Envio's Effect API.
  `RpcGateway.ts` handles multi-chain RPC; `Token.ts`, `SwapFee.ts`,
  `Bytecode.ts`, `RootPool.ts`, `Voter.ts` wrap specific reads
- `constants/` — static reference data (whitelisted-token lists, price
  connectors, stablecoins)

### Indexed contract domains

- **Pools** — V2 AMM (`Pool`) and concentrated liquidity (`CLPool`)
- **Factories** — `PoolFactory`, `CLFactory`, `RootCLPoolFactory`,
  `FactoryRegistry`
- **Gauges** — `Gauge` (V2) and `CLGauge` (CL), plus `CLGaugeFactoryV2/V3`
- **Voting** — `Voter`, `SuperchainLeafVoter`, and the fee/bribe/incentive
  `VotingReward` contracts (`FeesVotingReward`, `BribesVotingReward`,
  `SuperchainIncentiveVotingReward`)
- **veNFT** — vote-escrowed NFT tracking (deposits, withdrawals, merges, splits)
- **NFPM** — Non-Fungible Position Manager for CL positions
- **ALM** — Automated Liquidity Management (`ALMDeployFactoryV1/V2`, `ALMCore`,
  `ALMLPWrapperV1/V2`)
- **Pool launchers** — `CLPoolLauncher`, `V2PoolLauncher`
- **Swap-fee modules** — `DynamicSwapFeeModule`, `CustomSwapFeeModule`,
  `UnstakedFeeModule`, `CustomUnstakedFeeModule`
- **Superswaps / Hyperlane** — cross-chain swap tracking
  (`VelodromeUniversalRouter`, `Mailbox`)
- **Redistributor**

## Data model

The database schema is defined in [`schema.graphql`](schema.graphql) (39 entity
types). The full, field-by-field reference — types, nullability, indexes, and
descriptions for every field — is in
**[`docs/schema.md`](docs/schema.md)**, which is generated from the schema by
[`scripts/generate-schema-docs.ts`](scripts/generate-schema-docs.ts)
(`pnpm tsx scripts/generate-schema-docs.ts` to regenerate).

Consumers who want to **query the data** rather than build the indexer should
start with **[`docs/querying.md`](docs/querying.md)**, the consumer's guide to
the GraphQL API, the value-scaling rules, and example queries.

### Conventions

- **Entity IDs** are deterministic strings: pools `{chainId}-{poolAddress}`,
  tokens `{chainId}-{tokenAddress}`, snapshots `{entityId}-{epochMs}`. Each
  entity's exact `id` format is documented on its `id` field.
- **`BigInt` fields are fixed-point integers** (no JS float precision loss).
  Divide by the token's `decimals` for token amounts, or by `10^18` for
  USD/`WAD`-scaled values.
- **Snapshots** are hourly, epoch-aligned copies of a "latest-state" aggregate,
  enabling historical / time-series queries (`PoolSnapshot`,
  `UserStatsPerPoolSnapshot`, …).
- **`@index`** marks fields that are efficient to filter on; **`@derivedFrom`**
  marks reverse-relation fields that are computed, not stored.
- Addresses are stored checksummed (`toChecksumAddress()` from
  `src/Constants.ts`).

### Entities by category

- **Core aggregates** — latest-state, headline metrics:
  [`Pool`](docs/schema.md#pool), [`Token`](docs/schema.md#token),
  [`UserStatsPerPool`](docs/schema.md#userstatsperpool),
  [`NonFungiblePosition`](docs/schema.md#nonfungibleposition),
  [`VeNFTState`](docs/schema.md#venftstate),
  [`VeNFTPoolVote`](docs/schema.md#venftpoolvote),
  [`ALM_LP_Wrapper`](docs/schema.md#alm_lp_wrapper)
- **Snapshots** — hourly historical copies of the core aggregates
  ([full list](docs/schema.md#snapshots))
- **Config & registry** — chain-wide config and cross-chain mapping tables
  ([full list](docs/schema.md#config--registry))
- **Pool launcher** — emerging-token pools
  ([full list](docs/schema.md#pool-launcher))
- **Cross-chain superswaps (Hyperlane)** — oUSDT-bridged swaps and their
  dispatch/process correlation
  ([full list](docs/schema.md#cross-chain-superswaps-hyperlane))
- **Internal buffers & deferred state** — short-lived bookkeeping entities that
  correlate events across log indices/blocks; mostly deleted once consumed
  ([full list](docs/schema.md#internal-buffers--deferred-state))

## Conventions

- **Linting/formatting** uses [Biome](https://biomejs.dev/) (not Prettier/ESLint)
  — space indentation, double quotes, organized imports. Run `pnpm qa` before
  committing.
- See [`CLAUDE.md`](CLAUDE.md) for the full set of Envio-specific patterns
  (immutable entity updates, the Effect API, dynamically registered contracts,
  amount normalization) and file-naming conventions.

## Documentation

- [Envio HyperIndex docs](https://docs.envio.dev/)
- [Event handlers](https://docs.envio.dev/docs/event-handlers)
- [Dynamic contracts](https://docs.envio.dev/docs/dynamic-contracts)
- [`docs/querying.md`](docs/querying.md) — consumer's guide: querying the
  GraphQL API, value scaling, and example queries
- [`docs/schema.md`](docs/schema.md) — complete entity & field reference
- [`CLAUDE.md`](CLAUDE.md) — in-repo architecture and contributor guide
- [`docs/agents/`](docs/agents/) — issue-tracker, triage-label, and domain
  workflow docs
